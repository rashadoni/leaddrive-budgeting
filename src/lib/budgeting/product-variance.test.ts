import { describe, expect, it } from "vitest"
import { buildProductVarianceRows, productVarianceCoverage } from "./product-variance"

describe("product variance helpers", () => {
  it("builds product-level actual vs budget variance sorted by materiality", () => {
    const rows = buildProductVarianceRows({
      budgetLines: [
        { productId: "p1", productName: "Glucose", month: 1, amount: 1_000, quantity: 100 },
        { productId: "p2", productName: "Fructose", month: 1, amount: 500, quantity: 50 },
      ],
      actualLines: [
        { productId: "p1", productName: "Glucose", month: 1, amount: 1_320, quantity: 110 },
        { productId: "p2", productName: "Fructose", month: 1, amount: 480, quantity: 48 },
      ],
    })

    expect(rows[0]).toMatchObject({
      productId: "p1",
      budgetAmount: 1_000,
      actualAmount: 1_320,
      variance: 320,
      budgetQty: 100,
      actualQty: 110,
      budgetUnitRate: 10,
      actualUnitRate: 12,
      rateVariance: 220,
      volumeVariance: 100,
      mixVariance: 0,
      hasRateVolume: true,
    })
  })

  it("reports missing price-volume coverage when quantities are absent", () => {
    const rows = buildProductVarianceRows({
      budgetLines: [{ productId: "p1", productName: "Revenue", month: 1, amount: 1_000 }],
      actualLines: [{ productId: "p1", productName: "Revenue", month: 1, amount: 900 }],
    })

    expect(rows[0].hasRateVolume).toBe(false)
    expect(rows[0].rateVariance).toBeNull()
    expect(productVarianceCoverage(rows).missingMessages).toContain(
      "Price/volume variance needs quantity and unit price/unit cost in both budget and actual imports.",
    )
  })
})
