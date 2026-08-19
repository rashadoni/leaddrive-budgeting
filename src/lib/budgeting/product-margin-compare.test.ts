/**
 * 2026-08-19 — budget against actual, per product.
 *
 * Cotton is why this exists: budgeted at 28%, delivering 1.1%. The tests below
 * are about the ways a comparison quietly stops comparing — a gap measured
 * against an unknown, a product that exists on only one side, and a sort that
 * buries the worst result somewhere in the middle.
 */
import { describe, it, expect } from "vitest"
import { buildMarginComparison } from "./product-margin-compare"

/** The client's own figures: budget full-year, actual January–May. */
const BUDGET = [
  { code: "PLF.01.01.05", name: "Revenue from Sale of Cotton", amount: 6_545_120 },
  { code: "PLF.02.01.05", name: "Cotton Costs", amount: 4_711_928 },
  { code: "PLF.01.02.01", name: "Revenue from Sales of Glucose", amount: 7_149_110 },
  { code: "PLF.02.02.01", name: "Glucose Costs", amount: 4_410_696 },
]
const ACTUAL = [
  { code: "PLF.01.01.05", name: "Revenue from Sale of Cotton", amount: 1_387_524 },
  { code: "PLF.02.01.05", name: "Cotton Costs", amount: 1_371_625 },
  { code: "PLF.01.02.01", name: "Revenue from Sales of Glucose", amount: 3_581_237 },
  { code: "PLF.02.02.01", name: "Glucose Costs", amount: 2_389_537 },
]

describe("budget against actual", () => {
  it("puts the two margins on one line and states the gap in points", () => {
    const { products } = buildMarginComparison(BUDGET, ACTUAL)
    const cotton = products.find((p) => p.productCode === "PLF.01.01.05")!
    expect(cotton.budget!.marginPct).toBeCloseTo(28.0, 1)
    expect(cotton.actual!.marginPct).toBeCloseTo(1.1, 1)
    // The sentence the client was missing: 27 points short of plan.
    expect(cotton.gapPoints).toBeCloseTo(-26.9, 1)
  })

  it("leads with the worst shortfall", () => {
    // Glucose misses by about 5 points, cotton by about 27. Cotton first.
    const { products } = buildMarginComparison(BUDGET, ACTUAL)
    expect(products[0].productCode).toBe("PLF.01.01.05")
  })

  it("refuses a gap when either side is unknown", () => {
    // Rent of land: budgeted revenue, no cost either side. A gap of 0 here
    // would read as "on plan" for something nobody can measure.
    const rentB = [{ code: "PLF.01.03.01", name: "Revenue from Rent of Land", amount: 459_000 }]
    const rentA = [{ code: "PLF.01.03.01", name: "Revenue from Rent of Land", amount: 102_698 }]
    const [p] = buildMarginComparison(rentB, rentA).products
    expect(p.budget!.marginPct).toBeNull()
    expect(p.actual!.marginPct).toBeNull()
    expect(p.gapPoints).toBeNull()
    expect(p.actual!.reason).toBe("no_cost_data")
  })

  it("keeps a product that exists on only one side", () => {
    // Sold but never planned: dropping it hides revenue nobody budgeted for.
    const onlyActual = buildMarginComparison([], ACTUAL)
    expect(onlyActual.products).toHaveLength(2)
    expect(onlyActual.products.every((p) => p.budget === null)).toBe(true)
    expect(onlyActual.products.every((p) => p.gapPoints === null)).toBe(true)

    // Planned but never sold is equally worth seeing.
    const onlyBudget = buildMarginComparison(BUDGET, [])
    expect(onlyBudget.products.every((p) => p.actual === null)).toBe(true)
  })

  it("compares the group margins too", () => {
    const c = buildMarginComparison(BUDGET, ACTUAL)
    // Budget: (13,694,230 − 9,122,624) / 13,694,230 = 33.4%
    expect(c.budget.knownMarginPct).toBeCloseTo(33.4, 1)
    // Actual: (4,968,761 − 3,761,162) / 4,968,761 = 24.3%
    expect(c.actual.knownMarginPct).toBeCloseTo(24.3, 1)
    expect(c.gapPoints).toBeCloseTo(-9.1, 1)
  })

  it("has no group gap when one side is empty", () => {
    expect(buildMarginComparison(BUDGET, []).gapPoints).toBeNull()
  })
})
