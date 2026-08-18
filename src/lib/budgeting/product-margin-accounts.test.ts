/**
 * 2026-08-19 — reading per-product margin off the P&L chart.
 *
 * Every figure below is the client's own, summed from `budget_lines` for the
 * 2026 actuals over January–May. They are here because the interesting cases
 * are not the arithmetic — `product-margin.ts` already owns that — but the
 * four ways this table can quietly stop being a product table: a subtotal row
 * counted as a product, an expense counted as a product, a discount counted as
 * a product, and a cost that pairs with nothing at all.
 */
import { describe, it, expect } from "vitest"
import { buildProductMarginsFromAccounts } from "./product-margin-accounts"

/** Cotton, wheat and glucose as the workbook states them, plus their costs. */
const CLIENT_ROWS = [
  { code: "PLF.01.01.01", name: "Revenue from Sale of Wheat", amount: 47_006 },
  { code: "PLF.02.01.01", name: "Wheat Costs", amount: 34_635 },
  { code: "PLF.01.01.05", name: "Revenue from Sale of Cotton", amount: 1_387_524 },
  { code: "PLF.02.01.05", name: "Cotton Costs", amount: 1_371_625 },
  { code: "PLF.01.02.01", name: "Revenue from Sales of Glucose", amount: 3_581_237 },
  { code: "PLF.02.02.01", name: "Glucose Costs", amount: 2_389_537 },
]

describe("per-product margin from the P&L chart", () => {
  it("pairs each product's revenue with the cost at the same position", () => {
    const { products } = buildProductMarginsFromAccounts(CLIENT_ROWS)
    const byName = Object.fromEntries(products.map((p) => [p.productName, p]))
    expect(byName["Revenue from Sale of Wheat"].marginPct).toBeCloseTo(26.3, 1)
    // The number the group total hides: cotton turns over thirty times what
    // wheat does and keeps almost none of it.
    expect(byName["Revenue from Sale of Cotton"].marginPct).toBeCloseTo(1.1, 1)
    expect(byName["Revenue from Sales of Glucose"].marginPct).toBeCloseTo(33.3, 1)
  })

  it("orders products by revenue so the material ones are met first", () => {
    const { products } = buildProductMarginsFromAccounts(CLIENT_ROWS)
    expect(products.map((p) => p.revenue)).toEqual([3_581_237, 1_387_524, 47_006])
  })

  it("keeps a service with no cost as unknown rather than as a 100% margin", () => {
    const { products, revenueWithoutCost } = buildProductMarginsFromAccounts([
      ...CLIENT_ROWS,
      { code: "PLF.01.03.01", name: "Revenue from Rent of Land", amount: 102_698 },
    ])
    const rent = products.find((p) => p.productCode === "PLF.01.03.01")!
    expect(rent.marginPct).toBeNull()
    expect(rent.reason).toBe("no_cost_data")
    expect(revenueWithoutCost).toBe(102_698)
  })

  it("does not file returns and discounts as products", () => {
    // Stored negative, as the importer writes them. Counted as a product this
    // is a line with negative revenue and no cost; counted as revenue it
    // inflates the top line. It is neither — it is stated on its own.
    const result = buildProductMarginsFromAccounts([
      ...CLIENT_ROWS,
      { code: "PLF.01.10.01", name: "Sales Return", amount: -4_523 },
      { code: "PLF.01.10.02", name: "Discounts", amount: -93_944 },
    ])
    expect(result.products.map((p) => p.productCode)).not.toContain("PLF.01.10.01")
    expect(result.products.map((p) => p.productCode)).not.toContain("PLF.01.10.02")
    expect(result.contraRevenue).toBe(-98_467)
    expect(result.contraRevenueAccounts).toHaveLength(2)
    // And it stays out of the group margin, which is about products only.
    expect(result.knownRevenue).toBe(5_015_767)
  })

  it("refuses the sheet's own subtotals and every non-product section", () => {
    // PLF.08 is the workbook's stated EBITDA and PLF.05 is payroll. Either one
    // admitted here doubles or invents a product line; the subtotal would
    // outrank every real product in the table it corrupts.
    const result = buildProductMarginsFromAccounts([
      ...CLIENT_ROWS,
      { code: "PLF.08", name: "EBITDA", amount: 255_942 },
      { code: "PLF.05.01", name: "Staff Salaries, Gross", amount: 5_054_161 },
      { code: "PLF.09.03.01", name: "Depreciation - Buildings", amount: 755_541 },
    ])
    expect(result.products).toHaveLength(3)
    expect(result.knownRevenue).toBe(5_015_767)
  })

  it("computes the group margin over paired products only", () => {
    const result = buildProductMarginsFromAccounts(CLIENT_ROWS)
    expect(result.knownRevenue).toBe(5_015_767)
    expect(result.knownCost).toBe(3_795_797)
    expect(result.knownMarginPct).toBeCloseTo(24.3, 1)
  })

  it("says so when a cost pairs with nothing instead of dropping it", () => {
    const result = buildProductMarginsFromAccounts([
      ...CLIENT_ROWS,
      { code: "PLF.02.09.09", name: "Costs of a product nobody sells", amount: 12_000 },
    ])
    expect(result.unpairedCostAccounts.map((a) => a.code)).toEqual(["PLF.02.09.09"])
    // It must not have leaked into any product's cost.
    expect(result.knownCost).toBe(3_795_797)
  })

  it("pairs year-suffixed accounts on the same rule", () => {
    const { products } = buildProductMarginsFromAccounts([
      { code: "PLF.01.01.06.FY2025", name: "Revenue from Sale of Processed Corn Products", amount: 200_000 },
      { code: "PLF.02.01.06.FY2025", name: "Processed Corn Products", amount: 150_000 },
    ])
    expect(products[0].cost).toBe(150_000)
    expect(products[0].marginPct).toBeCloseTo(25, 1)
  })

  it("folds a code that arrives twice instead of losing one of them", () => {
    const { products } = buildProductMarginsFromAccounts([
      { code: "PLF.01.01.01", name: "Revenue from Sale of Wheat", amount: 30_000 },
      { code: "PLF.01.01.01", name: "Revenue from Sale of Wheat", amount: 17_006 },
      { code: "PLF.02.01.01", name: "Wheat Costs", amount: 34_635 },
    ])
    expect(products).toHaveLength(1)
    expect(products[0].revenue).toBe(47_006)
  })
})
