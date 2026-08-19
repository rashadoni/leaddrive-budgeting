/**
 * 2026-08-19 — the margin simulator, pinned on the client's own cotton.
 *
 * Cotton is the case the feature exists for: 1,387,524 of revenue against
 * 1,371,625 of cost, a margin of 1.1%, against a budget that assumed 28%. The
 * tests below are mostly about the ways a slider can lie — inventing a cost it
 * never had, quietly averaging in revenue with no cost behind it, or answering
 * a question that has no answer.
 */
import { describe, it, expect } from "vitest"
import {
  simulateProductMargins,
  priceUpliftForTarget,
  costCutForTarget,
  isSimulating,
  NO_CHANGE,
} from "./product-margin-whatif"
import type { ProductMargin } from "./product-margin"

const COTTON: ProductMargin = {
  productCode: "PLF.01.01.05",
  productName: "Revenue from Sale of Cotton",
  revenue: 1_387_524,
  cost: 1_371_625,
  grossProfit: 15_899,
  marginPct: 1.1458,
}

const WHEAT_NO_COST: ProductMargin = {
  productCode: "PLF.01.03.01",
  productName: "Revenue from Rent of Land",
  revenue: 102_698,
  cost: null,
  grossProfit: null,
  marginPct: null,
  reason: "no_cost_data",
}

describe("margin simulation", () => {
  it("leaves everything alone at zero", () => {
    expect(isSimulating(NO_CHANGE)).toBe(false)
    const { products } = simulateProductMargins([COTTON], NO_CHANGE)
    expect(products[0].simMarginPct).toBeCloseTo(1.1, 1)
    expect(products[0].simRevenue).toBe(COTTON.revenue)
  })

  it("shows what a price rise does to cotton", () => {
    // +10% price on unchanged cost: 1,526,276 against 1,371,625 → 10.1%.
    const { products } = simulateProductMargins([COTTON], { price: 0.1, cost: 0 })
    expect(products[0].simMarginPct).toBeCloseTo(10.1, 1)
  })

  it("shows what a cost cut does to cotton", () => {
    const { products } = simulateProductMargins([COTTON], { price: 0, cost: -0.1 })
    expect(products[0].simMarginPct).toBeCloseTo(11.0, 1)
  })

  it("never invents a cost for a product that has none", () => {
    // The slider is the most dangerous place to fabricate: the reader is
    // actively exploring and inclined to believe whatever moves.
    const { products } = simulateProductMargins([WHEAT_NO_COST], { price: 0.25, cost: -0.25 })
    expect(products[0].simCost).toBeNull()
    expect(products[0].simMarginPct).toBeNull()
    expect(products[0].simGrossProfit).toBeNull()
    expect(products[0].reason).toBe("no_cost_data")
  })

  it("keeps unknown-cost revenue out of the simulated group margin", () => {
    const s = simulateProductMargins([COTTON, WHEAT_NO_COST], { price: 0.1, cost: 0 })
    // Only cotton's revenue is in the denominator; the rent is not.
    expect(s.knownRevenue).toBeCloseTo(1_526_276, 0)
    expect(s.knownMarginPct).toBeCloseTo(10.1, 1)
  })

  it("refuses a ratio when the price move wipes out revenue", () => {
    const { products } = simulateProductMargins([COTTON], { price: -1, cost: 0 })
    expect(products[0].simRevenue).toBe(0)
    expect(products[0].simMarginPct).toBeNull()
  })
})

describe("what it would take", () => {
  it("says how much price cotton needs for the budgeted 28%", () => {
    const uplift = priceUpliftForTarget(COTTON.revenue, COTTON.cost, 28)!
    // cost / (1 − 0.28) = 1,905,035 against 1,387,524 today → about +37%.
    expect(uplift).toBeCloseTo(0.373, 2)
    // And the answer is self-consistent: applying it lands on the target.
    const { products } = simulateProductMargins([COTTON], { price: uplift, cost: 0 })
    expect(products[0].simMarginPct).toBeCloseTo(28, 6)
  })

  it("says how much cost cotton could bear instead", () => {
    const cut = costCutForTarget(COTTON.revenue, COTTON.cost, 28)!
    expect(cut).toBeCloseTo(-0.272, 2)
    const { products } = simulateProductMargins([COTTON], { price: 0, cost: cut })
    expect(products[0].simMarginPct).toBeCloseTo(28, 6)
  })

  it("returns nothing rather than a fantasy when there is no answer", () => {
    // No cost to solve against.
    expect(priceUpliftForTarget(100, null, 30)).toBeNull()
    // Nothing to charge for.
    expect(priceUpliftForTarget(0, 50, 30)).toBeNull()
    // No finite price reaches 100% margin while any cost remains.
    expect(priceUpliftForTarget(100, 50, 100)).toBeNull()
    expect(costCutForTarget(100, 0, 30)).toBeNull()
  })

  it("reports a product already past the target as needing nothing", () => {
    // Glucose at 33.3% against a 30% target: the required uplift is negative,
    // which is the honest reading — there is headroom, not a shortfall.
    const uplift = priceUpliftForTarget(3_581_237, 2_389_537, 30)!
    expect(uplift).toBeLessThan(0)
  })
})
