import { describe, it, expect } from "vitest"
import {
  resolvePatternForDept,
  getPeriodMonths,
  resolveCostModelKey,
} from "./cost-model-map"
import type { CostModelResult } from "@/lib/cost-model/types"

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

describe("resolveCostModelKey", () => {
  // Builds a CostModelResult-shaped object via shallow cast — many
  // fields are optional so we only fill what each test exercises.
  function mk(partial: Record<string, unknown>): CostModelResult {
    return partial as unknown as CostModelResult
  }

  it("returns 0 for empty / falsy key", () => {
    expect(resolveCostModelKey(mk({ grandTotalG: 1000 }), "")).toBe(0)
  })

  it("returns 0 for unknown key (catch-all)", () => {
    expect(resolveCostModelKey(mk({ grandTotalG: 1000 }), "neverHeardOf")).toBe(0)
  })

  it("scalar top-level keys return raw field", () => {
    const result = mk({
      grandTotalG: 1000,
      grandTotalF: 900,
      adminOverhead: 100,
      techInfraTotal: 50,
      totalOverhead: 150,
      backOfficeCost: 40,
      coreLabor: 200,
      misc: 10,
      riskCost: 20,
      grcDirectCost: 5,
    })
    expect(resolveCostModelKey(result, "grandTotalG")).toBe(1000)
    expect(resolveCostModelKey(result, "grandTotalF")).toBe(900)
    expect(resolveCostModelKey(result, "adminOverhead")).toBe(100)
    expect(resolveCostModelKey(result, "techInfraTotal")).toBe(50)
    expect(resolveCostModelKey(result, "totalOverhead")).toBe(150)
    expect(resolveCostModelKey(result, "backOfficeCost")).toBe(40)
    expect(resolveCostModelKey(result, "coreLabor")).toBe(200)
    expect(resolveCostModelKey(result, "misc")).toBe(10)
    expect(resolveCostModelKey(result, "riskCost")).toBe(20)
    expect(resolveCostModelKey(result, "grcDirectCost")).toBe(5)
  })

  it("scalar key returns 0 when field is missing (defensive `num` guard)", () => {
    expect(resolveCostModelKey(mk({}), "grandTotalG")).toBe(0)
    expect(resolveCostModelKey(mk({ adminOverhead: null }), "adminOverhead")).toBe(0)
    expect(resolveCostModelKey(mk({ adminOverhead: "not-a-number" }), "adminOverhead")).toBe(0)
  })

  it("deptCosts.<dept> returns the dept's cost", () => {
    const result = mk({ deptCosts: { IT: 5000, Finance: 3000 } })
    expect(resolveCostModelKey(result, "deptCosts.IT")).toBe(5000)
    expect(resolveCostModelKey(result, "deptCosts.Finance")).toBe(3000)
  })

  it("deptCosts.<dept> returns 0 when dept missing", () => {
    expect(resolveCostModelKey(mk({ deptCosts: { IT: 5000 } }), "deptCosts.Marketing")).toBe(0)
    expect(resolveCostModelKey(mk({}), "deptCosts.IT")).toBe(0)
  })

  it("serviceRevenues.total uses summary.totalRevenue (matches profitability page)", () => {
    const result = mk({
      serviceRevenues: { svcA: 100, svcB: 200 },
      summary: { totalRevenue: 1_500 }, // PricingProfile differs from raw revenues sum
    })
    expect(resolveCostModelKey(result, "serviceRevenues.total")).toBe(1500)
  })

  it("serviceRevenues.total returns 0 when summary missing", () => {
    expect(
      resolveCostModelKey(mk({ serviceRevenues: { svcA: 100 } }), "serviceRevenues.total"),
    ).toBe(0)
  })

  it("serviceRevenues.<svc> scales per-service raw to match summary.totalRevenue", () => {
    // raw: svcA=300, svcB=200; raw total=500; summary total=1500 → scale ×3
    // svcA scaled = 300 × 3 = 900
    const result = mk({
      serviceRevenues: { svcA: 300, svcB: 200 },
      summary: { totalRevenue: 1_500 },
    })
    expect(resolveCostModelKey(result, "serviceRevenues.svcA")).toBe(900)
    expect(resolveCostModelKey(result, "serviceRevenues.svcB")).toBe(600)
  })

  it("serviceRevenues.<svc> returns raw when scaling would divide by zero", () => {
    // raw total=0 → can't scale → return raw value as-is
    const result = mk({
      serviceRevenues: { svcA: 0 },
      summary: { totalRevenue: 1500 },
    })
    expect(resolveCostModelKey(result, "serviceRevenues.svcA")).toBe(0)
  })

  it("serviceRevenues.<svc> returns raw when summary.totalRevenue is 0 / missing", () => {
    const result = mk({
      serviceRevenues: { svcA: 100, svcB: 200 },
    })
    expect(resolveCostModelKey(result, "serviceRevenues.svcA")).toBe(100)
  })

  it("serviceCosts.total sums all service costs", () => {
    expect(
      resolveCostModelKey(
        mk({ serviceCosts: { svcA: 100, svcB: 200, svcC: 50 } }),
        "serviceCosts.total",
      ),
    ).toBe(350)
  })

  it("serviceCosts.<svc> returns specific service cost", () => {
    expect(
      resolveCostModelKey(mk({ serviceCosts: { svcA: 100 } }), "serviceCosts.svcA"),
    ).toBe(100)
    expect(
      resolveCostModelKey(mk({ serviceCosts: { svcA: 100 } }), "serviceCosts.missing"),
    ).toBe(0)
  })

  it("serviceDetails.<svc>.<field> returns the nested field", () => {
    const result = mk({
      serviceDetails: { permanent_it: { directLabor: 1500, materials: 200 } },
    })
    expect(resolveCostModelKey(result, "serviceDetails.permanent_it.directLabor")).toBe(1500)
    expect(resolveCostModelKey(result, "serviceDetails.permanent_it.materials")).toBe(200)
  })

  it("serviceDetails.<svc>.<field> returns 0 when service or field missing", () => {
    expect(
      resolveCostModelKey(mk({ serviceDetails: {} }), "serviceDetails.unknown.directLabor"),
    ).toBe(0)
    expect(
      resolveCostModelKey(
        mk({ serviceDetails: { permanent_it: {} } }),
        "serviceDetails.permanent_it.directLabor",
      ),
    ).toBe(0)
  })

  it("serviceDetails malformed (wrong dot count) → 0", () => {
    expect(
      resolveCostModelKey(mk({ serviceDetails: {} }), "serviceDetails.too.many.dots"),
    ).toBe(0)
    expect(
      resolveCostModelKey(mk({ serviceDetails: {} }), "serviceDetails.justone"),
    ).toBe(0)
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
