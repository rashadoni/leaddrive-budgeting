import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { loadAndCompute } from "@/lib/cost-model/db"
import { resolveCostModelKey } from "@/lib/budgeting/cost-model-map"

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
    const orgId = await getOrgId(req)
    if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const { planId, month } = body as { planId?: string; month?: string }

    // Determine target month (default: current)
    const now = new Date()
    const targetMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

    // Load cost model
    const costModel = await loadAndCompute(orgId).catch(() => null)
    if (!costModel) {
      return NextResponse.json({ error: "Cost model not available" }, { status: 500 })
    }

    // Save cost model snapshot (upsert)
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

    // Find plans to process
    const plans = planId
      ? await prisma.budgetPlan.findMany({ where: { id: planId, organizationId: orgId } })
      : await prisma.budgetPlan.findMany({ where: { organizationId: orgId, status: { in: ["draft", "approved"] } } })

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
