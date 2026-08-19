/**
 * 2026-08-19 — where the year lands.
 *
 * The property worth testing hardest is the one that makes this method honest
 * and is also the easiest to lose in a refactor: with the plan taken for the
 * remaining months, the projected full-year variance must equal the variance
 * already banked, because the remainder is identical on both sides. If those
 * two ever diverge, something has started forecasting without saying so.
 */
import { describe, it, expect } from "vitest"
import { projectYearEnd } from "./year-end-landing"
import type { PnlSectionTotals } from "./ebitda"

function totals(
  revenue: number,
  cogs: number,
  opex: number,
  other = 0,
  below = 0,
): PnlSectionTotals {
  return {
    totalRevenue: revenue,
    totalCogs: cogs,
    totalOpex: opex,
    totalOtherOperating: other,
    totalBelowEbitda: below,
    daInCogs: 0,
    daInOpex: 0,
  }
}

/** January–May, roughly the client's shape: revenue behind, costs not. */
const YTD_ACTUAL = totals(12_725_933, 9_896_711, 6_081_815, 3_608_631)
const YTD_BUDGET = totals(10_521_993, 7_798_103, 6_450_822, 3_425_250)
const REST_BUDGET = totals(21_000_000, 14_000_000, 9_000_000, 4_000_000)

describe("year-end landing", () => {
  const y = projectYearEnd({
    actualToDate: YTD_ACTUAL,
    budgetToDate: YTD_BUDGET,
    budgetRemaining: REST_BUDGET,
    monthsActual: [1, 2, 3, 4, 5],
    monthsRemaining: [6, 7, 8, 9, 10, 11, 12],
  })

  it("adds delivered months to planned months", () => {
    expect(y.landing.totals.totalRevenue).toBe(12_725_933 + 21_000_000)
    expect(y.originalBudget.totals.totalRevenue).toBe(10_521_993 + 21_000_000)
  })

  it("projects a variance that is exactly the one already banked", () => {
    // The remaining months cancel. This is the whole character of the method:
    // it is not a model of the future, it is the miss to date at year scale.
    expect(y.variance.revenue).toBeCloseTo(
      YTD_ACTUAL.totalRevenue - YTD_BUDGET.totalRevenue,
      6,
    )
    expect(y.varianceIsBankedOnly).toBe(true)
  })

  it("carries the banked EBITDA gap to the year end", () => {
    const bankedEbitdaGap =
      projectYearEnd({
        actualToDate: YTD_ACTUAL,
        budgetToDate: YTD_BUDGET,
        budgetRemaining: totals(0, 0, 0, 0),
        monthsActual: [1, 2, 3, 4, 5],
        monthsRemaining: [],
      }).variance.ebitda
    expect(y.variance.ebitda).toBeCloseTo(bankedEbitdaGap, 6)
  })

  it("composes EBITDA the way the P&L screen does", () => {
    // gross profit − opex + other operating, D&A added back.
    const t = y.landing.totals
    const expected =
      t.totalRevenue - t.totalCogs - t.totalOpex + (t.totalOtherOperating ?? 0)
    expect(y.landing.derived.ebit).toBeCloseTo(expected, 6)
    expect(y.landing.derived.ebitda).toBeCloseTo(expected, 6) // no D&A in these fixtures
  })

  it("keeps the delivered months available on their own", () => {
    expect(y.toDate.totals.totalRevenue).toBe(YTD_ACTUAL.totalRevenue)
    expect(y.toDate.derived.grossProfit).toBeCloseTo(
      YTD_ACTUAL.totalRevenue - YTD_ACTUAL.totalCogs,
      6,
    )
  })

  it("lands exactly on budget when delivery matched plan", () => {
    const onPlan = projectYearEnd({
      actualToDate: YTD_BUDGET,
      budgetToDate: YTD_BUDGET,
      budgetRemaining: REST_BUDGET,
      monthsActual: [1, 2, 3, 4, 5],
      monthsRemaining: [6, 7, 8, 9, 10, 11, 12],
    })
    expect(onPlan.variance.revenue).toBeCloseTo(0, 6)
    expect(onPlan.variance.ebitda).toBeCloseTo(0, 6)
    expect(onPlan.variance.netProfit).toBeCloseTo(0, 6)
  })

  it("is the full budget when nothing has been delivered yet", () => {
    const nothing = projectYearEnd({
      actualToDate: totals(0, 0, 0, 0),
      budgetToDate: totals(0, 0, 0, 0),
      budgetRemaining: REST_BUDGET,
      monthsActual: [],
      monthsRemaining: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    })
    expect(nothing.variance.revenue).toBe(0)
    expect(nothing.landing.totals.totalRevenue).toBe(REST_BUDGET.totalRevenue)
  })

  it("sorts the month lists it reports", () => {
    const y2 = projectYearEnd({
      actualToDate: YTD_ACTUAL,
      budgetToDate: YTD_BUDGET,
      budgetRemaining: REST_BUDGET,
      monthsActual: [3, 1, 2],
      monthsRemaining: [12, 6],
    })
    expect(y2.monthsActual).toEqual([1, 2, 3])
    expect(y2.monthsRemaining).toEqual([6, 12])
  })
})
