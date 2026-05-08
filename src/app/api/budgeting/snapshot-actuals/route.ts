import { NextRequest, NextResponse } from "next/server"
import { getOrgId, getSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { loadAndCompute } from "@/lib/cost-model/db"
import { resolveCostModelKey } from "@/lib/budgeting/cost-model-map"
import { currentBakuYearMonth } from "@/lib/risk/periods"
import { findFirstActiveLockInPeriods, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse, containingPeriodKeys } from "@/lib/budgeting/period-lock-http"

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

    // Find plans to process — needed for the lock check below; the
    // costModelSnapshot upsert is a side-effect and MUST come after the
    // lock check to avoid leaking a snapshot row on a 423 reject.
    const plans = planId
      ? await prisma.budgetPlan.findMany({ where: { id: planId, organizationId: orgId } })
      : await prisma.budgetPlan.findMany({ where: { organizationId: orgId, status: { in: ["draft", "approved"] } } })

    // Phase 7.G Turn LXIX (Phase 4.2 bulk-mutation gate). snapshot-actuals
    // writes actuals at `targetMonth` for each plan AND upserts a CostModelSnapshot.
    // Both are mutations into the org's data; both must respect period-lock.
    // Reject if either:
    //   - any plan's period is locked (annual/quarterly/monthly), OR
    //   - the target month's containing periods (year/quarter/month) match a lock.
    // Conservative: if ANY plan's period or the targetMonth-containers are
    // locked, skip the whole batch (atomic intent).
    //
    // Phase 7.G Turn LXIX architect Round-1 ⚠️ closure: previously this gate
    // ran AFTER costModelSnapshot.upsert — locked-period requests still
    // committed a snapshot row. Now the gate fires BEFORE both upsert and
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
    const snapLock = await findFirstActiveLockInPeriods(prisma, orgId, periodsToCheck)
    if (snapLock) return lockedResponse(snapLock, { prisma, orgId, userId, route: "POST /api/budgeting/snapshot-actuals" })

    // Save cost model snapshot (upsert) — moved BELOW the lock check.
    const summary = (costModel as any).summary
    await prisma.costModelSnapshot.upsert({
      where: { organizationId_snapshotMonth: { organizationId: orgId, snapshotMonth: targetMonth } },
      update: {
        totalCost: summary?.totalCost ?? costModel.grandTotalG ?? 0,
        totalRevenue: summary?.totalRevenue ?? Object.values(costModel.serviceRevenues).reduce((s: number, v: number) => s + v, 0),
        margin: summary?.margin ?? 0,
        marginPct: summary?.marginPct ?? 0,
        dataJson: JSON.stringify(costModel),
      },
      create: {
        organizationId: orgId,
        snapshotMonth: targetMonth,
        totalCost: summary?.totalCost ?? costModel.grandTotalG ?? 0,
        totalRevenue: summary?.totalRevenue ?? Object.values(costModel.serviceRevenues).reduce((s: number, v: number) => s + v, 0),
        margin: summary?.margin ?? 0,
        marginPct: summary?.marginPct ?? 0,
        dataJson: JSON.stringify(costModel),
      },
    })

    let created = 0
    let skipped = 0

    for (const plan of plans) {
      // Get auto-actual lines for this plan
      const autoLines = await prisma.budgetLine.findMany({
        where: { planId: plan.id, organizationId: orgId, isAutoActual: true },
      })

      for (const line of autoLines) {
        if (!line.costModelKey) continue

        // Check if BudgetActual already exists for this month+category+plan
        const existing = await prisma.budgetActual.findFirst({
          where: {
            planId: plan.id,
            organizationId: orgId,
            category: line.category,
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

        // Create BudgetActual record
        await prisma.budgetActual.create({
          data: {
            organizationId: orgId,
            planId: plan.id,
            category: line.category,
            department: line.department,
            lineType: line.lineType,
            actualAmount: amount,
            expenseDate: targetMonth,
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
  } catch (error) {
    console.error("Snapshot actuals error:", error)
    return NextResponse.json({ error: "Failed to create snapshot actuals" }, { status: 500 })
  }
}
