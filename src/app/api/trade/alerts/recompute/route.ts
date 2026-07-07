/**
 * Re-evaluate trade alerts — `POST /api/trade/alerts/recompute` (Phase 9.8).
 *
 * Pulls the LATEST TradePacingSnapshot per (period, grainKey) for the
 * current month, re-runs computePacing from the snapshot's persisted
 * `math` inputs, evaluates the alert rules and syncs the inbox
 * (create / update / auto-resolve by dedupeKey).
 *
 * Snapshot generation itself lands with 9.3 (budget pools) + 9.5 (daily
 * actuals); until those feed data, this returns zeros — the wiring is
 * complete and tested end-to-end the moment snapshots exist.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { computePacing, type PacingInput } from "@/lib/trade/pacing"
import {
  evaluatePacingAlerts,
  pacingAlertScopeKeys,
  syncTradeAlerts,
  type TradeAlertCandidate,
} from "@/lib/trade/alerts"

export async function POST(request: NextRequest) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const orgId = session.orgId

  const now = new Date()
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`

  // Stage 3 RLS — snapshot read + alert sync in one org-scoped tx.
  const { sync, grainsEvaluated, candidateCount } = await withOrgScope(orgId, async (tx) => {
    // Latest snapshot per grain for the current period.
    const snapshots = await tx.tradePacingSnapshot.findMany({
      where: { organizationId: orgId, period },
      orderBy: { asOfDate: "desc" },
      select: { grainKey: true, math: true, asOfDate: true },
    })
    const latestByGrain = new Map<string, (typeof snapshots)[number]>()
    for (const s of snapshots) {
      if (!latestByGrain.has(s.grainKey)) latestByGrain.set(s.grainKey, s)
    }

    const candidates: TradeAlertCandidate[] = []
    const scopeKeys: string[] = []
    for (const [grainKey, snap] of latestByGrain) {
      const input = snap.math as unknown as PacingInput
      if (typeof input?.year !== "number" || typeof input?.month !== "number") continue
      const result = computePacing(input)
      candidates.push(...evaluatePacingAlerts(period, grainKey, result))
      scopeKeys.push(...pacingAlertScopeKeys(period, grainKey))
    }

    const sync = await syncTradeAlerts(tx.alert, orgId, candidates, scopeKeys)
    return { sync, grainsEvaluated: latestByGrain.size, candidateCount: candidates.length }
  })
  return NextResponse.json({
    ok: true,
    period,
    grainsEvaluated,
    candidates: candidateCount,
    ...sync,
  })
}
