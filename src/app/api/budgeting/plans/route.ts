import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId, requireRole } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { loadAndCompute } from "@/lib/cost-model/db"

const createPlanSchema = z.object({
  name: z.string().min(1).max(500),
  periodType: z.enum(["monthly", "quarterly", "annual"]),
  year: z.number().int().min(2020).max(2050),
  month: z.number().int().min(1).max(12).optional().nullable(),
  quarter: z.number().int().min(1).max(4).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
}).strict()

const DEPT_CATEGORY_MAP: Record<string, string> = {
  it: "Daimi IT", infosec: "InfoSec",
  erp: "ERP", grc: "GRC", pm: "PM",
  helpdesk: "HelpDesk", cloud: "Cloud", waf: "WAF",
}

function getPeriodMonths(periodType: string, quarter?: number | null, month?: number | null): number[] {
  if (periodType === "annual") return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  if (periodType === "quarterly" && quarter) {
    const start = (quarter - 1) * 3 + 1
    return [start, start + 1, start + 2]
  }
  if (periodType === "monthly" && month) return [month]
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
}

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const plans = await prisma.budgetPlan.findMany({
    where: { organizationId: orgId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  })

  return NextResponse.json({ success: true, data: plans })
}

export async function POST(req: NextRequest) {
  const session = await requireRole(req, "manager")
  if (session instanceof NextResponse) return session
  const { orgId } = session

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try {
    data = createPlanSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { name, periodType, year, month, quarter, notes } = data

  // Check for duplicate plan in same period
  const duplicate = await prisma.budgetPlan.findFirst({
    where: {
      organizationId: orgId,
      periodType,
      year,
      ...(month ? { month } : {}),
      ...(quarter ? { quarter } : {}),
    },
  })
  if (duplicate) {
    return NextResponse.json({ error: `A plan for this period already exists: "${duplicate.name}"` }, { status: 409 })
  }

  const plan = await prisma.budgetPlan.create({
    data: {
      organizationId: orgId,
      name,
      periodType,
      year,
      month: month ?? null,
      quarter: quarter ?? null,
      notes: notes || null,
    },
  })

  // Auto-populate: clone lines from existing plan + fill from sales forecast & cost model
  try {
    const planYear = year
    const planMonths = getPeriodMonths(periodType, quarter ?? null, month ?? null)

    // Clone budget line structure from any existing plan
    const sourcePlan = await prisma.budgetPlan.findFirst({
      where: { organizationId: orgId, id: { not: plan.id }, isRolling: false },
      orderBy: { createdAt: "asc" },
    })

    if (sourcePlan) {
      const allSourceLines = await prisma.budgetLine.findMany({ where: { planId: sourcePlan.id } })
      const costModel = await loadAndCompute(orgId)

      // Filter source lines to only include months relevant to this plan period
      // sortOrder % 100 = month index (0-11), so month = (sortOrder % 100) + 1
      const planMonthIndices = new Set(planMonths.map(m => m - 1)) // convert to 0-based
      const sourceLines = allSourceLines.filter((sl: any) => {
        const monthIdx = sl.sortOrder % 100
        return planMonthIndices.has(monthIdx)
      })

      // Load sales forecast for revenue (user's Excel forecast)
      const salesForecasts = await prisma.salesForecast.findMany({
        where: { organizationId: orgId, year: planYear, month: { in: planMonths } },
        include: { budgetDept: { select: { key: true } } },
      })

      // Sum forecast by department key for the plan's months
      const forecastByDept: Record<string, number> = {}
      for (const sf of salesForecasts) {
        const key = sf.budgetDept.key
        forecastByDept[key] = (forecastByDept[key] || 0) + sf.amount
      }

      // Clone parent lines first, then children with mapped parentId
      const parentLines = sourceLines.filter((sl: any) => !sl.parentId)
      const childLines = sourceLines.filter((sl: any) => sl.parentId)
      const idMapping = new Map<string, string>() // oldId → newId

      for (const sl of parentLines) {
        let plannedAmount = 0

        if (sl.lineType === "revenue") {
          for (const [deptKey, category] of Object.entries(DEPT_CATEGORY_MAP)) {
            if (sl.category === category) {
              plannedAmount = forecastByDept[deptKey] ?? 0
              break
            }
          }
        }
        if (plannedAmount === 0 && sl.costModelKey) {
          const parts = sl.costModelKey.split(".")
          if (parts[0] === "serviceDetails" && parts.length === 3) {
            const detail = costModel.serviceDetails[parts[1]]
            if (detail && parts[2] in detail) {
              plannedAmount = ((detail as any)[parts[2]] ?? 0) * planMonths.length
            }
          }
        }
        // Fallback: copy original amount if no forecast/cost model data
        if (plannedAmount === 0) {
          plannedAmount = sl.plannedAmount
        }

        const created = await prisma.budgetLine.create({
          data: {
            organizationId: orgId, planId: plan.id, category: sl.category,
            department: sl.department, lineType: sl.lineType,
            plannedAmount: Math.round(plannedAmount * 100) / 100,
            costModelKey: sl.costModelKey,
            isAutoActual: false, isAutoPlanned: false,
            notes: sl.notes, sortOrder: sl.sortOrder,
            lineSubtype: sl.lineSubtype, parentId: null,
          },
        })
        idMapping.set(sl.id, created.id)
      }

      for (const sl of childLines) {
        let plannedAmount = 0

        if (sl.costModelKey) {
          const parts = sl.costModelKey.split(".")
          if (parts[0] === "serviceDetails" && parts.length === 3) {
            const detail = costModel.serviceDetails[parts[1]]
            if (detail && parts[2] in detail) {
              plannedAmount = ((detail as any)[parts[2]] ?? 0) * planMonths.length
            }
          }
        } else {
          plannedAmount = sl.plannedAmount
        }

        const newParentId = sl.parentId ? idMapping.get(sl.parentId) ?? null : null
        await prisma.budgetLine.create({
          data: {
            organizationId: orgId, planId: plan.id, category: sl.category,
            department: sl.department, lineType: sl.lineType,
            plannedAmount: Math.round(plannedAmount * 100) / 100,
            costModelKey: sl.costModelKey,
            isAutoActual: false, isAutoPlanned: false,
            notes: sl.notes, sortOrder: sl.sortOrder,
            lineSubtype: sl.lineSubtype, parentId: newParentId,
          },
        })
      }
    }

    // Clone Sales Budget lines (filtered by period months)
    const sourceSales = await prisma.salesBudgetLine.findMany({
      where: { organizationId: orgId, planId: sourcePlan.id, month: { in: planMonths } },
    })
    if (sourceSales.length > 0) {
      await prisma.salesBudgetLine.createMany({
        data: sourceSales.map((s: any) => ({
          organizationId: orgId,
          planId: plan.id,
          productLineId: s.productLineId,
          year: s.year,
          month: s.month,
          quantity: s.quantity,
          unitPrice: s.unitPrice,
          amount: s.amount,
          notes: s.notes,
        })),
      })
    }

    // Clone COGS Budget lines (filtered by period months)
    const sourceCogs = await prisma.cOGSBudgetLine.findMany({
      where: { organizationId: orgId, planId: sourcePlan.id, month: { in: planMonths } },
    })
    if (sourceCogs.length > 0) {
      await prisma.cOGSBudgetLine.createMany({
        data: sourceCogs.map((c: any) => ({
          organizationId: orgId,
          planId: plan.id,
          productLineId: c.productLineId,
          accountCode: c.accountCode,
          year: c.year,
          month: c.month,
          productionQty: c.productionQty,
          totalCost: c.totalCost,
          notes: c.notes,
        })),
      })
    }

    // Clone Balance Sheet lines (filtered by period months)
    const sourceBS = await prisma.balanceSheetLine.findMany({
      where: { organizationId: orgId, planId: sourcePlan.id, month: { in: planMonths } },
    })
    if (sourceBS.length > 0) {
      await prisma.balanceSheetLine.createMany({
        data: sourceBS.map((b: any) => ({
          organizationId: orgId,
          planId: plan.id,
          accountCode: b.accountCode,
          accountName: b.accountName,
          lineType: b.lineType,
          subType: b.subType,
          year: b.year,
          month: b.month,
          amount: b.amount,
          notes: b.notes,
        })),
      })
    }

    // Clone Assumptions (not month-specific, copy all)
    const sourceAssumptions = await prisma.budgetAssumption.findMany({
      where: { organizationId: orgId, planId: sourcePlan.id },
    })
    if (sourceAssumptions.length > 0) {
      await prisma.budgetAssumption.createMany({
        data: sourceAssumptions.map((a: any) => ({
          organizationId: orgId,
          planId: plan.id,
          category: a.category,
          key: a.key,
          label: a.label,
          value: a.value,
          unit: a.unit,
          period: a.period,
          notes: a.notes,
          sortOrder: a.sortOrder,
        })),
      })
    }
  } catch (e) {
    console.error("Auto-populate plan error:", e)
  }

  return NextResponse.json({ success: true, data: plan }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  // Bulk destructive operation — admin only (reset / deleteAll clears org data)
  const session = await requireRole(req, "admin")
  if (session instanceof NextResponse) return session
  const { orgId } = session

  const { searchParams } = new URL(req.url)
  const planId = searchParams.get("planId")
  const deleteAll = searchParams.get("deleteAll") === "true"

  // DELETE ALL — wipe everything for this organization
  if (deleteAll && !planId) {
    // Get all plan IDs first
    const allPlans = await prisma.budgetPlan.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true },
    })
    const planIds = allPlans.map((p: { id: string }) => p.id)

    if (planIds.length > 0) {
      await prisma.$transaction([
        prisma.budgetForecastEntry.deleteMany({ where: { planId: { in: planIds } } }),
        prisma.rollingForecastMonth.deleteMany({ where: { planId: { in: planIds } } }),
        prisma.budgetActual.deleteMany({ where: { planId: { in: planIds } } }),
        prisma.budgetLine.deleteMany({ where: { planId: { in: planIds } } }),
        prisma.salesBudgetLine.deleteMany({ where: { planId: { in: planIds } } }),
        prisma.cOGSBudgetLine.deleteMany({ where: { planId: { in: planIds } } }),
        prisma.balanceSheetLine.deleteMany({ where: { planId: { in: planIds } } }),
        prisma.budgetAssumption.deleteMany({ where: { planId: { in: planIds } } }),
        prisma.budgetApprovalComment.deleteMany({ where: { planId: { in: planIds } } }),
        prisma.savedBudgetReport.deleteMany({ where: { planId: { in: planIds } } }),
        prisma.budgetChangeLog.deleteMany({ where: { planId: { in: planIds } } }),
        prisma.budgetPlan.deleteMany({ where: { organizationId: orgId } }),
      ])
    }

    // Clean org-level data (including remaining saved reports without planId)
    await prisma.$transaction([
      prisma.chartOfAccount.deleteMany({ where: { organizationId: orgId } }),
      prisma.salesForecast.deleteMany({ where: { organizationId: orgId } }),
      prisma.expenseForecast.deleteMany({ where: { organizationId: orgId } }),
      prisma.cashFlowEntry.deleteMany({ where: { organizationId: orgId } }),
      prisma.cashFlowAlert.deleteMany({ where: { organizationId: orgId } }),
      prisma.costComponent.deleteMany({ where: { organizationId: orgId } }),
      prisma.productLine.deleteMany({ where: { organizationId: orgId } }),
      prisma.budgetDepartment.deleteMany({ where: { organizationId: orgId } }),
      prisma.budgetCostType.deleteMany({ where: { organizationId: orgId } }),
      prisma.savedBudgetReport.deleteMany({ where: { organizationId: orgId } }),
      prisma.budgetChangeLog.deleteMany({ where: { organizationId: orgId } }),
    ])

    return NextResponse.json({ success: true, deletedPlans: allPlans.length, deletedAll: true })
  }

  // DELETE single plan
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  const plan = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId },
  })
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  await prisma.$transaction([
    prisma.budgetForecastEntry.deleteMany({ where: { planId } }),
    prisma.rollingForecastMonth.deleteMany({ where: { planId } }),
    prisma.budgetActual.deleteMany({ where: { planId } }),
    prisma.budgetLine.deleteMany({ where: { planId } }),
    prisma.salesBudgetLine.deleteMany({ where: { planId } }),
    prisma.cOGSBudgetLine.deleteMany({ where: { planId } }),
    prisma.balanceSheetLine.deleteMany({ where: { planId } }),
    prisma.budgetAssumption.deleteMany({ where: { planId } }),
    prisma.budgetApprovalComment.deleteMany({ where: { planId } }),
    prisma.savedBudgetReport.deleteMany({ where: { planId } }),
    prisma.budgetChangeLog.deleteMany({ where: { planId } }),
    prisma.budgetPlan.delete({ where: { id: planId } }),
  ])

  // If deleteAll — also clean org-level imported data
  if (deleteAll) {
    await prisma.$transaction([
      prisma.chartOfAccount.deleteMany({ where: { organizationId: orgId } }),
      prisma.salesForecast.deleteMany({ where: { organizationId: orgId } }),
      prisma.expenseForecast.deleteMany({ where: { organizationId: orgId } }),
      prisma.cashFlowEntry.deleteMany({ where: { organizationId: orgId } }),
      prisma.cashFlowAlert.deleteMany({ where: { organizationId: orgId } }),
      prisma.costComponent.deleteMany({ where: { organizationId: orgId } }),
      prisma.productLine.deleteMany({ where: { organizationId: orgId } }),
      prisma.budgetDepartment.deleteMany({ where: { organizationId: orgId } }),
      prisma.budgetCostType.deleteMany({ where: { organizationId: orgId } }),
    ])
  }

  return NextResponse.json({ success: true, deletedPlan: plan.name, deletedAll: deleteAll })
}
