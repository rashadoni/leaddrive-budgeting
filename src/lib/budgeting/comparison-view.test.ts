import { describe, expect, it } from "vitest"
import {
  aggregateActualAvailable,
  categoryActualAvailable,
  chooseGuideComparisonPairIds,
  comparisonCategoryKey,
  formatComparisonAmount,
  formatComparisonDecimal,
  lineTypeActualAvailable,
  orderComparisonCategories,
  planHasRows,
  plansAreComparable,
  resolveLineTypeActualTotal,
} from "./comparison-view"
import type { BudgetAnalytics, BudgetCategoryRow, BudgetPlan } from "./types"

const plan = (input: Partial<BudgetPlan> & Pick<BudgetPlan, "id" | "name" | "year">): BudgetPlan => ({
  organizationId: "org",
  status: "approved",
  periodType: "annual",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...input,
})

const row = (category: string, planned: number, actualAvailable?: boolean): BudgetCategoryRow => ({
  category,
  lineType: "expense",
  planned,
  forecast: 0,
  actual: 0,
  variance: 0,
  variancePct: 0,
  actualAvailable,
})

const analytics = (rows: BudgetCategoryRow[], extra: Partial<BudgetAnalytics> = {}): BudgetAnalytics => ({
  plan: plan({ id: "p", name: "Plan", year: 2026, periodType: "annual", kind: "budget" }),
  totalPlanned: rows.reduce((sum, item) => sum + item.planned, 0),
  totalForecast: 0,
  totalActual: 0,
  totalVariance: 0,
  forecastVariance: 0,
  executionPct: 0,
  expenseExecutionPct: 0,
  revenueExecutionPct: 0,
  elapsedPct: 0,
  autoActualTotal: 0,
  yearEndProjection: 0,
  marginYearEndProjection: 0,
  totalExpensePlanned: 0,
  totalExpenseForecast: 0,
  totalExpenseActual: 0,
  totalRevenuePlanned: 0,
  totalRevenueForecast: 0,
  totalRevenueActual: 0,
  margin: 0,
  marginActual: 0,
  totalCOGSPlanned: 0,
  totalCOGSForecast: 0,
  totalCOGSActual: 0,
  grossProfit: 0,
  grossProfitActual: 0,
  marginForecast: 0,
  byCategory: rows,
  byDepartment: [],
  costModelTotal: 0,
  ...extra,
})

describe("comparison-view evidence helpers", () => {
  it("formats locale-aware amounts without inventing a currency", () => {
    expect(formatComparisonAmount(1_234_567, "en", null)).toBe("1,234,567")
    expect(formatComparisonAmount(1_234_567, "ru", null, true)).toMatch(/1,2\s*млн/)
    expect(formatComparisonAmount(1_234_567, "en", "USD", true)).toBe("1.2M USD")
    expect(formatComparisonDecimal(35.2, "ru")).toBe("35,2")
  })

  it("preserves explicit zero actual evidence and rejects an absent placeholder", () => {
    const available = row("Known zero", 100, true)
    const absent = row("Missing", 100, false)
    const view = analytics([available, absent])
    expect(categoryActualAvailable(view, available)).toBe(true)
    expect(categoryActualAvailable(view, absent)).toBe(false)
    expect(aggregateActualAvailable(view)).toBe(true)
  })

  it("does not treat a zero aggregate as evidence without an explicit signal", () => {
    expect(aggregateActualAvailable(analytics([row("Missing", 100, false)]))).toBe(false)
    expect(aggregateActualAvailable(analytics([row("Legacy", 100)], { totalActual: 10 }))).toBe(true)
  })

  it("treats an actuals plan as evidence even when every value is zero", () => {
    const actuals = analytics([row("Zero", 0)], {
      plan: plan({ id: "a", name: "Actuals", year: 2026, periodType: "annual", kind: "actual" }),
    })
    expect(categoryActualAvailable(actuals, actuals.byCategory[0])).toBe(true)
    expect(aggregateActualAvailable(actuals)).toBe(true)
    expect(lineTypeActualAvailable(actuals, "expense")).toBe(true)
    expect(resolveLineTypeActualTotal(actuals, "expense")).toEqual({ available: true, amount: 0 })
  })

  it("orders every unique category by maximum cross-plan magnitude", () => {
    const first = analytics([row("Small", 5), row("Largest", 100)])
    const second = analytics([row("Medium", 30), row("Small", 50)])
    expect(orderComparisonCategories([first, second]).map((item) => item.label)).toEqual(["Largest", "Small", "Medium"])
  })

  it("does not collapse duplicate display names backed by different account codes", () => {
    const first = { ...row("Other expense", 100), accountCode: "7210" }
    const second = { ...row("Other expense", 50), accountCode: "7220" }
    expect(comparisonCategoryKey(first)).not.toBe(comparisonCategoryKey(second))
    expect(orderComparisonCategories([analytics([first, second])])).toHaveLength(2)
  })

  it("allows only the same kind and period basis and prefers annual budgets for the guide", () => {
    const annualBudget = (id: string, year: number) => plan({ id, name: id, year, periodType: "annual", kind: "budget" })
    const plans = [
      { ...annualBudget("b26", 2026), _count: { lines: 100 } },
      plan({ id: "a26", name: "Actual", year: 2026, periodType: "annual", kind: "actual", _count: { lines: 100 } }),
      plan({ id: "m26", name: "June", year: 2026, periodType: "monthly", month: 6, kind: "budget" }),
      { ...annualBudget("b25", 2025), _count: { lines: 100 } },
    ]
    expect(plansAreComparable(plans[0], plans[3])).toBe(true)
    expect(plansAreComparable(plans[0], plans[1])).toBe(false)
    expect(plansAreComparable(plans[0], plans[2])).toBe(false)
    expect(chooseGuideComparisonPairIds(plans)).toEqual(["b26", "b25"])
  })

  it("disables evidenced empty plans and falls back to populated annual actuals for the guide", () => {
    const plans = [
      plan({ id: "b26", name: "Budget 2026", year: 2026, kind: "budget", _count: { lines: 134 } }),
      plan({ id: "b25", name: "Budget 2025", year: 2025, kind: "budget", _count: { lines: 0 } }),
      plan({ id: "a26", name: "Actuals 2026", year: 2026, kind: "actual", _count: { lines: 934 } }),
      plan({ id: "a25", name: "Actuals 2025", year: 2025, kind: "actual", _count: { lines: 2125 } }),
    ]
    expect(planHasRows(plans[1])).toBe(false)
    expect(chooseGuideComparisonPairIds(plans)).toEqual(["a26", "a25"])
  })
})
