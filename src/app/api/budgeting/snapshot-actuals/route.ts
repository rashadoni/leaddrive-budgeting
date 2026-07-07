import { NextRequest, NextResponse } from "next/server"
import { getOrgId, getSession } from "@/lib/api-auth"
// Stage 3 RLS — `prisma` kept ONLY for lockedResponse's 423-audit.
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { loadAndCompute } from "@/lib/cost-model/db"
import { resolveCostModelKey } from "@/lib/budgeting/cost-model-map"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("api:budgeting:snapshot-actuals")
import { currentBakuYearMonth } from "@/lib/risk/periods"
import { findFirstActiveLockInPeriods, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse, containingPeriodKeys } from "@/lib/budgeting/period-lock-http"
import { deriveMonthIndex } from "@/lib/budgeting/derive-month-index"

/**
 * POST /api/budgeting/snapshot-actuals
 * Body: { planId?, month?: "YYYY-MM" }
 *
 * Creates BudgetActual records for all auto-actual budget lines
 * by snapshotting the current cost model values for a specific month.
 *
 * If month is not provided, uses the current month.
 * If planId is not provided, processes all draft/approved plans for the org.
 *
 * Idempotent: skips if BudgetActual already exists for this month+category+plan.
 * Also creates/updates a CostModelSnapshot for the month.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req)
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { orgId, userId } = session

    const body = await req.json().catch(() => ({}))
    const { planId, month } = body as { planId?: string; month?: string }

    // Determine target month (default: current)
    const { year: bkuYear, month: bkuMonth } = currentBakuYearMonth()
    const targetMonth = month || `${bkuYear}-${String(bkuMonth).padStart(2, "0")}`

    // Load cost model
    const costModel = await loadAndCompute(orgId).catch(() => null)
    if (!costModel) {
      return NextResponse.json({ error: "Cost model not available" }, { status: 500 })
    }

    // Stage 3 RLS — plan reads, lock check and the per-plan snapshot loop
    // in one org-scoped tx (loadAndCompute above is a stub; loops bounded
    // by plan × auto-actual-line count).
    return withOrgScope(
      orgId,
      async (tx) => {
    // Find plans to process — needed for the lock check below.
    const plans = planId
      ? await tx.budgetPlan.findMany({ where: { id: planId, organizationId: orgId } })
      : await tx.budgetPlan.findMany({ where: { organizationId: orgId, status: { in: ["draft", "approved"] } } })

    // Phase 7.G Turn LXIX (Phase 4.2 bulk-mutation gate). snapshot-actuals
    // writes actuals at `targetMonth` for each plan — a mutation into the
    // org's data, so it must respect period-lock. Reject if either:
    //   - any plan's period is locked (annual/quarterly/monthly), OR
    //   - the target month's containing periods (year/quarter/month) match a lock.
    // Conservative: if ANY plan's period or the targetMonth-containers are
    // locked, skip the whole batch (atomic intent). The gate fires BEFORE
    // the per-plan create loop.
    const [tYearStr, tMonthStr] = targetMonth.split("-")
    const tYear = Number(tYearStr)
    const tMonth = Number(tMonthStr)
    const planPeriodKeys = plans.map((p: { periodType: string | null; year: number; month: number | null; quarter: number | null }) =>
      derivePeriodKey(p),
    )
    const monthContainerKeys = Number.isFinite(tYear) && Number.isFinite(tMonth)
      ? containingPeriodKeys(tYear, tMonth)
      : []
    const periodsToCheck = Array.from(new Set([...planPeriodKeys, ...monthContainerKeys]))
    const snapLock = await findFirstActiveLockInPeriods(tx, orgId, periodsToCheck)
    if (snapLock) return lockedResponse(snapLock, { prisma, orgId, userId, route: "POST /api/budgeting/snapshot-actuals" })

    // Phase 8 D3 (2026-05-29) — removed a dead `prisma.costModelSnapshot
    // .upsert(...)` block here. `CostModelSnapshot` is not a model in
    // schema.prisma (it was an AAC-era table, gone since the Phase 2.3
    // legacy cleanup), and `loadAndCompute` is now a stub — so the upsert
    // referenced an undefined client property and threw on every call,
    // which the route's try/catch turned into a 500. Because this hook IS
    // called from the UI (`useSnapshotActuals`), the feature was broken.
    // The route's real work — snapshotting auto-actual budget lines into
    // BudgetActual rows — lives in the loop below and was never reached.
    // No reader of costModelSnapshot exists, so dropping the write is safe.

    let created = 0
    let skipped = 0

    for (const plan of plans) {
      // Get auto-actual lines for this plan
      const autoLines = await tx.budgetLine.findMany({
        where: { planId: plan.id, organizationId: orgId, isAutoActual: true, deletedAt: null },
        include: { account: { select: { code: true, name: true } } },
      })

      for (const line of autoLines) {
        if (!line.costModelKey) continue

        // Check if BudgetActual already exists for this month+account.code+plan
        const lineAccountCode = (line as any).account?.code ?? ""
        const existing = await tx.budgetActual.findFirst({
          where: {
            planId: plan.id,
            organizationId: orgId,
            category: lineAccountCode,
            lineType: line.lineType,
            expenseDate: targetMonth,
            description: "Auto-snapshot",
          },
        })

        if (existing) {
          skipped++
          continue
        }

        // Resolve current value from cost model
        const amount = resolveCostModelKey(costModel, line.costModelKey)

        // Create BudgetActual record (Phase 3.1 v1.2 — stamp monthIndex
        // from targetMonth so the variance sparkline overlay attributes
        // this snapshot to the correct calendar month).
        await tx.budgetActual.create({
          data: {
            organizationId: orgId,
            planId: plan.id,
            category: lineAccountCode,
            department: line.department,
            lineType: line.lineType,
            actualAmount: amount,
            expenseDate: targetMonth,
            monthIndex: deriveMonthIndex(targetMonth),
            description: "Auto-snapshot",
          },
        })
        created++
      }
    }

    return NextResponse.json({
      success: true,
      data: { month: targetMonth, created, skipped, plans: plans.length },
    })
      },
      { timeoutMs: 30_000 },
    )
  } catch (error) {
    log.error("Snapshot actuals error", {
      err: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to create snapshot actuals" }, { status: 500 })
  }
}
