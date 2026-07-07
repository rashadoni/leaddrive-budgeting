/**
 * Phase 7.O C2 — Per-user AI token usage.
 *
 * GET /api/me/ai-usage
 *
 * Returns the AI token consumption attributed to the caller (today + MTD).
 * Aggregated from `AuditEvent.metadata.tokensIn/tokensOut` on every
 * `ai_*` action — no schema migration needed because every AI route
 * already emits an audit row with `actorUserId`.
 *
 * Auth: any authenticated user (every role makes AI calls; CommandBar
 * shows the chip globally).
 *
 * Response:
 * {
 *   today:    { tokensIn, tokensOut, calls, total },
 *   mtd:      { tokensIn, tokensOut, calls, total },
 *   updatedAt: ISO8601
 * }
 *
 * Performance: each user has ≤ few dozen AI calls per day → audit-log
 * scan is cheap (indexed by (orgId, createdAt) per schema.prisma:2046).
 * Pulls just metadata fields needed for the sum.
 */

import { NextRequest, NextResponse } from "next/server"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { requireAuth, isAuthError } from "@/lib/api-auth"

/** All audit actions emitted by AI routes. Update whenever a new
 *  ai_*_run audit hook is added (the cost ledger depends on this list). */
const AI_AUDIT_ACTIONS = [
  "ai_variance_explainer_run",
  "ai_forecast_explainer_run",
  "ai_morning_brief_run",
  "ai_board_deck_narration_run",
  "ai_news_summary_run",
  "ai_breach_digest",
] as const

interface AggregatedStats {
  tokensIn: number
  tokensOut: number
  calls: number
  total: number
}

function emptyStats(): AggregatedStats {
  return { tokensIn: 0, tokensOut: 0, calls: 0, total: 0 }
}

/** Today at 00:00 UTC. AI usage resets on UTC day boundary so caps stay
 *  aligned with the per-org budget calendar (cost-budget.ts uses the
 *  same convention). */
function startOfTodayUTC(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
}

/** First of current UTC month at 00:00. */
function startOfMonthUTC(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }

  const now = new Date()
  const monthStart = startOfMonthUTC(now)
  const dayStart = startOfTodayUTC(now)

  // One MTD scan covers both today + month aggregations — we filter
  // today's slice in memory below. Volume is bounded (≤ a few hundred
  // rows per user per month) so the smaller cost is worth saving the
  // second round-trip.
  let rows: Array<{
    metadata: unknown
    createdAt: Date
  }> = []
  const orgId = session.orgId
  try {
    rows = await withOrgScope(orgId, (tx) =>
      tx.auditEvent.findMany({
        where: {
          organizationId: orgId,
          actorUserId: session.userId,
          action: { in: [...AI_AUDIT_ACTIONS] },
          createdAt: { gte: monthStart },
        },
        select: { metadata: true, createdAt: true },
      }),
    )
  } catch {
    // Audit table missing or transient failure — degrade to zeros rather
    // than 500ing on the chip. Chip is informational; the budget enforcement
    // happens server-side regardless.
  }

  const mtd = emptyStats()
  const today = emptyStats()
  for (const row of rows) {
    const md = (row.metadata ?? {}) as Record<string, unknown>
    const tIn = typeof md.tokensIn === "number" ? md.tokensIn : 0
    const tOut = typeof md.tokensOut === "number" ? md.tokensOut : 0
    if (tIn === 0 && tOut === 0) continue
    mtd.tokensIn += tIn
    mtd.tokensOut += tOut
    mtd.calls += 1
    if (row.createdAt >= dayStart) {
      today.tokensIn += tIn
      today.tokensOut += tOut
      today.calls += 1
    }
  }
  mtd.total = mtd.tokensIn + mtd.tokensOut
  today.total = today.tokensIn + today.tokensOut

  return NextResponse.json({
    today,
    mtd,
    updatedAt: now.toISOString(),
  })
}
