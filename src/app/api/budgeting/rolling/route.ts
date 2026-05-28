import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z, ZodError } from "zod"
import { getOrgId, getSession, requireRole, isAuthError } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { loadAndCompute } from "@/lib/cost-model/db"
import { findFirstActiveLockInPeriods } from "@/lib/budgeting/period-lock"
import { lockedResponse, containingPeriodKeysForMonths, containingPeriodKeys } from "@/lib/budgeting/period-lock-http"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("api:budgeting:rolling")

// Phase 8 D3(f) (2026-05-28) — typed shapes for the Prisma queries
// in this route. Replaces the 15 `(sl as any)` / `(line as any).account` /
// `forecastEntries: any[]` / `(m: any) => …` casts that were
// undoing the type safety Prisma already provides.
type BudgetLineWithAccount = Prisma.BudgetLineGetPayload<{
  include: { account: { select: { code: true; name: true } } }
}>
type RollingForecastMonthRow = Prisma.RollingForecastMonthGetPayload<true>
type BudgetActualRow = Prisma.BudgetActualGetPayload<true>
type BudgetForecastEntryRow = Prisma.BudgetForecastEntryGetPayload<true>
type ForecastCreateInput = Prisma.BudgetForecastEntryCreateManyInput

/** Narrow an unknown service-detail field to a finite number, default 0.
 *  costModel.serviceDetails is `Record<string, any>` from the stub
 *  loadAndCompute() — until that gets a real type we narrow at the edge. */
function asNum(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback
}

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
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { orgId, userId } = session

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

  // Phase 7.G Turn LXIX (Phase 4.2 bulk-mutation gate). A rolling plan
  // creation writes 12 months of forecast entries into period containers
  // year+quarter+month. Reject if any of those containers is locked.
  const targetMonths: { year: number; month: number }[] = []
  let py = startYear
  let pm = startMonth
  for (let i = 0; i < rollingMonths; i++) {
    targetMonths.push({ year: py, month: pm })
    pm++
    if (pm > 12) { pm = 1; py++ }
  }
  const rollLock = await findFirstActiveLockInPeriods(prisma, orgId, containingPeriodKeysForMonths(targetMonths))
  if (rollLock) return lockedResponse(rollLock, { prisma, orgId, userId, route: "POST /api/budgeting/rolling" })

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
    const sourceLines: BudgetLineWithAccount[] = await prisma.budgetLine.findMany({ where: { planId: sourcePlan.id }, include: { account: { select: { code: true, name: true } } } })

    // Clone parent lines first, then children with mapped parentId
    const parentLines = sourceLines.filter((sl: BudgetLineWithAccount) => !sl.parentId)
    const childLines = sourceLines.filter((sl: BudgetLineWithAccount) => sl.parentId)
    const idMapping = new Map<string, string>()

    for (const sl of parentLines) {
      const created = await prisma.budgetLine.create({
        data: {
          organizationId: orgId, planId: plan.id,
          department: sl.department, lineType: sl.lineType,
          plannedAmount: 0, costModelKey: sl.costModelKey,
          isAutoActual: false, isAutoPlanned: false,
          notes: sl.notes, sortOrder: sl.sortOrder,
          // Phase 7.G Turn XL architect Suggestion: pass through
          // monthIndex on rolling-forecast clone so monthly tagging
          // survives the rolling roll-forward.
          monthIndex: sl.monthIndex ?? null,
          // Phase 2.1 session 3: accountId is NOT NULL — pass through directly.
          accountId: sl.accountId,
          lineSubtype: sl.lineSubtype, parentId: null,
        },
      })
      idMapping.set(sl.id, created.id)
    }

    for (const sl of childLines) {
      const newParentId = sl.parentId ? idMapping.get(sl.parentId) ?? null : null
      await prisma.budgetLine.create({
        data: {
          organizationId: orgId, planId: plan.id,
          department: sl.department, lineType: sl.lineType,
          plannedAmount: sl.plannedAmount, costModelKey: sl.costModelKey,
          isAutoActual: false, isAutoPlanned: false,
          notes: sl.notes, sortOrder: sl.sortOrder,
          // Phase 7.G Turn XL architect Suggestion: same pass-through for child rows.
          monthIndex: sl.monthIndex ?? null,
          // Phase 2.1 session 3: accountId is NOT NULL — pass through directly.
          accountId: sl.accountId,
          lineSubtype: sl.lineSubtype, parentId: newParentId,
        },
      })
    }
  }

  // Auto-populate: fill forecast entries from cost model for all 12 months
  try {
    const costModel = await loadAndCompute(orgId)
    const lines: BudgetLineWithAccount[] = await prisma.budgetLine.findMany({ where: { planId: plan.id }, include: { account: { select: { code: true, name: true } } } })
    const forecastEntries: ForecastCreateInput[] = []

    for (const line of lines) {
      let monthlyAmount = 0

      if (line.lineType === "revenue") {
        // Find matching service revenue by account name (or code as fallback)
        const lineDisplayName = line.account?.name ?? line.account?.code ?? ""
        for (const [svc, category] of Object.entries(SVC_REVENUE_MAP)) {
          if (lineDisplayName === category) {
            monthlyAmount = (costModel.serviceRevenues as Record<string, number>)?.[svc] ?? 0
            break
          }
        }
      } else if (line.costModelKey) {
        // Expense: resolve from cost model
        const parts = line.costModelKey.split(".")
        if (parts[0] === "serviceDetails" && parts.length === 3) {
          const detail = costModel.serviceDetails[parts[1]] as Record<string, unknown> | undefined
          if (detail && parts[2] in detail) {
            monthlyAmount = asNum(detail[parts[2]])
          }
        }
      }

      if (monthlyAmount > 0) {
        // BudgetForecastEntry.category is a legacy string field that still exists —
        // populate with account.code (canonical ID key) instead of the dropped BudgetLine.category.
        const accountCode = line.account?.code ?? ""
        for (const me of monthEntries) {
          forecastEntries.push({
            organizationId: orgId,
            planId: plan.id,
            year: me.year,
            month: me.month,
            category: accountCode,
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
    log.error("Rolling auto-populate forecast error", {
      planId: plan.id,
      err: e instanceof Error ? e.message : String(e),
    })
  }

  return NextResponse.json({ success: true, data: plan }, { status: 201 })
}

// PATCH — close or reopen a rolling forecast month.
//
// SECURITY (Phase A leftover, Turn 25 cont'd Day 1): tightened from
// `getOrgId` (any authenticated user) to `requireRole("manager")`.
// Closing a month locks forecast data into actuals (status='actual',
// lockedAt=now); reopening rolls back the lock. Both change the org's
// view of historical data — viewers/editors should not flip these
// flags. Same-class action as `plans/[id]` PUT approve/reject which
// already requires manager+.
export async function PATCH(req: NextRequest) {
  const session = await requireRole(req, "manager")
  if (isAuthError(session)) return session
  const { orgId } = session

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

  // Phase 7.G Turn LXIX (Phase 4.2 bulk-mutation gate). PATCH close/reopen
  // mutates the rolling plan's status for a SPECIFIC year/month. Reject if
  // that month's containing periods (year/quarter/month) are locked at the
  // org level. NOTE: a "close" action transitions the rolling forecast
  // month into actual state — this is conceptually an internal lock-by-
  // rolling-status, separate from the org's `lockedPeriods`. We still
  // gate on org-level locks because the action also creates/deletes
  // forecast entries (rolling roll-forward / rollback), which are real
  // mutations into the org's budget data.
  const patchLock = await findFirstActiveLockInPeriods(prisma, orgId, containingPeriodKeys(year, month))
  if (patchLock) return lockedResponse(patchLock, { prisma, orgId, userId: session.userId, route: "PATCH /api/budgeting/rolling" })

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
        data: sampleForecasts.map((f: BudgetForecastEntryRow) => ({
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

  // Build blended data per month — separate revenue and expense.
  // Each rolling month gets typed as RollingForecastMonthRow; actuals
  // and forecasts are the plain Prisma row types. No `any` cascades.
  const blended = (months as RollingForecastMonthRow[]).map((m) => {
    const monthActuals = (actuals as BudgetActualRow[]).filter((a) => {
      if (!a.expenseDate) return false
      const d = new Date(a.expenseDate)
      return d.getFullYear() === m.year && d.getMonth() + 1 === m.month
    })
    const monthForecasts = (forecasts as BudgetForecastEntryRow[]).filter((f) => f.year === m.year && f.month === m.month)

    const actualRevenue = monthActuals.filter((a) => a.lineType === "revenue").reduce((s, a) => s + a.actualAmount, 0)
    const actualExpense = monthActuals.filter((a) => a.lineType === "expense").reduce((s, a) => s + a.actualAmount, 0)
    const forecastRevenue = monthForecasts.filter((f) => f.lineType === "revenue").reduce((s, f) => s + f.forecastAmount, 0)
    const forecastExpense = monthForecasts.filter((f) => f.lineType === "expense").reduce((s, f) => s + f.forecastAmount, 0)

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

  const totals = blended.reduce(
    (acc, m) => ({
      revenue: acc.revenue + m.revenue,
      expense: acc.expense + m.expense,
      margin: acc.margin + m.margin,
    }),
    { revenue: 0, expense: 0, margin: 0 },
  )

  return NextResponse.json({
    plan,
    months: blended,
    lineCount: lines.length,
    ...totals,
  })
}
