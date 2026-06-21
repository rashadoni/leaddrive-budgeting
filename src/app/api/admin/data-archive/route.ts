/**
 * Phase 7.M Step 4d (2026-05-18) — self-service archive API.
 *
 * POST /api/admin/data-archive
 *   body: {
 *     mode: "archive" | "restore",
 *     entityKind: "BudgetLine" | "BalanceSheetLine" | "CashFlowEntry"
 *               | "Counterparty",
 *     companyCode?: string,
 *     year?: number,
 *     period?: string,
 *     reason?: string,
 *     confirmCode: string,   // must equal companyCode (or "ALL" for org-wide)
 *   }
 *
 * Behaviour
 * ─────────
 *  • Admin-role only (LLM-token-equivalent cost: re-recompute fires
 *    on archived periods).
 *  • Rate limited 5/min/org so a stuck UI loop can't blast 100 archives.
 *  • `confirmCode` must match the scope being archived — a strong
 *    visual safety net (the page asks the user to type the entity
 *    code before the Archive button enables). Mismatch = 400.
 *  • Returns `{ ok: true, rowsAffected, auditEventId }`.
 *  • All writes happen in `archiveRows()` which wraps the soft-delete
 *    UPDATE + audit-event INSERT in a single `prisma.$transaction`.
 *  • Never deletes physically. The cleanup job (separate cron, not in
 *    this route) purges rows past the 90-day retention window.
 *
 * Why a single endpoint for archive + restore
 * ───────────────────────────────────────────
 * The scope payload is identical; only the verb differs. One route
 * with a `mode` discriminator keeps the surface small and lets a
 * future "undo last archive" feature share validation.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { getLogger } from "@/lib/log"

// Phase 8 D4 final (2026-05-29) — structured logger.
const log = getLogger("api:admin:data-archive")
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { archiveRows, restoreRows, resetCompanyImportData } from "@/lib/server/archive"
import { runRecomputeForCompanies } from "@/lib/risk/recompute-trigger"

const RATE_LIMIT = { name: "data-archive", max: 5, windowMs: 60_000 }

const VALID_KINDS = new Set([
  "BudgetLine",
  "BalanceSheetLine",
  "CashFlowEntry",
  "Counterparty",
  // Meta-kind: full "reset a company's imported data" (no-tails) — clears every
  // table + settings key an import writes, then recomputes. Archive-only.
  "AllImportData",
])

interface ArchiveBody {
  mode?: unknown
  entityKind?: unknown
  companyCode?: unknown
  year?: unknown
  period?: unknown
  reason?: unknown
  confirmCode?: unknown
}

export async function POST(request: NextRequest) {
  const session = await requireRole(request, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }
  const orgId = session.orgId

  const rateLimitError = enforceRateLimit(
    `${RATE_LIMIT.name}:${orgId}:${session.userId}:${getClientIp(request)}`,
    RATE_LIMIT,
  )
  if (rateLimitError) return rateLimitError

  let body: ArchiveBody
  try {
    body = (await request.json()) as ArchiveBody
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    )
  }

  const mode = body.mode
  if (mode !== "archive" && mode !== "restore") {
    return NextResponse.json(
      { error: "mode must be 'archive' or 'restore'" },
      { status: 400 },
    )
  }

  const entityKind = body.entityKind
  if (typeof entityKind !== "string" || !VALID_KINDS.has(entityKind)) {
    return NextResponse.json(
      {
        error:
          "entityKind must be one of: BudgetLine, BalanceSheetLine, CashFlowEntry, Counterparty, AllImportData",
      },
      { status: 400 },
    )
  }

  const companyCode =
    typeof body.companyCode === "string" && body.companyCode.length > 0
      ? body.companyCode
      : undefined
  const year =
    typeof body.year === "number" && Number.isInteger(body.year)
      ? body.year
      : undefined
  const period =
    typeof body.period === "string" && body.period.length > 0
      ? body.period
      : undefined
  const reason =
    typeof body.reason === "string" && body.reason.length > 0
      ? body.reason.slice(0, 500)
      : undefined
  const confirmCode =
    typeof body.confirmCode === "string" ? body.confirmCode : ""

  // Defensive: confirmCode acts as the "type the entity code to
  // confirm" safety pattern. For org-wide scopes (no companyCode)
  // we require the literal string "ALL".
  const expectedConfirm = companyCode ?? "ALL"
  if (confirmCode !== expectedConfirm) {
    return NextResponse.json(
      {
        error: `confirmCode must equal "${expectedConfirm}" — type the entity code to confirm`,
      },
      { status: 400 },
    )
  }

  const scope = {
    organizationId: orgId,
    entityKind: entityKind as
      | "BudgetLine"
      | "BalanceSheetLine"
      | "CashFlowEntry"
      | "Counterparty",
    companyCode,
    year,
    period,
  }

  // ── AllImportData — full per-company reset (no-tails) + recompute ──────
  if (entityKind === "AllImportData") {
    if (mode !== "archive") {
      return NextResponse.json(
        { error: "AllImportData supports mode 'archive' only — a reset isn't restorable; re-import to restore" },
        { status: 400 },
      )
    }
    if (!companyCode) {
      return NextResponse.json(
        { error: "AllImportData requires companyCode (reset is per-company)" },
        { status: 400 },
      )
    }
    try {
      const reset = await resetCompanyImportData({
        prisma,
        actorUserId: session.userId,
        reason,
        scope,
      })
      // Recompute so stale IndicatorValues fall back to `unknown` — no tails in
      // the terminal either. Scope to the reset year, else every period the
      // company still carries indicators for.
      const company = await prisma.company.findFirst({
        where: { organizationId: orgId, code: companyCode },
        select: { id: true },
      })
      let recomputed = 0
      if (company) {
        const years = year
          ? [year]
          : Array.from(
              new Set(
                (
                  await prisma.indicatorValue.findMany({
                    where: { companyId: company.id },
                    select: { period: true },
                    distinct: ["period"],
                  })
                )
                  .map((r) => parseInt(r.period, 10))
                  .filter((n) => Number.isFinite(n)),
              ),
            )
        const affected = years.map((y) => ({ companyId: company.id, year: y }))
        if (affected.length > 0) {
          const rc = await runRecomputeForCompanies(prisma, orgId, affected)
          recomputed = rc.ok ?? 0
        }
      }
      return NextResponse.json({
        ok: true,
        mode: "reset",
        rowsAffected: reset.rowsAffected,
        breakdown: reset.breakdown,
        auditEventId: reset.auditEventId,
        recomputed,
      })
    } catch (err) {
      log.error("data-archive reset failed", {
        err: err instanceof Error ? err.message : String(err),
      })
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      )
    }
  }

  try {
    const result =
      mode === "archive"
        ? await archiveRows({
            prisma,
            actorUserId: session.userId,
            reason,
            scope,
          })
        : await restoreRows({
            prisma,
            actorUserId: session.userId,
            reason,
            scope,
          })
    // CF has no companyId column — a company-scoped CF archive matches only
    // rows whose sourceId follows the "<code>::" import convention. Manual
    // entries (null / non-conforming sourceId) cannot be attributed to a
    // company, so they are intentionally left untouched. Surface that count
    // so the operator knows the archive wasn't exhaustive (no silent gap).
    let unattributableCfRows: number | undefined
    if (mode === "archive" && entityKind === "CashFlowEntry" && companyCode && year) {
      unattributableCfRows = await prisma.cashFlowEntry.count({
        where: {
          organizationId: orgId,
          year,
          deletedAt: null,
          OR: [{ sourceId: null }, { NOT: { sourceId: { contains: "::" } } }],
        },
      })
    }
    return NextResponse.json({
      ok: true,
      mode,
      rowsAffected: result.rowsAffected,
      auditEventId: result.auditEventId,
      ...(unattributableCfRows !== undefined ? { unattributableCfRows } : {}),
    })
  } catch (err) {
    log.error("data-archive operation failed", {
      mode,
      err: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }
}
