import { describe, it, expect } from "vitest"
import {
  calcYearEndProjection,
  computeVarianceSummary,
  applyScenario,
  type MonthlyDataPoint,
  type ScenarioType,
} from "./forecast"

/**
 * Pure-helper coverage for the budgeting forecast engine. Locks
 * financial-correctness invariants — these helpers feed projection +
 * variance widgets across the dashboard. A regression silently
 * miscalculates year-end gaps + scenario projections.
 *
 * `buildMonthlyForecast` + `buildCategoryForecast` are heavier
 * fixture-driven and exercised through the forecast route handler
 * tests; not duplicated here.
 */

describe("calcYearEndProjection", () => {
  it("extrapolates YTD actual to full year", () => {
    // Q1 done (3 months elapsed), spent 300K → projection 1.2M
    expect(calcYearEndProjection(300_000, 3)).toBe(1_200_000)
    // Half-year, 600K → projection 1.2M
    expect(calcYearEndProjection(600_000, 6)).toBe(1_200_000)
    // Full year already done → unchanged
    expect(calcYearEndProjection(1_200_000, 12)).toBe(1_200_000)
  })

  it("respects custom totalMonths (e.g. quarterly cycle)", () => {
    // Q1 cycle = 3 months total; 1 month elapsed @ 100K → 300K projection
    expect(calcYearEndProjection(100_000, 1, 3)).toBe(300_000)
  })

  it("returns 0 when currentMonth <= 0 (no elapsed time)", () => {
    expect(calcYearEndProjection(0, 0)).toBe(0)
    expect(calcYearEndProjection(500_000, 0)).toBe(0)
    expect(calcYearEndProjection(500_000, -1)).toBe(0)
  })

  it("handles zero actual cleanly", () => {
    expect(calcYearEndProjection(0, 6)).toBe(0)
  })
})

describe("computeVarianceSummary", () => {
  it("computes all 5 metrics for under-budget scenario", () => {
    // Plan 1M, Forecast 950K (saved on forecast), Actual 800K (saved more)
    // Year-end projection 900K (extrapolating 800K to year-end)
    const s = computeVarianceSummary(1_000_000, 950_000, 800_000, 900_000)
    expect(s.budgetVsForecast).toBe(50_000) // 1M − 950K
    expect(s.budgetVsActual).toBe(200_000) // 1M − 800K
    expect(s.forecastVsActual).toBe(150_000) // 950K − 800K
    expect(s.budgetVsActualPct).toBe(20) // 200K / 1M × 100
    expect(s.yearEndGap).toBe(100_000) // 1M − 900K
    expect(s.isOnTrack).toBe(false) // 20% > 10% threshold
  })

  it("marks isOnTrack when |budgetVsActualPct| <= 10%", () => {
    // 95K actual on 100K plan → 5% under = on track
    const s = computeVarianceSummary(100_000, 100_000, 95_000, 100_000)
    expect(s.budgetVsActualPct).toBe(5)
    expect(s.isOnTrack).toBe(true)
  })

  it("marks isOnTrack on the negative side too (over-spent within 10%)", () => {
    // 107K actual on 100K plan → -7% = still on track. closeTo because
    // 7000 / 100_000 × 100 hits IEEE-754 noise (-7.000000000000001).
    const s = computeVarianceSummary(100_000, 100_000, 107_000, 100_000)
    expect(s.budgetVsActualPct).toBeCloseTo(-7, 4)
    expect(s.isOnTrack).toBe(true)
  })

  it("guards against divide-by-zero when totalPlanned is 0", () => {
    const s = computeVarianceSummary(0, 0, 0, 0)
    expect(s.budgetVsActualPct).toBe(0)
    expect(s.isOnTrack).toBe(true)
  })
})

describe("applyScenario", () => {
  function pt(month: number, planned: number, forecast: number, isProjected: boolean): MonthlyDataPoint {
    return {
      month,
      year: 2026,
      label: ["Jan", "Feb"][month - 1] ?? `M${month}`,
      planned,
      forecast,
      actual: isProjected ? 0 : forecast,
      isProjected,
      isOverride: false,
    }
  }

  it("base scenario returns points unchanged", () => {
    const points = [pt(1, 100, 95, false), pt(2, 100, 110, true)]
    expect(applyScenario(points, "base")).toBe(points)
  })

  it("optimistic × revenue: future forecast × 1.10", () => {
    const points = [pt(2, 100, 1000, true)] // projected future
    const out = applyScenario(points, "optimistic", "revenue")
    expect(out[0].forecast).toBe(1100) // 1000 × 1.10
  })

  it("optimistic × expense: future forecast × 0.90", () => {
    const points = [pt(2, 100, 1000, true)]
    const out = applyScenario(points, "optimistic", "expense")
    expect(out[0].forecast).toBe(900) // 1000 × 0.90
  })

  it("optimistic × mixed: future forecast × 0.95", () => {
    const points = [pt(2, 100, 1000, true)]
    const out = applyScenario(points, "optimistic", "mixed")
    expect(out[0].forecast).toBe(950)
  })

  it("pessimistic × revenue: future forecast × 0.90", () => {
    const points = [pt(2, 100, 1000, true)]
    const out = applyScenario(points, "pessimistic", "revenue")
    expect(out[0].forecast).toBe(900)
  })

  it("pessimistic × expense: future forecast × 1.15", () => {
    const points = [pt(2, 100, 1000, true)]
    const out = applyScenario(points, "pessimistic", "expense")
    expect(out[0].forecast).toBe(1150)
  })

  it("past actuals NOT modified (only projected/override months scale)", () => {
    // Past month (isProjected=false, isOverride=false) → unchanged
    const past = pt(1, 100, 800, false)
    const future = pt(2, 100, 1000, true)
    const out = applyScenario([past, future], "pessimistic", "expense")
    expect(out[0].forecast).toBe(800) // past unchanged
    expect(out[1].forecast).toBe(1150) // future scaled
  })

  it("override months DO get scaled (user-confirmed overrides still respect scenario)", () => {
    const override: MonthlyDataPoint = { ...pt(1, 100, 800, false), isOverride: true }
    const out = applyScenario([override], "optimistic", "revenue")
    expect(out[0].forecast).toBe(880) // 800 × 1.10
  })
})
