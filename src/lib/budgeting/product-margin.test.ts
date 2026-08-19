/**
 * 2026-08-18 — gross margin per product, and the products nobody can answer
 * for.
 *
 * The owner asked for `(revenue − cogs) / revenue` with wheat, cotton and the
 * rest separately. Half of those products have no cost in the workbook, so
 * the interesting cases here are the ones where the honest answer is "I do not
 * know" — and every one of them is a way to accidentally publish a number
 * instead.
 *
 * The figures are the client's own, recomputed from `Sales Budget CPC 2026`
 * and checked against that sheet's own GROSS PROFIT column.
 */
import { describe, it, expect } from "vitest"
import { summarizeProductMargins } from "./product-margin"

describe("per-product gross margin", () => {
  it("computes the client's own margins", () => {
    const { products } = summarizeProductMargins([
      { productCode: "CPC__GLUCOSE", productName: "Glucose", revenue: 5_085_990, cost: 2_688_419 },
      { productCode: "CPC__STARCH", productName: "Corn starch", revenue: 3_605_280, cost: 2_026_908 },
      { productCode: "CPC__GLUCOSE_EXP", productName: "Glucose (Export)", revenue: 2_063_120, cost: 1_722_277 },
    ])
    expect(products[0].marginPct).toBeCloseTo(47.1, 1)
    expect(products[1].marginPct).toBeCloseTo(43.8, 1)
    // The number the group figure hides: the same product, exported, at 16.5%.
    expect(products[2].marginPct).toBeCloseTo(16.5, 1)
  })

  it("keeps a zero margin — sold at cost is an answer", () => {
    // Byproduct: revenue 3,807,993, cost 3,807,993. A real 0.0%, and it must
    // not be confused with the unknown case below.
    const [p] = summarizeProductMargins([
      { productCode: "CPC__BYPRODUCT", productName: "Byproduct", revenue: 3_807_993, cost: 3_807_993 },
    ]).products
    expect(p.marginPct).toBe(0)
    expect(p.reason).toBeUndefined()
  })

  it("refuses to invent a margin for a product with no cost data", () => {
    // Wheat: the owner's first example, and the workbook states tonnes only.
    // A zero cost here would publish "100%" — a fabrication indistinguishable
    // from an excellent result.
    const [p] = summarizeProductMargins([
      { productCode: "EDEN__WHEAT", productName: "Buğda", revenue: 15_836_740 },
    ]).products
    expect(p.marginPct).toBeNull()
    expect(p.cost).toBeNull()
    expect(p.grossProfit).toBeNull()
    expect(p.reason).toBe("no_cost_data")
  })

  it("refuses a ratio with no denominator, but keeps the profit", () => {
    const [p] = summarizeProductMargins([
      { productCode: "CPC__X", productName: "Unsold stock", revenue: 0, cost: 12_000 },
    ]).products
    expect(p.marginPct).toBeNull()
    expect(p.reason).toBe("no_revenue")
    // The loss is real even though the ratio is not.
    expect(p.grossProfit).toBe(-12_000)
  })

  it("computes the group margin over KNOWN costs only, and says what it left out", () => {
    // The trap: averaging over everything would count wheat's 15.8M of revenue
    // against zero cost and drag the group margin toward 100%.
    const s = summarizeProductMargins([
      { productCode: "CPC__GLUCOSE", productName: "Glucose", revenue: 5_085_990, cost: 2_688_419 },
      { productCode: "EDEN__WHEAT", productName: "Buğda", revenue: 15_836_740 },
    ])
    expect(s.knownRevenue).toBe(5_085_990)
    expect(s.knownMarginPct).toBeCloseTo(47.1, 1)
    // And the reader is told how much of the business this cannot speak for.
    expect(s.revenueWithoutCost).toBe(15_836_740)
  })

  it("reproduces the whole CPC block the client states", () => {
    const s = summarizeProductMargins([
      { productCode: "a", productName: "Glucose", revenue: 5_085_990, cost: 2_688_419 },
      { productCode: "b", productName: "Byproduct", revenue: 3_807_993, cost: 3_807_993 },
      { productCode: "c", productName: "Corn starch", revenue: 3_605_280, cost: 2_026_908 },
      { productCode: "d", productName: "Glucose (Export)", revenue: 2_063_120, cost: 1_722_277 },
      { productCode: "e", productName: "Fructose", revenue: 1_932_000, cost: 1_194_553 },
      { productCode: "f", productName: "Corn starch (Export)", revenue: 1_630_980, cost: 1_121_674 },
    ])
    expect(s.knownRevenue).toBeCloseTo(18_125_363, 0)
    expect(s.knownCost).toBeCloseTo(12_561_824, 0)
    expect(s.knownMarginPct).toBeCloseTo(30.7, 1)
    expect(s.revenueWithoutCost).toBe(0)
  })
})

describe("a ratio is withheld when the denominator cannot carry one", () => {
  it("refuses the plausible-looking percent that two minuses produce", () => {
    // Production, 2025 eliminations: corn at −7,346,866 of revenue against
    // −4,861,905 of cost. The formula returns +33.8% — a confident, wrong
    // number that looks like a healthy margin and announces nothing.
    const s = summarizeProductMargins([
      { productCode: "CORN", productName: "Corn", revenue: -7_346_866, cost: -4_861_905 },
    ])
    expect(s.products[0].marginPct).toBeNull()
    expect(s.products[0].reason).toBe("negative_revenue")
  })

  it("keeps those amounts in the group, where they reconcile to the P&L", () => {
    // Withholding the RATIO must not remove the money: an elimination is part
    // of the consolidated arithmetic even though its own ratio is meaningless.
    const s = summarizeProductMargins([
      { productCode: "A", productName: "Sold", revenue: 1_000, cost: 600 },
      { productCode: "E", productName: "Elimination", revenue: -200, cost: -120 },
    ])
    expect(s.knownRevenue).toBe(800)
    expect(s.knownCost).toBe(480)
    expect(s.knownMarginPct).toBeCloseTo(40, 5)
  })

  it("still reports the gross profit of a negative-revenue row", () => {
    const s = summarizeProductMargins([
      { productCode: "E", productName: "Elimination", revenue: -200, cost: -120 },
    ])
    expect(s.products[0].grossProfit).toBe(-80)
    expect(s.products[0].cost).toBe(-120)
  })

  it("does not invent a 100% margin when no cost was posted", () => {
    // Farming Services: 6,250 of revenue against a cost account summing to 0.
    const s = summarizeProductMargins([
      { productCode: "F", productName: "Farming Services", revenue: 6_250, cost: 0 },
    ])
    expect(s.products[0].marginPct).toBeNull()
    expect(s.products[0].reason).toBe("zero_cost")
    // And it must not drag the group toward 100% either.
    expect(s.knownRevenue).toBe(0)
    expect(s.revenueWithoutCost).toBe(6_250)
  })

  it("keeps a real loss, which is not an invented number", () => {
    // Laboratory Services: 71,452 against 137,580 of genuine cost. Withholding
    // this would hide a loss, which is the opposite failure.
    const s = summarizeProductMargins([
      { productCode: "L", productName: "Lab", revenue: 71_452, cost: 137_580 },
    ])
    expect(s.products[0].marginPct).toBeCloseTo(-92.5, 1)
  })
})
