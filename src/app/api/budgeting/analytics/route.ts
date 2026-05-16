import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { loadAndCompute } from "@/lib/cost-model/db"
import { resolveCostModelKey, resolvePatternForDept, getPeriodMonths, computePlannedForLine } from "@/lib/budgeting/cost-model-map"
import { looksLikeSapCode } from "@/lib/import/keywords"
import { resolveCompanyFilter } from "@/lib/budgeting/company-filter"
import { getEffectivePlanned as getEffectivePlannedPure } from "@/lib/budgeting/effective-planned"
import { currentBakuYearMonth } from "@/lib/risk/periods"

/**
 * GET /api/budgeting/analytics
 *
 * Response envelope (accepted-asymmetry per Turn-30 architect ⚠️ closure
 * Turn-33.5 + Turn-Y retroactive documentation):
 *   `{success: true, data: {plan, totalPlanned, ...}}`
 *   — wrapped shape: `success` flag at root + payload nested under `data`.
 *
 * Sibling route `/api/budgeting/pnl` uses a DIFFERENT envelope:
 *   `{success: true, sections, rows, ..., year, ...}`
 *   — flat shape: `success` flag at root + payload fields at root.
 *
 * Both share `success: true` so consumers can distinguish "successful
 * empty" from "error" (architect's stated concern). Convergence on a
 * single envelope shape NOT scheduled — see `pnl/route.ts` jsdoc for
 * full rationale.
 */
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const planId = req.nextUrl.searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  // Turn 30: per-daughter-company filter. Sub-group level=1 expands to
  // children's operational ids; op-co level=2 is single-element filter.
  // null/undefined → no filter (org-wide consolidated, pre-Turn-30 behavior).
  const companyIdParam = req.nextUrl.searchParams.get("companyId")
  const companyFilter = await resolveCompanyFilter(prisma, orgId, companyIdParam)
  if (companyFilter.kind === "not_found") {
    return NextResponse.json({ error: "Company not found" }, { status: 404 })
  }

  const lineWhere: { planId: string; organizationId: string; companyId?: { in: string[] } } = {
    planId,
    organizationId: orgId,
  }
  if (companyFilter.kind === "single") {
    if (companyFilter.companyIds.length === 0) {
      // Sub-group with no children — no data to aggregate. Return empty
      // sentinel that the page can render as "no data for this branch".
      return NextResponse.json({
        success: true,
        data: { totalPlanned: 0, totalRevenuePlanned: 0, totalExpensePlanned: 0, totalCOGSPlanned: 0, byCategory: [], _emptyReason: "subgroup_no_children" },
      })
    }
    lineWhere.companyId = { in: companyFilter.companyIds }
  }

  const [plan, lines, manualActuals, costTypes, departments] = await Promise.all([
    prisma.budgetPlan.findFirst({ where: { id: planId, organizationId: orgId } }),
    prisma.budgetLine.findMany({
      where: lineWhere,
      // account is added in Phase 2.1 — prefer it for display/grouping when set
      include: { costType: true, budgetDept: true, account: { select: { code: true, name: true } } },
    }),
    // Turn 35: per-company filter for actuals (mirrors pnl/route.ts).
    // Without this, per-daughter drilldown analytics aggregated org-wide
    // actuals against per-company plan → nonsense Workspace KPI cards.
    prisma.budgetActual.findMany({
      where: companyFilter.kind === "single"
        ? { planId, organizationId: orgId, companyId: { in: companyFilter.companyIds } }
        : { planId, organizationId: orgId },
    }),
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

  // Helper: get effective planned amount (dynamic or stored).
  // Pure logic extracted to `src/lib/budgeting/effective-planned.ts` for
  // unit-testability. This wrapper binds the route's prisma-loaded context
  // (cost model, sales/expense forecasts, period months) into a thin
  // computeFn closure + adds the observability log on the fallback branch.
  // See effective-planned.test.ts for the 7 cases covering Bug #1b
  // semantics (Turn 33 architect ⚠️ test-coverage closure).
  function getEffectivePlanned(line: any): number {
    return getEffectivePlannedPure(line, (l) => {
      const computed = computePlannedForLine(l, costModel, salesForecasts, periodMonthCount, periodMonthNumbers, expenseForecasts)
      if (computed === 0 && l.plannedAmount > 0) {
        // Observability: this branch fires only on misconfiguration (auto-
        // planned flag persisted but no upstream data). Log so future
        // regressions don't silently mask data-pipeline gaps. Note: the
        // pure helper handles the FALLBACK return; we just log here BEFORE
        // it does so there's a 1:1 log:fallback correspondence.
        console.warn(
          `[analytics] getEffectivePlanned fallback fired — orgId=${orgId} planId=${planId} lineId=${l.id} category=${l.category} stored=${l.plannedAmount}`
        )
      }
      return computed
    })
  }

  // Build effective actuals for auto-actual lines.
  // Simple: monthly cost model value × elapsed months in the plan period.
  // Q1 completed = ×3, Q2 just started (April) = ×1, Annual in March = ×3.
  const autoActualByCategory = new Map<string, number>()
  // Phase 3.1 v1.2 — sister map for per-month attribution (12 floats per
  // category key). Drives the VarianceTab sparkline actual-overlay.
  const autoActualMonthlyByCategory = new Map<string, number[]>()
  let autoActualTotal = 0

  if (hasAutoActual && costModel && plan) {
    const { year: curYear, month: curMonth } = currentBakuYearMonth()

    let elapsedMonths = 1
    // Phase 3.1 v1.2 — which specific months are "elapsed" for the
    // sparkline. Auto-actuals don't have per-month detail in their
    // source (cost model is a monthly recurring amount), so we attribute
    // them to the months that were actually elapsed at request time.
    const elapsedMonthIndices: number[] = []
    if (plan.periodType === "monthly" && plan.month) {
      elapsedMonths = 1
      elapsedMonthIndices.push(plan.month - 1)
    } else if (plan.periodType === "quarterly" && plan.quarter) {
      const qStart = (plan.quarter - 1) * 3 + 1
      const qEnd = qStart + 2
      if (curYear > plan.year || (curYear === plan.year && curMonth > qEnd)) {
        elapsedMonths = 3 // quarter fully completed
        for (let m = qStart; m <= qEnd; m++) elapsedMonthIndices.push(m - 1)
      } else if (curYear === plan.year && curMonth >= qStart) {
        elapsedMonths = curMonth - qStart + 1 // inside quarter
        for (let m = qStart; m <= curMonth; m++) elapsedMonthIndices.push(m - 1)
      } else {
        elapsedMonths = 0 // quarter hasn't started
      }
    } else if (plan.periodType === "annual") {
      if (curYear > plan.year) {
        elapsedMonths = 12
        for (let m = 1; m <= 12; m++) elapsedMonthIndices.push(m - 1)
      } else if (curYear === plan.year) {
        elapsedMonths = curMonth
        for (let m = 1; m <= curMonth; m++) elapsedMonthIndices.push(m - 1)
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
        // Phase 3.1 v1.2 — attribute one monthlyAmount per elapsed month.
        const monthly = autoActualMonthlyByCategory.get(key) ?? Array(12).fill(0)
        for (const idx of elapsedMonthIndices) monthly[idx] += monthlyAmount
        autoActualMonthlyByCategory.set(key, monthly)
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
  //
  // Turn 30 (org-wide consolidation under-count fix): parent detection is
  // scoped PER-COMPANY. Multiple companies share the same SAP-style account
  // codespace (60x revenue / 70x COGS / 72x OpEx etc.); without per-company
  // scoping, company A's "601" total looked like a parent of company B's
  // "601-04-99" leaf and got dropped, dramatically under-counting the org-
  // wide aggregate. The original assumption (one company's xlsx contains
  // both totals + sub-totals → dedup the totals) is preserved within each
  // company, but cross-company aliasing no longer fires. Lines without a
  // companyId (legacy / unassigned) all share an empty-string bucket so
  // their dedup behaviour is unchanged from the pre-Turn-30 era.
  const codesByCompany = new Map<string, Set<string>>()
  for (const l of lines as any[]) {
    const code = (l.account?.code ?? l.department ?? "").toString()
    if (!code) continue
    const cid = l.companyId ?? ""
    let bucket = codesByCompany.get(cid)
    if (!bucket) {
      bucket = new Set<string>()
      codesByCompany.set(cid, bucket)
    }
    bucket.add(code)
  }
  const isParentCodeFor = (code: string, companyId: string | null | undefined): boolean => {
    // Turn 36 fix: skip parent-detection for synthetic ROLLUP-* codes (same
    // rationale as pnl/route.ts) — flat semantic categories, not hierarchy.
    if (code.startsWith("ROLLUP-")) return false
    const bucket = codesByCompany.get(companyId ?? "")
    if (!bucket) return false
    for (const c of bucket) {
      if (c !== code && c.startsWith(code + "-")) return true
    }
    return false
  }
  const isLeaf = (l: any): boolean => {
    const code = l.account?.code ?? l.department ?? ""
    return !code || !isParentCodeFor(code, l.companyId)
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
  // Key INCLUDES SAP accountCode because several codes in the AAC chart share
  // the same human-readable category name (e.g. "Sair xərclər" appears under
  // 711-09-99, 721-09-99 and 731-01-99). Merging them by name misclassifies
  // OpEx vs below-EBITDA by thousands of manat.
  const categoryMap = new Map<string, { planned: number; forecast: number; actual: number; lineType: string; accountCode: string | null; displayCategory: string; monthlyPlanned: number[]; monthlyActual: number[] }>()

  for (const l of lines) {
    if (!isLeaf(l)) continue
    const code = (l as any).account?.code ?? l.department ?? null
    const key = `${code ?? l.category}||${l.lineType}`
    const existing = categoryMap.get(key) ?? { planned: 0, forecast: 0, actual: 0, lineType: l.lineType, accountCode: code, displayCategory: l.category, monthlyPlanned: Array(12).fill(0), monthlyActual: Array(12).fill(0) }
    const planned = getEffectivePlanned(l)
    existing.planned += planned
    existing.forecast += l.forecastAmount ?? planned
    // Phase 3.1 v1.1 (Turn LIX deferral closure) — bucket the planned
    // amount into the correct month for sparkline rendering. `monthIndex`
    // is 0-indexed (0=Jan..11=Dec). Pre-Phase-A rows fall back to
    // `sortOrder % 100` per the schema docstring. Out-of-range or null →
    // bucket 0 (Jan) as a defensive default; better than dropping the
    // row's planned amount from the sparkline entirely.
    const lAny = l as { monthIndex?: number | null; sortOrder?: number | null }
    const rawIdx = lAny.monthIndex ?? (typeof lAny.sortOrder === "number" ? lAny.sortOrder % 100 : null)
    const monthIdx = rawIdx != null && rawIdx >= 0 && rawIdx < 12 ? rawIdx : 0
    existing.monthlyPlanned[monthIdx] += planned
    categoryMap.set(key, existing)
  }

  // Actuals are keyed by `${category}||${lineType}` (legacy) while categoryMap
  // is now keyed by `${code}||${lineType}`. Try the legacy category key for
  // each map entry when applying actuals so we don't miss them entirely.
  const categoryToKeysIndex = new Map<string, string[]>()
  for (const [key, val] of categoryMap) {
    const legacyKey = `${val.displayCategory}||${val.lineType}`
    const arr = categoryToKeysIndex.get(legacyKey) ?? []
    arr.push(key)
    categoryToKeysIndex.set(legacyKey, arr)
  }

  // Apply auto-actuals first — spread across matching entries proportionally
  // to their planned amount. For demo data with zero actuals this is a no-op.
  for (const [legacyKey, amount] of autoActualByCategory) {
    const codeKeys = categoryToKeysIndex.get(legacyKey) ?? []
    const totalPlanned = codeKeys.reduce((s, k) => s + (categoryMap.get(k)?.planned ?? 0), 0)
    // Phase 3.1 v1.2 — paired monthly amounts (12 floats) per legacy
    // key. Same proportional-spread strategy as the annual amount, but
    // attributed per month so the sparkline overlay shows real shape.
    const monthlyArr = autoActualMonthlyByCategory.get(legacyKey) ?? Array(12).fill(0)
    if (totalPlanned > 0) {
      for (const k of codeKeys) {
        const entry = categoryMap.get(k)!
        const share = entry.planned / totalPlanned
        entry.actual += amount * share
        for (let i = 0; i < 12; i++) entry.monthlyActual[i] += monthlyArr[i] * share
      }
    } else if (codeKeys.length > 0) {
      // Fallback: put all of it on the first matching entry
      const entry = categoryMap.get(codeKeys[0])!
      entry.actual += amount
      for (let i = 0; i < 12; i++) entry.monthlyActual[i] += monthlyArr[i]
    }
  }

  // Apply manual actuals for lines without auto-actual (same strategy)
  for (const a of manualActuals) {
    const legacyKey = `${a.category}||${a.lineType}`
    if (autoActualByCategory.has(legacyKey)) continue
    const codeKeys = categoryToKeysIndex.get(legacyKey) ?? []
    const totalPlanned = codeKeys.reduce((s, k) => s + (categoryMap.get(k)?.planned ?? 0), 0)
    // Phase 3.1 v1.2 — manual actuals carry monthIndex (post-migration
    // writers stamp it; pre-migration legacy rows are null and skip the
    // sparkline attribution). When null, the year-aggregate still
    // contributes via the existing `entry.actual` path.
    const aRow = a as { monthIndex?: number | null }
    const mIdx = typeof aRow.monthIndex === "number" && aRow.monthIndex >= 0 && aRow.monthIndex < 12 ? aRow.monthIndex : null
    if (totalPlanned > 0) {
      for (const k of codeKeys) {
        const entry = categoryMap.get(k)!
        const share = entry.planned / totalPlanned
        entry.actual += a.actualAmount * share
        if (mIdx != null) entry.monthlyActual[mIdx] += a.actualAmount * share
      }
    } else if (codeKeys.length > 0) {
      const entry = categoryMap.get(codeKeys[0])!
      entry.actual += a.actualAmount
      if (mIdx != null) entry.monthlyActual[mIdx] += a.actualAmount
    }
  }

  const byCategory = Array.from(categoryMap.entries()).map(([key, val]) => {
    const [, lineType] = key.split("||")
    const variance = lineType === "revenue"
      ? val.actual - val.planned
      : val.planned - val.actual
    const variancePct = val.planned > 0 ? (variance / val.planned) * 100 : 0
    // parentLookup is keyed by the legacy "category||lineType" — rebuild the
    // legacy key from our display name so existing children/parent wiring holds.
    const legacyKey = `${val.displayCategory}||${val.lineType}`
    const parentCategory = parentLookup.get(legacyKey) ?? null
    return { category: val.displayCategory, lineType, planned: val.planned, forecast: val.forecast, actual: val.actual, variance, variancePct, parentCategory, accountCode: val.accountCode, monthlyPlanned: val.monthlyPlanned, monthlyActual: val.monthlyActual }
  })

  // By department — track expense and revenue separately for correct variance
  // If department field looks like a SAP code, fall back to category (which holds the name after import refactor)
  const deptMap = new Map<string, { expPlanned: number; expActual: number; revPlanned: number; revActual: number; forecast: number }>()
  // Turn LXV — `looksLikeSapCode` from shared `@/lib/import/keywords` catalog.

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
    // Year + month anchored to Asia/Baku; day-of-month from local Date is
    // close-enough (the off-by-one only affects the last ~4 hours of UTC
    // day-end, where a 1-day-off elapsed-pct is rounding-noise).
    const { year: cy, month: cm } = currentBakuYearMonth()
    const cd = new Date().getDate()
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
    const { year: curYear2, month: curMonth2 } = currentBakuYearMonth()
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
