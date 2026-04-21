import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { loadAndCompute } from "@/lib/cost-model/db"
import { resolveCostModelKey, resolvePatternForDept, getPeriodMonths, computePlannedForLine } from "@/lib/budgeting/cost-model-map"

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const planId = req.nextUrl.searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  const [plan, lines, manualActuals, costTypes, departments] = await Promise.all([
    prisma.budgetPlan.findFirst({ where: { id: planId, organizationId: orgId } }),
    prisma.budgetLine.findMany({
      where: { planId, organizationId: orgId },
      // account is added in Phase 2.1 — prefer it for display/grouping when set
      include: { costType: true, budgetDept: true, account: { select: { code: true, name: true } } },
    }),
    prisma.budgetActual.findMany({ where: { planId, organizationId: orgId } }),
    prisma.budgetCostType.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.budgetDepartment.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { sortOrder: "asc" } }),
  ])

  // Load cost model if any line uses auto-actual OR auto-planned
  const hasAutoActual = lines.some((l: any) => l.isAutoActual)
  const hasAutoPlanned = lines.some((l: any) => l.isAutoPlanned)
  const costModel = (hasAutoActual || hasAutoPlanned) ? await loadAndCompute(orgId).catch(() => null) : null

  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  // === Auto-planned: compute period months + load SalesForecast ===
  const { count: periodMonthCount, months: periodMonthNumbers } = getPeriodMonths(plan)
  const [salesForecasts, expenseForecasts] = hasAutoPlanned
    ? await Promise.all([
        prisma.salesForecast.findMany({
          where: { organizationId: orgId, year: plan.year, month: { in: periodMonthNumbers } },
        }),
        prisma.expenseForecast.findMany({
          where: { organizationId: orgId, year: plan.year, month: { in: periodMonthNumbers } },
        }),
      ])
    : [[], []]

  // Helper: get effective planned amount (dynamic or stored)
  function getEffectivePlanned(line: any): number {
    if (line.isAutoPlanned) {
      return computePlannedForLine(line, costModel, salesForecasts, periodMonthCount, periodMonthNumbers, expenseForecasts)
    }
    return line.plannedAmount
  }

  // Build effective actuals for auto-actual lines.
  // Simple: monthly cost model value × elapsed months in the plan period.
  // Q1 completed = ×3, Q2 just started (April) = ×1, Annual in March = ×3.
  const autoActualByCategory = new Map<string, number>()
  let autoActualTotal = 0

  if (hasAutoActual && costModel && plan) {
    const now = new Date()
    const curYear = now.getFullYear()
    const curMonth = now.getMonth() + 1

    let elapsedMonths = 1
    if (plan.periodType === "monthly") {
      elapsedMonths = 1
    } else if (plan.periodType === "quarterly" && plan.quarter) {
      const qStart = (plan.quarter - 1) * 3 + 1
      const qEnd = qStart + 2
      if (curYear > plan.year || (curYear === plan.year && curMonth > qEnd)) {
        elapsedMonths = 3 // quarter fully completed
      } else if (curYear === plan.year && curMonth >= qStart) {
        elapsedMonths = curMonth - qStart + 1 // inside quarter
      } else {
        elapsedMonths = 0 // quarter hasn't started
      }
    } else if (plan.periodType === "annual") {
      if (curYear > plan.year) {
        elapsedMonths = 12
      } else if (curYear === plan.year) {
        elapsedMonths = curMonth
      } else {
        elapsedMonths = 0
      }
    }

    for (const line of lines) {
      if (line.isAutoActual && line.costModelKey) {
        const monthlyAmount = resolveCostModelKey(costModel, line.costModelKey)
        const amount = monthlyAmount * elapsedMonths
        const key = `${line.category}||${line.lineType}`
        autoActualByCategory.set(key, (autoActualByCategory.get(key) ?? 0) + amount)
        autoActualTotal += amount
      }
    }
  }

  // Check if BudgetForecastEntry records exist — use them for totalForecast if so
  const forecastEntries = await prisma.budgetForecastEntry.findMany({
    where: { planId, organizationId: orgId },
  })

  // Exclude parent-aggregate rows so we don't double-count. A code is a parent
  // when another code starts with "<code>-" (e.g. 601-01 is a parent of 601-01-02).
  // The imported P&L sheet contains both totals and sub-totals, so without this
  // filter `Revenue` on Workspace was ~2x what the P&L Report shows.
  const allCodes = new Set<string>(
    lines
      .map((l: any) => (l.account?.code ?? l.department ?? "").toString())
      .filter((c: string) => Boolean(c)),
  )
  const isParentCode = (code: string): boolean => {
    for (const c of allCodes) {
      if (c !== code && c.startsWith(code + "-")) return true
    }
    return false
  }
  const isLeaf = (l: any): boolean => {
    const code = l.account?.code ?? l.department ?? ""
    return !code || !isParentCode(code)
  }

  // Totals — split by expense vs revenue vs cogs (leaves only)
  const expenseLines = lines.filter((l: { lineType: string }) => l.lineType === "expense").filter(isLeaf)
  const revenueLines = lines.filter((l: { lineType: string }) => l.lineType === "revenue").filter(isLeaf)
  const cogsLines = lines.filter((l: { lineType: string }) => l.lineType === "cogs").filter(isLeaf)

  const totalExpensePlanned = expenseLines.reduce((s: number, l: any) => s + getEffectivePlanned(l), 0)
  const totalRevenuePlanned = revenueLines.reduce((s: number, l: any) => s + getEffectivePlanned(l), 0)
  // COGS totals — must be computed before totalPlanned
  const totalCOGSPlanned = cogsLines.reduce((s: number, l: any) => s + getEffectivePlanned(l), 0)
  const totalPlanned = totalExpensePlanned // OpEx only (COGS allocates same costs by service)
  const totalExpenseForecast = expenseLines.reduce((s: number, l: any) => s + (l.forecastAmount ?? getEffectivePlanned(l)), 0)
  const totalRevenueForecast = revenueLines.reduce((s: number, l: any) => s + (l.forecastAmount ?? getEffectivePlanned(l)), 0)
  // Forecast from ForecastEntries (monthly) — split by lineType
  const feRevenue = forecastEntries.filter((e: { lineType: string }) => e.lineType === "revenue")
  const feExpense = forecastEntries.filter((e: { lineType: string }) => e.lineType === "expense")
  const feCogs = forecastEntries.filter((e: { lineType: string }) => e.lineType === "cogs")
  // Use ForecastEntries when available, otherwise fall back to BudgetLine.forecastAmount
  const totalRevenueForecastFE = feRevenue.length > 0 ? feRevenue.reduce((s: number, e: { forecastAmount: number }) => s + e.forecastAmount, 0) : totalRevenueForecast
  const totalExpenseForecastFE = feExpense.length > 0 ? feExpense.reduce((s: number, e: { forecastAmount: number }) => s + e.forecastAmount, 0) : totalExpenseForecast
  const totalForecast = forecastEntries.length > 0
    ? forecastEntries.reduce((s: number, e: { forecastAmount: number }) => s + e.forecastAmount, 0)
    : totalExpenseForecast
  const manualActualTotal = manualActuals.reduce((s: number, a: { actualAmount: number }) => s + a.actualAmount, 0)

  const totalCOGSForecast = feCogs.length > 0 ? feCogs.reduce((s: number, e: { forecastAmount: number }) => s + e.forecastAmount, 0) : cogsLines.reduce((s: number, l: { forecastAmount: number | null; plannedAmount: number }) => s + (l.forecastAmount ?? l.plannedAmount), 0)

  // Split auto-actuals by type (expense, revenue, cogs) — iterate map keys to avoid double-counting
  let autoActualExpense = 0
  let autoActualRevenue = 0
  let autoActualCOGS = 0
  for (const [key, amount] of autoActualByCategory) {
    const lineType = key.split("||")[1] ?? "expense"
    if (lineType === "revenue") autoActualRevenue += amount
    else if (lineType === "cogs") autoActualCOGS += amount
    else autoActualExpense += amount
  }

  // Split manual actuals by type
  let manualExpenseActual = 0
  let manualRevenueActual = 0
  let manualCOGSActual = 0
  for (const a of manualActuals) {
    if (a.lineType === "revenue") manualRevenueActual += a.actualAmount
    else if (a.lineType === "cogs") manualCOGSActual += a.actualAmount
    else manualExpenseActual += a.actualAmount
  }

  const totalExpenseActual = autoActualExpense > 0 ? autoActualExpense : manualExpenseActual
  const totalRevenueActual = autoActualRevenue > 0 ? autoActualRevenue : manualRevenueActual
  const totalCOGSActual = autoActualCOGS > 0 ? autoActualCOGS : manualCOGSActual
  const totalActual = totalExpenseActual  // OpEx only (COGS allocates same costs by service)
  const totalAllPlanned = totalExpensePlanned

  // Financial KPIs — Operating Profit = Revenue - Expenses (COGS not added, same costs)
  const grossProfitPlanned = totalRevenuePlanned - totalExpensePlanned
  const grossProfitActual = totalRevenueActual - totalExpenseActual
  const marginPlanned = grossProfitPlanned  // Same as gross profit (no separate COGS deduction)
  const marginActual = grossProfitActual
  const marginForecast = totalRevenueForecastFE - totalExpenseForecastFE
  const totalVariance = marginActual - marginPlanned // positive = better than plan
  // Composite budget execution: 60% revenue achievement + 40% cost discipline
  // Revenue achievement: fact/plan (capped at 150%)
  // Cost discipline: plan/fact inverted — under budget is good (capped at 150%)
  const revAchievement = totalRevenuePlanned > 0
    ? Math.min((totalRevenueActual / totalRevenuePlanned) * 100, 150)
    : 100
  const costDiscipline = totalActual > 0 && totalAllPlanned > 0
    ? Math.min((totalAllPlanned / totalActual) * 100, 150)
    : 100
  const executionPct = Math.max(0, Math.round(revAchievement * 0.6 + costDiscipline * 0.4))
  const forecastVariance = totalExpenseForecast - totalActual

  // Estimate period-end projection based on elapsed time within the plan's period
  const nowDate = new Date()
  const currentMonthNum = nowDate.getMonth() + 1
  const periodMonths = plan.periodType === "annual" ? 12 : plan.periodType === "quarterly" ? 3 : 1
  // For annual: months elapsed = currentMonth. For quarterly: months elapsed within the quarter.
  // For monthly: always 1.
  let monthsElapsed = 1
  if (plan.periodType === "annual") {
    monthsElapsed = Math.max(1, currentMonthNum)
  } else if (plan.periodType === "quarterly" && plan.quarter) {
    const quarterStartMonth = (plan.quarter - 1) * 3 + 1
    monthsElapsed = Math.max(1, Math.min(3, currentMonthNum - quarterStartMonth + 1))
  }
  const yearEndProjection = totalActual > 0 ? (totalActual / monthsElapsed) * periodMonths : totalForecast
  // Margin year-end projection — project operating profit, not just expenses
  const marginYearEndProjection = monthsElapsed > 0 ? (marginActual / monthsElapsed) * periodMonths : marginPlanned

  // Build parent lookup: childCategory → parentCategory
  const parentLookup = new Map<string, string>()
  for (const l of lines) {
    if (!l.parentId) {
      // This is a parent line — register its children
      const children = lines.filter((c: any) => c.parentId === l.id)
      for (const c of children) {
        parentLookup.set(`${c.category}||${c.lineType}`, l.category)
      }
    }
  }

  // By category — merge lines, auto-actuals, and manual actuals.
  // Only count leaf lines; parent SAP-code rows like "601-01" duplicate the
  // sum of their children (e.g. "601-01-02") and would inflate byCategory.
  const categoryMap = new Map<string, { planned: number; forecast: number; actual: number; lineType: string; accountCode: string | null }>()

  for (const l of lines) {
    if (!isLeaf(l)) continue
    const key = `${l.category}||${l.lineType}`
    const existing = categoryMap.get(key) ?? { planned: 0, forecast: 0, actual: 0, lineType: l.lineType, accountCode: null }
    existing.planned += getEffectivePlanned(l)
    existing.forecast += l.forecastAmount ?? getEffectivePlanned(l)
    // Preserve SAP code so the P&L (Plan) view can split OpEx vs below-EBITDA.
    if (!existing.accountCode) {
      existing.accountCode = (l as any).account?.code ?? l.department ?? null
    }
    categoryMap.set(key, existing)
  }

  // Apply auto-actuals first
  for (const [key, amount] of autoActualByCategory) {
    const lineType = key.split("||")[1] ?? "expense"
    const existing = categoryMap.get(key) ?? { planned: 0, forecast: 0, actual: 0, lineType, accountCode: null as string | null }
    existing.actual += amount
    categoryMap.set(key, existing)
  }

  // Apply manual actuals for lines without auto-actual
  for (const a of manualActuals) {
    const key = `${a.category}||${a.lineType}`
    // Skip if auto-actual already covers this category
    if (autoActualByCategory.has(key)) continue
    const existing = categoryMap.get(key) ?? { planned: 0, forecast: 0, actual: 0, lineType: a.lineType, accountCode: null as string | null }
    existing.actual += a.actualAmount
    categoryMap.set(key, existing)
  }

  const byCategory = Array.from(categoryMap.entries()).map(([key, val]) => {
    const [category, lineType] = key.split("||")
    const variance = lineType === "revenue"
      ? val.actual - val.planned
      : val.planned - val.actual
    const variancePct = val.planned > 0 ? (variance / val.planned) * 100 : 0
    const parentCategory = parentLookup.get(key) ?? null
    return { category, lineType, planned: val.planned, forecast: val.forecast, actual: val.actual, variance, variancePct, parentCategory, accountCode: val.accountCode }
  })

  // By department — track expense and revenue separately for correct variance
  // If department field looks like a SAP code, fall back to category (which holds the name after import refactor)
  const deptMap = new Map<string, { expPlanned: number; expActual: number; revPlanned: number; revActual: number; forecast: number }>()
  const looksLikeSapCode = (s: string) => /^\d{3}(-\d+)*$/.test(s)

  const resolveDept = (l: any): string => {
    // Prefer canonical account name when FK is populated (Phase 2.1).
    if (l.account?.name) return l.account.name
    const d = l.department || ""
    if (d && !looksLikeSapCode(d)) return d
    return l.category || "General"
  }

  for (const l of lines) {
    const dept = resolveDept(l)
    const existing = deptMap.get(dept) ?? { expPlanned: 0, expActual: 0, revPlanned: 0, revActual: 0, forecast: 0 }
    existing.forecast += l.forecastAmount ?? getEffectivePlanned(l)
    if (l.lineType === "revenue") {
      existing.revPlanned += getEffectivePlanned(l)
    } else {
      existing.expPlanned += getEffectivePlanned(l)
    }
    deptMap.set(dept, existing)
  }

  // Apply auto-actuals to departments (resolve from lines that have isAutoActual + costModelKey)
  if (costModel) {
    for (const line of lines) {
      if (line.isAutoActual && line.costModelKey) {
        const dept = resolveDept(line)
        const amount = resolveCostModelKey(costModel, line.costModelKey)
        const existing = deptMap.get(dept) ?? { expPlanned: 0, expActual: 0, revPlanned: 0, revActual: 0, forecast: 0 }
        if (line.lineType === "revenue") {
          existing.revActual += amount
        } else {
          existing.expActual += amount
        }
        deptMap.set(dept, existing)
      }
    }
  }

  // Apply manual actuals for departments (skip categories covered by auto-actual)
  for (const a of manualActuals) {
    const catKey = `${a.category}||${a.lineType}`
    if (autoActualByCategory.has(catKey)) continue
    const dept = resolveDept(a)
    const existing = deptMap.get(dept) ?? { expPlanned: 0, expActual: 0, revPlanned: 0, revActual: 0, forecast: 0 }
    if (a.lineType === "revenue") {
      existing.revActual += a.actualAmount
    } else {
      existing.expActual += a.actualAmount
    }
    deptMap.set(dept, existing)
  }

  const byDepartment = Array.from(deptMap.entries()).map(([department, val]) => {
    const planned = val.expPlanned + val.revPlanned
    const actual = val.expActual + val.revActual
    // Variance: expense savings + revenue overperformance = positive
    const expVariance = val.expPlanned - val.expActual   // positive = under budget (good)
    const revVariance = val.revActual - val.revPlanned    // positive = over target (good)
    return {
      department,
      planned,
      forecast: val.forecast,
      actual,
      variance: expVariance + revVariance,
    }
  })

  // Expense execution % — how much of expense budget was spent (>100% = overspend)
  const expenseExecutionPct = totalExpensePlanned > 0 ? (totalExpenseActual / totalExpensePlanned) * 100 : 0
  // Revenue execution % — how much of revenue target was achieved (<100% = shortfall)
  const revenueExecutionPct = totalRevenuePlanned > 0 ? (totalRevenueActual / totalRevenuePlanned) * 100 : 0

  // Elapsed time % within the plan period (for time-aware execution indicator)
  let elapsedPct = 100
  if (plan.status !== "closed") {
    const now = new Date()
    const cy = now.getFullYear()
    const cm = now.getMonth() + 1
    const cd = now.getDate()
    const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate()

    if (plan.periodType === "monthly" && plan.month) {
      if (cy > plan.year || (cy === plan.year && cm > plan.month)) {
        elapsedPct = 100
      } else if (cy === plan.year && cm === plan.month) {
        elapsedPct = (cd / daysInMonth(cy, cm)) * 100
      } else {
        elapsedPct = 0
      }
    } else if (plan.periodType === "quarterly" && plan.quarter) {
      const qStart = (plan.quarter - 1) * 3 + 1
      const qEnd = qStart + 2
      if (cy > plan.year || (cy === plan.year && cm > qEnd)) {
        elapsedPct = 100
      } else if (cy === plan.year && cm >= qStart && cm <= qEnd) {
        const monthsFullyDone = cm - qStart
        const dayFraction = cd / daysInMonth(cy, cm)
        elapsedPct = ((monthsFullyDone + dayFraction) / 3) * 100
      } else {
        elapsedPct = 0
      }
    } else if (plan.periodType === "annual") {
      if (cy > plan.year) {
        elapsedPct = 100
      } else if (cy === plan.year) {
        const monthsFullyDone = cm - 1
        const dayFraction = cd / daysInMonth(cy, cm)
        elapsedPct = ((monthsFullyDone + dayFraction) / 12) * 100
      } else {
        elapsedPct = 0
      }
    }
  }

  // ═══ Matrix data: costType × department ═══
  // Build matrix only when we have costTypes and departments configured
  type MatrixCell = {
    costTypeKey: string
    costTypeLabel: string
    departmentKey: string | null
    departmentLabel: string | null
    planned: number
    actual: number
    forecast: number
    variance: number
    variancePct: number
    lineType: string
  }
  type Totals = { planned: number; actual: number; forecast: number; variance: number }

  const matrixCells: MatrixCell[] = []
  const matrixRowTotals: Record<string, Totals> = {}
  const matrixColTotals: Record<string, Totals> = {}
  const matrixGrandTotal: Totals = { planned: 0, actual: 0, forecast: 0, variance: 0 }

  if (costTypes.length > 0) {
    // Lines with matrix FK references
    const matrixLines = lines.filter((l: any) => l.costTypeId || (l.lineType === "revenue" && l.departmentId))

    // Compute auto-actual per matrix cell if cost model available
    const now2 = new Date()
    const curYear2 = now2.getFullYear()
    const curMonth2 = now2.getMonth() + 1
    let elapsedMonths2 = 1
    if (plan) {
      if (plan.periodType === "monthly") elapsedMonths2 = 1
      else if (plan.periodType === "quarterly" && plan.quarter) {
        const qStart = (plan.quarter - 1) * 3 + 1
        const qEnd = qStart + 2
        if (curYear2 > plan.year || (curYear2 === plan.year && curMonth2 > qEnd)) elapsedMonths2 = 3
        else if (curYear2 === plan.year && curMonth2 >= qStart) elapsedMonths2 = curMonth2 - qStart + 1
        else elapsedMonths2 = 0
      } else if (plan.periodType === "annual") {
        if (curYear2 > plan.year) elapsedMonths2 = 12
        else if (curYear2 === plan.year) elapsedMonths2 = curMonth2
        else elapsedMonths2 = 0
      }
    }

    // Group matrix lines by costType × department
    const cellMap = new Map<string, { planned: number; actual: number; forecast: number; lineType: string; costTypeKey: string; costTypeLabel: string; deptKey: string | null; deptLabel: string | null }>()

    for (const line of matrixLines) {
      const ct = (line as any).costType
      const dept = (line as any).budgetDept
      const ctKey = line.lineType === "revenue" ? "_revenue" : (ct?.key || "unknown")
      const ctLabel = line.lineType === "revenue" ? "Revenue" : (ct?.label || line.category)
      const cellKey = `${ctKey}||${dept?.key || "_shared"}`

      const existing = cellMap.get(cellKey) ?? {
        planned: 0, actual: 0, forecast: 0,
        lineType: line.lineType,
        costTypeKey: ctKey,
        costTypeLabel: ctLabel,
        deptKey: dept?.key || null,
        deptLabel: dept?.label || null,
      }
      existing.planned += getEffectivePlanned(line)
      existing.forecast += line.forecastAmount ?? getEffectivePlanned(line)

      // Auto-actual from cost model
      if (line.isAutoActual && costModel && ct?.costModelPattern) {
        const resolvedKey = dept?.serviceKey
          ? resolvePatternForDept(ct.costModelPattern, dept.serviceKey)
          : ct.costModelPattern.includes("{dept}") ? null : ct.costModelPattern
        if (resolvedKey) {
          const monthlyAmount = resolveCostModelKey(costModel, resolvedKey)
          existing.actual += monthlyAmount * elapsedMonths2
        }
      } else if (line.isAutoActual && costModel && line.costModelKey) {
        // Fallback: use direct costModelKey on the line
        const monthlyAmount = resolveCostModelKey(costModel, line.costModelKey)
        existing.actual += monthlyAmount * elapsedMonths2
      } else if (!line.isAutoActual) {
        // Manual actuals: look up from BudgetActual records by category+lineType
        const catKey = `${line.category}||${line.lineType}`
        const manualAmount = autoActualByCategory.has(catKey) ? 0 : (manualActuals
          .filter((a: any) => a.category === line.category && a.lineType === line.lineType)
          .reduce((s: number, a: any) => s + a.actualAmount, 0))
        existing.actual += manualAmount
      }

      cellMap.set(cellKey, existing)
    }

    // Convert cells to array and compute totals
    for (const [, cell] of cellMap) {
      const variance = cell.lineType === "revenue"
        ? cell.actual - cell.planned
        : cell.planned - cell.actual
      const variancePct = cell.planned > 0 ? (variance / cell.planned) * 100 : 0

      matrixCells.push({
        costTypeKey: cell.costTypeKey,
        costTypeLabel: cell.costTypeLabel,
        departmentKey: cell.deptKey,
        departmentLabel: cell.deptLabel,
        planned: cell.planned,
        actual: cell.actual,
        forecast: cell.forecast,
        variance,
        variancePct,
        lineType: cell.lineType,
      })

      // Row totals (by costType)
      const rt = matrixRowTotals[cell.costTypeKey] ?? { planned: 0, actual: 0, forecast: 0, variance: 0 }
      rt.planned += cell.planned
      rt.actual += cell.actual
      rt.forecast += cell.forecast
      rt.variance += variance
      matrixRowTotals[cell.costTypeKey] = rt

      // Column totals and grand total — expenses only (revenue shown separately in UI)
      if (cell.lineType !== "revenue") {
        const colKey = cell.deptKey || "_shared"
        const ct2 = matrixColTotals[colKey] ?? { planned: 0, actual: 0, forecast: 0, variance: 0 }
        ct2.planned += cell.planned
        ct2.actual += cell.actual
        ct2.forecast += cell.forecast
        ct2.variance += variance
        matrixColTotals[colKey] = ct2

        matrixGrandTotal.planned += cell.planned
        matrixGrandTotal.actual += cell.actual
        matrixGrandTotal.forecast += cell.forecast
        matrixGrandTotal.variance += variance
      }
    }
  }

  const matrix = {
    costTypes: costTypes.map((ct: any) => ({ key: ct.key, label: ct.label, isShared: ct.isShared, color: ct.color })),
    departments: departments.map((d: any) => ({ key: d.key, label: d.label, hasRevenue: d.hasRevenue, color: d.color })),
    cells: matrixCells,
    rowTotals: matrixRowTotals,
    colTotals: matrixColTotals,
    grandTotal: matrixGrandTotal,
  }

  return NextResponse.json({
    success: true,
    data: {
      plan,
      totalPlanned,
      totalForecast,
      totalActual,
      totalVariance,
      forecastVariance,
      executionPct,
      expenseExecutionPct,
      revenueExecutionPct,
      elapsedPct: Math.round(elapsedPct * 10) / 10,
      autoActualTotal,
      yearEndProjection,
      marginYearEndProjection,
      // Revenue totals (separate from expense KPIs)
      totalRevenuePlanned,
      totalRevenueForecast: totalRevenueForecastFE,
      totalRevenueActual,
      totalExpensePlanned,
      totalExpenseForecast: totalExpenseForecastFE,
      totalExpenseActual,
      margin: marginPlanned,
      marginActual: marginActual,
      marginForecast,
      totalCOGSPlanned,
      totalCOGSForecast,
      totalCOGSActual,
      grossProfit: grossProfitPlanned,
      grossProfitActual,
      byCategory,
      byDepartment,
      matrix,
      costModelTotal: costModel?.grandTotalG ?? 0,
    },
  })
}
