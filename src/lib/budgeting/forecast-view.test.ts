import { describe, expect, it } from "vitest"
import type { BudgetLine } from "./types"
import {
  buildForecastViewLines,
  computeForecastPnl,
  computeForecastScenario,
  filterForecastEntriesForView,
  formatForecastDecimal,
  resolveForecastCell,
} from "./forecast-view"

const line = (
  id: string,
  category: string,
  lineType: "revenue" | "cogs" | "expense",
  plannedAmount: number,
  children: BudgetLine[] = [],
): BudgetLine => ({
  id,
  organizationId: "org",
  planId: "plan",
  category,
  lineType,
  plannedAmount,
  isAutoActual: false,
  sortOrder: Number(id.replace(/\D/g, "")) || 0,
  parentId: null,
  children,
})

describe("Forecast view financial semantics", () => {
  it("deducts COGS before operating expenses for gross profit and EBITDA", () => {
    expect(computeForecastPnl(100, 40, 25)).toEqual({
      revenue: 100,
      cogs: 40,
      operatingExpense: 25,
      grossProfit: 60,
      ebitda: 35,
      cogsShareOfRevenue: 40,
      expenseShareOfRevenue: 25,
      ebitdaMargin: 35,
    })
  })

  it("does not manufacture percentage ratios without positive revenue", () => {
    expect(computeForecastPnl(0, 10, 5)).toMatchObject({
      grossProfit: -10,
      ebitda: -15,
      cogsShareOfRevenue: null,
      expenseShareOfRevenue: null,
      ebitdaMargin: null,
    })
  })

  it("distinguishes a saved explicit zero from a plan-derived baseline", () => {
    expect(resolveForecastCell(0, 1_200, 12, 1)).toEqual({
      value: 0,
      source: "saved",
    })
    expect(resolveForecastCell(undefined, 1_200, 12, 1)).toEqual({
      value: 100,
      source: "plan_baseline",
    })
  })

  it("aggregates duplicate category/type leaves exactly once", () => {
    const result = buildForecastViewLines([
      line("1", "Sugar", "revenue", 100),
      line("2", "Sugar", "revenue", 60),
      line("3", "Sugar", "cogs", 40),
    ])

    expect(result.sourceLineCount).toBe(3)
    expect(result.lines).toHaveLength(2)
    expect(result.lines.find((item) => item.lineType === "revenue")?.plannedAmount).toBe(160)
    expect(result.lines.find((item) => item.lineType === "cogs")?.plannedAmount).toBe(40)
  })

  it("uses leaf rows without double-counting their parent rollup", () => {
    const result = buildForecastViewLines([
      line("1", "Revenue group", "revenue", 999, [
        line("2", "Sugar", "revenue", 100),
        line("3", "Sugar", "revenue", 50),
      ]),
    ])

    expect(result.sourceLineCount).toBe(2)
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].plannedAmount).toBe(150)
  })

  it("filters overrides by plan year, displayed months, and supported line key", () => {
    const lines = buildForecastViewLines([line("1", "Sugar", "revenue", 120)]).lines
    const entry = (id: string, year: number, month: number, category = "Sugar") => ({
      id,
      organizationId: "org",
      planId: "plan",
      year,
      month,
      category,
      lineType: "revenue",
      forecastAmount: 0,
      createdAt: "",
      updatedAt: "",
    })
    const result = filterForecastEntriesForView([
      entry("valid-zero", 2026, 2),
      entry("wrong-year", 2025, 2),
      entry("outside-quarter", 2026, 4),
      entry("unmatched", 2026, 2, "Unknown"),
    ], 2026, [1, 2, 3], lines)

    expect(result.applied.map((item) => item.id)).toEqual(["valid-zero"])
    expect(result.ignoredCount).toBe(3)
  })

  it("computes scenario totals with COGS and operating expense independently", () => {
    const scenario = computeForecastScenario(100, 40, 20, {
      revenue: 1.1,
      cogs: 0.9,
      expense: 0.8,
    })
    expect(scenario.revenue).toBeCloseTo(110)
    expect(scenario.cogs).toBeCloseTo(36)
    expect(scenario.operatingExpense).toBeCloseTo(16)
    expect(scenario.grossProfit).toBeCloseTo(74)
    expect(scenario.ebitda).toBeCloseTo(58)
  })

  it("formats decimals using the requested locale", () => {
    expect(formatForecastDecimal(1.1, "en", 2)).toBe("1.10")
    expect(formatForecastDecimal(1.1, "ru", 2)).toBe("1,10")
    expect(formatForecastDecimal(12.5, "az", 1)).toBe("12,5")
  })
})
