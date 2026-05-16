import { describe, it, expect } from "vitest"
import { resolvePatternForDept, getPeriodMonths } from "./cost-model-map"

/**
 * Pure-helper coverage for cost-model-map.ts.
 *
 * `resolveCostModelKey` + `computePlannedForLine` accept full
 * CostModelResult objects with many optional fields. Exercising them
 * thoroughly via a hand-rolled fixture would over-mock the cost-model
 * pipeline; those paths are exercised indirectly through analytics
 * route handler tests. This file locks the 2 small fully-pure helpers
 * that have no Prisma / cost-model coupling.
 */

describe("resolvePatternForDept", () => {
  it("returns pattern unchanged when no {dept} placeholder", () => {
    expect(resolvePatternForDept("coreLabor", "permanent_it")).toBe("coreLabor")
    expect(resolvePatternForDept("serviceRevenues.total", null)).toBe(
      "serviceRevenues.total",
    )
  })

  it("substitutes {dept} with serviceKey when both present", () => {
    expect(
      resolvePatternForDept("serviceDetails.{dept}.directLabor", "permanent_it"),
    ).toBe("serviceDetails.permanent_it.directLabor")
    expect(
      resolvePatternForDept("deptCosts.{dept}", "Finance"),
    ).toBe("deptCosts.Finance")
  })

  it("returns null when pattern has {dept} but serviceKey is null (back-office case)", () => {
    expect(
      resolvePatternForDept("serviceDetails.{dept}.directLabor", null),
    ).toBe(null)
    expect(resolvePatternForDept("deptCosts.{dept}", null)).toBe(null)
  })

  it("returns null on empty / falsy pattern", () => {
    expect(resolvePatternForDept("", "permanent_it")).toBe(null)
  })
})

describe("getPeriodMonths", () => {
  it("monthly plan: returns [plan.month] count 1", () => {
    expect(getPeriodMonths({ periodType: "monthly", year: 2026, month: 5 })).toEqual({
      count: 1,
      months: [5],
    })
    expect(getPeriodMonths({ periodType: "monthly", year: 2026, month: 1 })).toEqual({
      count: 1,
      months: [1],
    })
    expect(getPeriodMonths({ periodType: "monthly", year: 2026, month: 12 })).toEqual({
      count: 1,
      months: [12],
    })
  })

  it("monthly plan without month → falls through to {count:1, months:[]}", () => {
    // Defensive — `monthly` requires `month`. Without it, we don't know
    // which month, so the empty-months fallback prevents accidental
    // 1..12 expansion.
    expect(getPeriodMonths({ periodType: "monthly", year: 2026 })).toEqual({
      count: 1,
      months: [],
    })
  })

  it("quarterly Q1 → [1,2,3]", () => {
    expect(
      getPeriodMonths({ periodType: "quarterly", year: 2026, quarter: 1 }),
    ).toEqual({ count: 3, months: [1, 2, 3] })
  })

  it("quarterly Q4 → [10,11,12]", () => {
    expect(
      getPeriodMonths({ periodType: "quarterly", year: 2026, quarter: 4 }),
    ).toEqual({ count: 3, months: [10, 11, 12] })
  })

  it("quarterly without quarter → fallback empty", () => {
    expect(getPeriodMonths({ periodType: "quarterly", year: 2026 })).toEqual({
      count: 1,
      months: [],
    })
  })

  it("annual → full year [1..12]", () => {
    expect(getPeriodMonths({ periodType: "annual", year: 2026 })).toEqual({
      count: 12,
      months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    })
  })

  it("unknown periodType → empty fallback", () => {
    expect(
      getPeriodMonths({ periodType: "weekly" as never, year: 2026 }),
    ).toEqual({ count: 1, months: [] })
  })
})
