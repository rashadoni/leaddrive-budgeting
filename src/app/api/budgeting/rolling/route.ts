import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { loadAndCompute } from "@/lib/cost-model/db"

const createRollingSchema = z.object({
  name: z.string().min(1).max(500),
  startYear: z.number().int().min(2020).max(2050),
  startMonth: z.number().int().min(1).max(12),
  rollingMonths: z.number().int().min(1).max(60).optional(),
}).strict()

const patchRollingSchema = z.object({
  planId: z.string().min(1).max(100),
  year: z.number().int().min(2020).max(2050),
  month: z.number().int().min(1).max(12),
  action: z.enum(["close", "reopen"]).optional(),
}).strict()

const SVC_REVENUE_MAP: Record<string, string> = {
  permanent_it: "Daimi IT", infosec: "InfoSec",
  erp: "ERP", grc: "GRC", projects: "PM",
  helpdesk: "HelpDesk", cloud: "Cloud", waf: "WAF",
}

// POST — create a rolling forecast plan with 12 months + auto-populate from cost model
export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try {
    data = createRollingSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { name, startYear, startMonth, rollingMonths = 12 } = data

  // Create rolling plan
  const plan = await prisma.budgetPlan.create({
    data: {
      organizationId: orgId,
      name,
      periodType: "monthly",
      year: startYear,
      month: startMonth,
      isRolling: true,
      rollingMonths,
      status: "draft",
    },
  })

  // Create month entries
  const monthEntries: { organizationId: string; planId: string; year: number; month: number; status: string }[] = []
  let y = startYear
  let m = startMonth
  for (let i = 0; i < rollingMonths; i++) {
    monthEntries.push({ organizationId: orgId, planId: plan.id, year: y, month: m, status: "forecast" })
    m++
    if (m > 12) { m = 1; y++ }
  }
  await prisma.rollingForecastMonth.createMany({ data: monthEntries })

  // Auto-populate: clone budget lines from existing plan
  const sourcePlan = await prisma.budgetPlan.findFirst({
    where: { organizationId: orgId, id: { not: plan.id }, isRolling: false },
    orderBy: { createdAt: "asc" },
  })

  if (sourcePlan) {
    const sourceLines = await prisma.budgetLine.findMany({ where: { planId: sourcePlan.id } })

    // Clone parent lines first, then children with mapped parentId
    const parentLines = sourceLines.filter((sl: any) => !sl.parentId)
    const childLines = sourceLines.filter((sl: any) => sl.parentId)
    const idMapping = new Map<string, string>()

    for (const sl of parentLines) {
      const created = await prisma.budgetLine.create({
        data: {
          organizationId: orgId, planId: plan.id, category: sl.category,
          department: sl.department, lineType: sl.lineType,
          plannedAmount: 0, costModelKey: sl.costModelKey,
          isAutoActual: false, isAutoPlanned: false,
          notes: sl.notes, sortOrder: sl.sortOrder,
          lineSubtype: sl.lineSubtype, parentId: null,
        },
      })
      idMapping.set(sl.id, created.id)
    }

    for (const sl of childLines) {
      const newParentId = sl.parentId ? idMapping.get(sl.parentId) ?? null : null
      await prisma.budgetLine.create({
        data: {
          organizationId: orgId, planId: plan.id, category: sl.category,
          department: sl.department, lineType: sl.lineType,
          plannedAmount: sl.plannedAmount, costModelKey: sl.costModelKey,
          isAutoActual: false, isAutoPlanned: false,
          notes: sl.notes, sortOrder: sl.sortOrder,
          lineSubtype: sl.lineSubtype, parentId: newParentId,
        },
      })
    }
  }

  // Auto-populate: fill forecast entries from cost model for all 12 months
  try {
    const costModel = await loadAndCompute(orgId)
    const lines = await prisma.budgetLine.findMany({ where: { planId: plan.id } })
    const forecastEntries: any[] = []

    for (const line of lines) {
      let monthlyAmount = 0

      if (line.lineType === "revenue") {
        // Find matching service revenue
        for (const [svc, category] of Object.entries(SVC_REVENUE_MAP)) {
          if (line.category === category) {
            monthlyAmount = costModel.serviceRevenues[svc] ?? 0
            break
          }
        }
      } else if (line.costModelKey) {
        // Expense: resolve from cost model
        const parts = line.costModelKey.split(".")
        if (parts[0] === "serviceDetails" && parts.length === 3) {
          const detail = costModel.serviceDetails[parts[1]]
          if (detail && parts[2] in detail) {
            monthlyAmount = (detail as any)[parts[2]] ?? 0
          }
        }
      }

      if (monthlyAmount > 0) {
        for (const me of monthEntries) {
          forecastEntries.push({
            organizationId: orgId,
            planId: plan.id,
            year: me.year,
            month: me.month,
            category: line.category,
            lineType: line.lineType,
            forecastAmount: Math.round(monthlyAmount * 100) / 100,
          })
        }
      }
    }

    if (forecastEntries.length > 0) {
      await prisma.budgetForecastEntry.createMany({ data: forecastEntries })
    }
  } catch (e) {
    // Cost model may not exist for this org — plan still created, just without forecasts
    console.error("Rolling auto-populate forecast error:", e)
  }

  return NextResponse.json({ success: true, data: plan }, { status: 201 })
}

// PATCH — close or reopen a rolling forecast month
export async function PATCH(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let patchBody
  try {
    patchBody = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let patchData
  try {
    patchData = patchRollingSchema.parse(patchBody)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { planId, year, month, action = "close" } = patchData

  const plan = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId, isRolling: true },
  })
  if (!plan) return NextResponse.json({ error: "Rolling plan not found" }, { status: 404 })

  if (action === "reopen") {
    // Reopen: set month back to forecast
    const updated = await prisma.rollingForecastMonth.update({
      where: { planId_year_month: { planId, year, month } },
      data: { status: "forecast", lockedAt: null },
    })

    // Remove the last forecast month (reverse of close adding a month)
    const allMonths = await prisma.rollingForecastMonth.findMany({
      where: { planId, organizationId: orgId },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    })
    if (allMonths.length > 12) {
      const lastMonth = allMonths[allMonths.length - 1]
      if (lastMonth.status === "forecast") {
        // Delete forecast entries for this month
        await prisma.budgetForecastEntry.deleteMany({
          where: { planId, year: lastMonth.year, month: lastMonth.month },
        })
        await prisma.rollingForecastMonth.delete({
          where: { planId_year_month: { planId, year: lastMonth.year, month: lastMonth.month } },
        })
      }
    }

    return NextResponse.json({ success: true, data: updated })
  }

  // Close the month
  const updated = await prisma.rollingForecastMonth.update({
    where: { planId_year_month: { planId, year, month } },
    data: { status: "actual", lockedAt: new Date() },
  })

  // Add a new month at the end (true rolling behavior)
  const allMonths = await prisma.rollingForecastMonth.findMany({
    where: { planId, organizationId: orgId },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  })
  const last = allMonths[allMonths.length - 1]
  let nextYear = last.year
  let nextMonth = last.month + 1
  if (nextMonth > 12) { nextMonth = 1; nextYear++ }

  const exists = await prisma.rollingForecastMonth.findUnique({
    where: { planId_year_month: { planId, year: nextYear, month: nextMonth } },
  })
  if (!exists) {
    await prisma.rollingForecastMonth.create({
      data: { organizationId: orgId, planId, year: nextYear, month: nextMonth, status: "forecast" },
    })

    // Copy forecast entries from an existing month for the new month
    const sampleForecasts = await prisma.budgetForecastEntry.findMany({
      where: { planId, organizationId: orgId, year: allMonths[0].year, month: allMonths[0].month },
    })
    if (sampleForecasts.length > 0) {
      await prisma.budgetForecastEntry.createMany({
        data: sampleForecasts.map((f: any) => ({
          organizationId: orgId,
          planId,
          year: nextYear,
          month: nextMonth,
          category: f.category,
          lineType: f.lineType,
          forecastAmount: f.forecastAmount,
        })),
      })
    }
  }

  return NextResponse.json({ success: true, data: updated })
}

// GET — get rolling forecast data (blended actuals + forecast)
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const planId = req.nextUrl.searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  const plan = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId, isRolling: true },
  })
  if (!plan) return NextResponse.json({ error: "Rolling plan not found" }, { status: 404 })

  const months = await prisma.rollingForecastMonth.findMany({
    where: { planId, organizationId: orgId },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  })

  // Get actuals and forecast entries for these months
  const lines = await prisma.budgetLine.findMany({
    where: { planId, organizationId: orgId },
  })

  // Pull actuals from ALL plans in the org (not just rolling plan)
  // so Q1/Q2 actuals automatically appear in rolling view
  const actuals = await prisma.budgetActual.findMany({
    where: { organizationId: orgId },
  })

  const forecasts = await prisma.budgetForecastEntry.findMany({
    where: { planId, organizationId: orgId },
  })

  // Build blended data per month — separate revenue and expense
  const blended = months.map((m: any) => {
    const monthActuals = actuals.filter((a: any) => {
      if (!a.expenseDate) return false
      const d = new Date(a.expenseDate)
      return d.getFullYear() === m.year && d.getMonth() + 1 === m.month
    })
    const monthForecasts = forecasts.filter((f: any) => f.year === m.year && f.month === m.month)

    const actualRevenue = monthActuals.filter((a: any) => a.lineType === "revenue").reduce((s: number, a: any) => s + a.actualAmount, 0)
    const actualExpense = monthActuals.filter((a: any) => a.lineType === "expense").reduce((s: number, a: any) => s + a.actualAmount, 0)
    const forecastRevenue = monthForecasts.filter((f: any) => f.lineType === "revenue").reduce((s: number, f: any) => s + f.forecastAmount, 0)
    const forecastExpense = monthForecasts.filter((f: any) => f.lineType === "expense").reduce((s: number, f: any) => s + f.forecastAmount, 0)

    const hasActuals = (actualRevenue + actualExpense) > 0
    const revenue = hasActuals ? actualRevenue : forecastRevenue
    const expense = hasActuals ? actualExpense : forecastExpense
    const margin = revenue - expense

    return {
      year: m.year,
      month: m.month,
      status: hasActuals ? "actual" : m.status,
      lockedAt: m.lockedAt,
      revenue,
      expense,
      margin,
      total: margin,
    }
  })

  const totals = blended.reduce((acc: { revenue: number; expense: number; margin: number }, m: any) => ({
    revenue: acc.revenue + m.revenue,
    expense: acc.expense + m.expense,
    margin: acc.margin + m.margin,
  }), { revenue: 0, expense: 0, margin: 0 })

  return NextResponse.json({
    plan,
    months: blended,
    lineCount: lines.length,
    ...totals,
  })
}
