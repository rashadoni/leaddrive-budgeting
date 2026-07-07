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

const updateBodySchema = z
  .object({
    role: CoARoleSchema.nullable(),
  })
  .strict()

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
      select: { code: true, name: true, role: true },
    })
    if (!prior) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 })
    }

    // Cross-tenant guard: composite where-clause rejects sibling-org rewrites.
    // updateMany returns count=0 when no row matches (vs update which throws),
    // letting us return 404 cleanly without try/catch.
    const result = await tx.chartOfAccount.updateMany({
      where: { id, organizationId: orgId },
      data: { role: parsed.role },
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
    if (prior.role !== parsed.role) {
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
