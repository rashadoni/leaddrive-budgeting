// @vitest-environment happy-dom
/**
 * 11.92 — a twelve-month budget beside a five-month actual has to say so.
 *
 * The screen printed `BÜDCƏ 14.2M · FAKT 271k · KƏNARLAŞMA −13.9M · 2%` with
 * nothing indicating the two sides cover different amounts of time. Both
 * figures tie to the client's own workbook to the manat; what was missing was
 * the sentence that makes the subtraction mean anything. Read cold, −13.9M is
 * a catastrophe. Read correctly, it is August.
 */

import React from "react"
import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { PnlPerformanceCharts } from "./pnl-performance-charts"
import { coverageOf } from "@/lib/budgeting/period-coverage"
import type { PnlPerformanceMetric, PnlPerformancePoint } from "@/lib/budgeting/pnl-performance"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** 12 budget months; `actualMonths` of actual. Shapes the real 2026 case. */
function series(actualMonths: number): PnlPerformancePoint[] {
  return MONTHS.map((month, i) => ({
    month,
    budget: 100,
    actual: i < actualMonths ? 10 : 0,
    variance: (i < actualMonths ? 10 : 0) - 100,
    executionPct: null,
  }))
}

function monthly(actualMonths: number): Record<PnlPerformanceMetric, PnlPerformancePoint[]> {
  const s = series(actualMonths)
  return { revenue: s, cogs: s, opex: s, ebitda: s, netProfit: s }
}

const cov = (n: number) =>
  coverageOf([MONTHS.map((_m, i) => (i < n ? 1 : 0))])

afterEach(cleanup)

describe("Actual vs Budget — unequal periods", () => {
  it("warns when the actual covers fewer months than the budget", () => {
    render(
      <PnlPerformanceCharts
        monthly={monthly(5)}
        bridge={[]}
        hasActuals
        budgetCoverage={cov(12)}
        actualCoverage={cov(5)}
      />,
    )
    expect(screen.getByTestId("pnl-span-mismatch")).toBeTruthy()
  })

  it("stays quiet once both sides cover the same year", () => {
    // December closes and the caveat retires itself. A warning that never goes
    // away is furniture, and gets read as furniture.
    render(
      <PnlPerformanceCharts
        monthly={monthly(12)}
        bridge={[]}
        hasActuals
        budgetCoverage={cov(12)}
        actualCoverage={cov(12)}
      />,
    )
    expect(screen.queryByTestId("pnl-span-mismatch")).toBeNull()
  })

  it("says nothing when there are no actuals at all", () => {
    // Already covered by the existing "no actuals yet" notice; two amber boxes
    // saying overlapping things is worse than one.
    render(
      <PnlPerformanceCharts
        monthly={monthly(0)}
        bridge={[]}
        hasActuals={false}
        budgetCoverage={cov(12)}
        actualCoverage={cov(0)}
      />,
    )
    expect(screen.queryByTestId("pnl-span-mismatch")).toBeNull()
  })

  it("renders unchanged for callers that pass no coverage", () => {
    // The props are optional so every existing caller and fixture behaves
    // exactly as before — absent means "say nothing", not "assume a mismatch".
    render(<PnlPerformanceCharts monthly={monthly(5)} bridge={[]} hasActuals />)
    expect(screen.queryByTestId("pnl-span-mismatch")).toBeNull()
  })
})
