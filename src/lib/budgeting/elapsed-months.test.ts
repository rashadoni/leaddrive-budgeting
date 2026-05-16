import { describe, it, expect } from "vitest"
import { computeElapsedMonthIndices } from "./elapsed-months"

describe("computeElapsedMonthIndices — monthly plans", () => {
  it("returns single-element array with month-1 index", () => {
    expect(computeElapsedMonthIndices({ periodType: "monthly", year: 2026, month: 5 }, 2026, 5)).toEqual([4])
    expect(computeElapsedMonthIndices({ periodType: "monthly", year: 2026, month: 1 }, 2026, 1)).toEqual([0])
    expect(computeElapsedMonthIndices({ periodType: "monthly", year: 2026, month: 12 }, 2026, 12)).toEqual([11])
  })

  it("returns empty when plan.month is null/undefined/out-of-range", () => {
    expect(computeElapsedMonthIndices({ periodType: "monthly", year: 2026, month: null }, 2026, 5)).toEqual([])
    expect(computeElapsedMonthIndices({ periodType: "monthly", year: 2026 }, 2026, 5)).toEqual([])
    expect(computeElapsedMonthIndices({ periodType: "monthly", year: 2026, month: 13 }, 2026, 5)).toEqual([])
    expect(computeElapsedMonthIndices({ periodType: "monthly", year: 2026, month: 0 }, 2026, 5)).toEqual([])
  })
})

describe("computeElapsedMonthIndices — quarterly plans", () => {
  it("Q1 inside quarter (curMonth=Feb, plan=Q1 2026): elapsed = [Jan, Feb]", () => {
    expect(
      computeElapsedMonthIndices({ periodType: "quarterly", year: 2026, quarter: 1 }, 2026, 2),
    ).toEqual([0, 1])
  })

  it("Q1 quarter complete (curMonth=Apr, plan=Q1 2026): elapsed = [Jan, Feb, Mar]", () => {
    expect(
      computeElapsedMonthIndices({ periodType: "quarterly", year: 2026, quarter: 1 }, 2026, 4),
    ).toEqual([0, 1, 2])
  })

  it("Q2 quarter not started (curMonth=Mar, plan=Q2 2026): elapsed = []", () => {
    expect(
      computeElapsedMonthIndices({ periodType: "quarterly", year: 2026, quarter: 2 }, 2026, 3),
    ).toEqual([])
  })

  it("Q4 past plan year (curYear=2027, plan=Q4 2026): elapsed = [Oct, Nov, Dec]", () => {
    expect(
      computeElapsedMonthIndices({ periodType: "quarterly", year: 2026, quarter: 4 }, 2027, 6),
    ).toEqual([9, 10, 11])
  })

  it("returns empty when plan.quarter is undefined", () => {
    expect(
      computeElapsedMonthIndices({ periodType: "quarterly", year: 2026 }, 2026, 4),
    ).toEqual([])
  })
})

describe("computeElapsedMonthIndices — annual plans", () => {
  it("annual in-progress (curMonth=May, plan year 2026): elapsed = [Jan..May]", () => {
    expect(
      computeElapsedMonthIndices({ periodType: "annual", year: 2026 }, 2026, 5),
    ).toEqual([0, 1, 2, 3, 4])
  })

  it("annual year complete (curYear=2027, plan year 2026): elapsed = [Jan..Dec]", () => {
    expect(
      computeElapsedMonthIndices({ periodType: "annual", year: 2026 }, 2027, 6),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it("annual year not started (curYear=2025, plan year 2026): elapsed = []", () => {
    expect(
      computeElapsedMonthIndices({ periodType: "annual", year: 2026 }, 2025, 6),
    ).toEqual([])
  })

  it("annual at December: elapsed = full year", () => {
    expect(
      computeElapsedMonthIndices({ periodType: "annual", year: 2026 }, 2026, 12),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it("annual at January: elapsed = [Jan]", () => {
    expect(
      computeElapsedMonthIndices({ periodType: "annual", year: 2026 }, 2026, 1),
    ).toEqual([0])
  })
})

describe("computeElapsedMonthIndices — unknown periodType", () => {
  it("returns empty defensively", () => {
    expect(
      computeElapsedMonthIndices({ periodType: "weekly" as any, year: 2026 }, 2026, 5),
    ).toEqual([])
    expect(
      computeElapsedMonthIndices({ periodType: "" as any, year: 2026 }, 2026, 5),
    ).toEqual([])
  })
})
