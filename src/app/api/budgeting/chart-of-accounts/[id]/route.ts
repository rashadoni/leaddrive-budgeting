/**
 * Phase 7.G Turn LXXXXI (Phase 5.1.2 — per-org CoA role override).
 * **Audit-emission added Turn LXXXXIV** — closes the «coa_role_change
 * audit emission» 🔄 from LXXXXI. Logger uses Prisma `auditEvent`
 * which gracefully no-ops if the enum value isn't yet in the DB
 * (logger never-throws contract).
 *
 * PUT /api/budgeting/chart-of-accounts/[id] — admin-only manual override
 * of `ChartOfAccount.role` for non-AAC charts. Backend foundation
 * (`coa-role.ts` + `CoARole` enum) shipped Turn LXXV; this route exposes
 * the override surface.
 *
 * Auth: admin-only (security boundary — affects P&L aggregation across
 * all P&L-reading consumers per Turn LXXV §5.1).
 *
 * Cross-tenant: `where: { id, organizationId }` not just `id` (rejects
 * sibling-org rewrites).
 *
 * Audit (Turn LXXXXIV): emits `coa_role_change` AuditEvent with
 * `{accountCode, accountName, from, to}` metadata. Pattern A1 — `await`
 * + `auditStale` flag in response so admin UI can warn on log-write
 * failure without losing the role change itself. Pre-`prisma migrate
 * deploy`: enum value missing from DB → audit insert returns
 * `{ok:false, error}` → response carries `auditStale:true` but the role
 * change is still committed (the row update happens before the audit
 * call). Post-migrate: clean trail in `audit_event` for compliance.
 *
 * Rate-limit: 30/min per userId (looser than period-locks 10/min — role
 * changes are a one-time setup operation per account, not a recurring
 * action).
 */

import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { enforceRateLimit } from "@/lib/rate-limit"
import { logAuditEvent } from "@/lib/audit/log"

const RATE_LIMIT = { name: "coa-role-update", max: 30, windowMs: 60_000 }

// Mirrors Prisma `CoARole` enum (schema.prisma:1476).
const CoARoleSchema = z.enum([
  "revenue", "cogs", "opex", "finance",
  "tax_costs", "non_operating", "tax", "unknown",
])

/**
 * Phase 11.20 (2026-07-29) — `accountType` is now reclassifiable.
 *
 * It was written once by the importer and frozen forever: every auto-created
 * account took `defaultAccountType` (falling back to "expense" when unknown)
 * and `upsert-chart-of-account.ts` deliberately does not overwrite it on
 * re-import. Its own comment promised "the admin override UI lets a finance
 * reviewer reclassify" — but that surface only ever exposed `role`. A
 * mis-typed account therefore put its number in the wrong statement section
 * permanently, even when the amount was perfectly correct, and no re-import
 * could repair it.
 *
 * Mirrors the importer's own set (imported, not re-declared, so the two
 * cannot drift).
 */
const AccountTypeSchema = z.enum([
  "revenue",
  "expense",
  "cogs",
  "asset",
  "liability",
  "equity",
])

/** Which statement an account type belongs to. A move WITHIN a statement
 *  (revenue↔cogs) reshuffles P&L subtotals; a move ACROSS statements
 *  (expense→asset) relocates the number entirely and silently changes both
 *  the P&L and the balance sheet, so it needs an explicit acknowledgement. */
const STATEMENT_OF: Record<string, "pnl" | "bs"> = {
  revenue: "pnl",
  expense: "pnl",
  cogs: "pnl",
  asset: "bs",
  liability: "bs",
  equity: "bs",
}

const updateBodySchema = z
  .object({
    role: CoARoleSchema.nullable().optional(),
    accountType: AccountTypeSchema.optional(),
    /** Required to move an account between the P&L and the balance sheet. */
    confirmCrossStatement: z.boolean().optional(),
  })
  .strict()
  .refine((b) => b.role !== undefined || b.accountType !== undefined, {
    message: "Provide at least one of `role` or `accountType`",
  })

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(req, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const rateLimitError = enforceRateLimit(`${RATE_LIMIT.name}:${session.userId}`, RATE_LIMIT)
  if (rateLimitError) return rateLimitError

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: "Missing account id" }, { status: 400 })
  }

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  let parsed
  try {
    parsed = updateBodySchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: e.flatten().fieldErrors },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const orgId = session.orgId
  // Stage 3 RLS — prior-read, guarded update, re-read and audit in one
  // org-scoped tx (audit is awaited here, so it rides the tx).
  return withOrgScope(orgId, async (tx) => {
    // Read prior state BEFORE update so audit metadata captures `from`.
    // Cross-tenant guard via composite where (rejects sibling-org reads).
    const prior = await tx.chartOfAccount.findFirst({
      where: { id, organizationId: orgId },
      select: { code: true, name: true, role: true, accountType: true },
    })
    if (!prior) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 })
    }

    // Phase 11.20 — refuse a silent cross-statement move. Reclassifying
    // expense→asset relocates the number out of the P&L and into the balance
    // sheet; both statements change and neither total is wrong-looking
    // afterwards, so it must be deliberate rather than a typo in a PUT body.
    if (
      parsed.accountType !== undefined &&
      parsed.accountType !== prior.accountType &&
      STATEMENT_OF[parsed.accountType] !== STATEMENT_OF[prior.accountType] &&
      !parsed.confirmCrossStatement
    ) {
      return NextResponse.json(
        {
          error:
            `Reclassifying "${prior.code}" from ${prior.accountType} to ` +
            `${parsed.accountType} moves it between the P&L and the balance ` +
            `sheet. Re-send with confirmCrossStatement: true to proceed.`,
          from: prior.accountType,
          to: parsed.accountType,
          requiresConfirmation: true,
        },
        { status: 409 },
      )
    }

    // Cross-tenant guard: composite where-clause rejects sibling-org rewrites.
    // updateMany returns count=0 when no row matches (vs update which throws),
    // letting us return 404 cleanly without try/catch.
    const result = await tx.chartOfAccount.updateMany({
      where: { id, organizationId: orgId },
      data: {
        ...(parsed.role !== undefined ? { role: parsed.role } : {}),
        ...(parsed.accountType !== undefined
          ? { accountType: parsed.accountType }
          : {}),
      },
    })

    if (result.count === 0) {
      // Race: row deleted between findFirst and updateMany — surface as 404.
      return NextResponse.json({ error: "Account not found" }, { status: 404 })
    }

    // Re-read to return current row state (Prisma updateMany doesn't return
    // the row). Under RLS the id-only lookup is still org-filtered by policy.
    const account = await tx.chartOfAccount.findUnique({ where: { id } })

    // Audit emit — Pattern A1 (await + auditStale surface). Skip if no-op
    // (e.g. PUT with the same role); otherwise the audit log fills with
    // identical-from/to noise.
    let auditStale = false
    if (
      parsed.accountType !== undefined &&
      parsed.accountType !== prior.accountType
    ) {
      // Separate event from the role change: this one moves money between
      // statement sections and is what a reviewer will look for later.
      const typeAudit = await logAuditEvent(tx, {
        organizationId: orgId,
        actorUserId: session.userId,
        event: {
          action: "coa_role_change",
          entityType: "ChartOfAccount",
          entityId: id,
          metadata: {
            accountCode: prior.code,
            accountName: prior.name,
            field: "accountType",
            from: prior.accountType,
            to: parsed.accountType,
            crossStatement:
              STATEMENT_OF[parsed.accountType] !== STATEMENT_OF[prior.accountType],
          },
        },
        context: { route: `PUT /api/budgeting/chart-of-accounts/${id}` },
      })
      if (!typeAudit.ok) auditStale = true
    }
    if (parsed.role !== undefined && prior.role !== parsed.role) {
      const auditResult = await logAuditEvent(tx, {
        organizationId: orgId,
        actorUserId: session.userId,
        event: {
          action: "coa_role_change",
          entityType: "ChartOfAccount",
          entityId: id,
          metadata: {
            accountCode: prior.code,
            accountName: prior.name,
            from: prior.role,
            to: parsed.role,
          },
        },
        context: {
          route: `PUT /api/budgeting/chart-of-accounts/${id}`,
        },
      })
      if (!auditResult.ok) auditStale = true
    }

    return NextResponse.json(
      auditStale ? { account, updated: true, auditStale: true } : { account, updated: true },
      { status: 200 },
    )
  })
}
