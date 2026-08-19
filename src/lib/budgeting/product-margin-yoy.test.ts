/**
 * 2026-08-19 — this year against last, on the client's own January–May.
 *
 * Every figure below is theirs, read off production. The assertion that matters
 * most is the count that CANNOT be compared: the 2025 chart carried the whole
 * processing business as one line, so ten of 2026's thirteen priced products
 * have no counterpart. A list quietly showing the three that do would describe
 * a business this client does not have.
 */
import { describe, it, expect } from "vitest"
import { buildYoyComparison, type YoySide } from "./product-margin-yoy"

const side = (
  productCode: string,
  productName: string,
  revenue: number,
  cost: number | null,
): YoySide => ({
  productCode,
  productName,
  revenue,
  cost,
  // The screen's own rule: no cost, or a cost of exactly zero against real
  // revenue, means the ratio is withheld rather than invented.
  marginPct:
    cost === null || revenue === 0 || cost === 0 ? null : ((revenue - cost) / revenue) * 100,
})

/** January–May 2025, on the chart of that year. */
const PRIOR: YoySide[] = [
  side("PLF.01.01.06.FY2025", "Processed Corn Products", 5_636_955, 4_623_694),
  side("PLF.01.01.04", "Barley", 1_146_791, 680_370),
  side("PLF.01.01.01", "Wheat", 77_509, 118_255),
  side("PLF.01.03.02", "Laboratory Services", 76_732, 126_887),
  side("PLF.01.03.99", "Other Sources", 32_653, 81_149),
  side("PLF.01.01.03", "Corn", 142, 606),
  side("PLF.01.02.03.FY2025", "Management Services", 53_000, null),
  side("PLF.01.01.99", "Other Products", 50_300, null),
  side("PLF.01.03.01", "Rent of Land", 6_001, null),
]

/** January–May 2026, on the chart that split the processing side into seven. */
const CURRENT: YoySide[] = [
  side("PLF.01.02.01", "Glucose", 3_581_237, 2_389_537),
  side("PLF.01.02.02", "Corn Starch", 2_260_091, 1_561_466),
  side("PLF.01.02.05", "Malt", 1_934_994, 1_316_154),
  side("PLF.01.02.06", "Corn Processing Byproducts", 1_901_926, 1_910_187),
  side("PLF.01.01.05", "Cotton", 1_387_524, 1_371_625),
  side("PLF.01.01.04", "Barley", 614_185, 474_012),
  side("PLF.01.02.99", "Other Products", 342_462, 319_179),
  side("PLF.01.02.03", "Fructose", 279_712, 194_211),
  side("PLF.01.01.99", "Other Products", 132_090, 134_442),
  side("PLF.01.03.02", "Laboratory Services", 71_452, 137_580),
  side("PLF.01.01.01", "Wheat", 47_006, 34_635),
  side("PLF.01.02.07", "Malt Processing Byproducts", 35_401, 29_560),
  side("PLF.01.02.04", "Corn Oil", 23_253, 24_122),
  side("PLF.01.03.01", "Rent of Land", 102_698, null),
  side("PLF.01.03.99", "Other Sources", 5_573, null),
  side("PLF.01.01.02", "Sugar Beet", 78, null),
  side("PLF.01.03.03", "Farming Services", 6_250, 0),
]

describe("this year against last", () => {
  const y = buildYoyComparison(PRIOR, CURRENT)

  it("compares only the products both years actually carry", () => {
    expect(y.products.map((p) => p.productName).sort()).toEqual([
      "Barley",
      "Laboratory Services",
      "Wheat",
    ])
  })

  it("counts what it cannot compare instead of dropping it quietly", () => {
    // Thirteen 2026 products carry a margin; three have a 2025 counterpart.
    // The other ten are the processing split — glucose, starch, malt and the
    // rest were one line in 2025 — plus cotton, which sold nothing that year.
    expect(y.notComparable).toBe(10)
  })

  it("does not count a product whose margin the screen withholds", () => {
    // Rent of land, other sources, sugar beet and farming services have no
    // usable cost. They are not failed comparisons; there is nothing to
    // compare on either side.
    expect(y.products.some((p) => p.productName === "Rent of Land")).toBe(false)
    expect(y.notComparable).toBe(10)
  })

  it("finds the barley slide, which no other card on this screen can", () => {
    // 40.7% to 22.8% on real volume, with revenue down 46%. Budget-vs-actual
    // only knows the plan; the annual card only knows the plan's rate.
    const barley = y.products.find((p) => p.productName === "Barley")!
    expect(barley.priorMarginPct).toBeCloseTo(40.67, 1)
    expect(barley.currentMarginPct).toBeCloseTo(22.82, 1)
    expect(barley.marginGapPoints).toBeCloseTo(-17.85, 1)
    expect(barley.revenueChange).toBeCloseTo(-0.464, 3)
  })

  it("puts the worst rate move first", () => {
    expect(y.products[0].productName).toBe("Laboratory Services")
    expect(y.products[0].marginGapPoints).toBeCloseTo(-27.18, 1)
  })
})

describe("the group figures", () => {
  const y = buildYoyComparison(PRIOR, CURRENT)

  it("states last year and this on the same five months", () => {
    expect(y.prior.revenue).toBe(6_970_782)
    expect(y.prior.marginPct).toBeCloseTo(19.22, 2)
    expect(y.current.revenue).toBe(12_611_333)
    expect(y.current.marginPct).toBeCloseTo(21.53, 2)
  })

  it("reports the best news in the dataset: more revenue at a better rate", () => {
    expect(y.revenueChange).toBeCloseTo(0.809, 3)
    expect(y.marginGapPoints).toBeCloseTo(2.3, 1)
  })

  it("weighs the group by money, not by product count", () => {
    // The mean of 2025's six priced rates is far below 19.22% — wheat alone
    // ran at −52.6% on 77,509. Money decides the group.
    expect(y.prior.marginPct).not.toBeCloseTo(-10, 0)
  })

  it("leaves revenue with no usable cost out of the group", () => {
    // 2025 carried 109,301 of it (management services, other products, rent).
    // Counting that revenue with no cost behind it lifts the margin by a
    // number nobody could explain.
    expect(y.prior.revenue).toBe(7_080_083 - 109_301)
  })

  it("says nothing rather than dividing by an absent prior year", () => {
    const none = buildYoyComparison([], CURRENT)
    expect(none.marginGapPoints).toBeNull()
    expect(none.revenueChange).toBeNull()
    expect(none.notComparable).toBe(13)
  })
})
