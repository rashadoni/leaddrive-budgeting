/**
 * 2026-08-19 — the delivered year against the annual plan.
 *
 * Every figure below is the client's own, read off production. The file exists
 * because the month-truncated card reported a −3.6 point group miss for
 * January–May while the products it could compare were level; the 3.5 points
 * were crops sold ahead of the season they are planned for, which that card
 * cannot show at all.
 */
import { describe, it, expect } from "vitest"
import {
  buildAnnualProgress,
  exposureAtDeliveredRate,
  type AnnualSide,
} from "./product-margin-annual"

/** Full-year 2026 plan. Both crops sit entirely in June–December. */
const PLAN_YEAR: AnnualSide[] = [
  { productCode: "PLF.01.01.05", productName: "Cotton", revenue: 6_545_120, cost: 4_711_928 },
  { productCode: "PLF.01.01.01", productName: "Wheat", revenue: 15_836_740, cost: 9_669_663 },
  { productCode: "PLF.01.02.01", productName: "Glucose", revenue: 2_654_310, cost: 1_783_956 },
]
/** The same plan cut to January–May: the crops vanish. */
const PLAN_WINDOW: AnnualSide[] = [
  { productCode: "PLF.01.01.05", productName: "Cotton", revenue: 0, cost: 0 },
  { productCode: "PLF.01.01.01", productName: "Wheat", revenue: 0, cost: 0 },
  { productCode: "PLF.01.02.01", productName: "Glucose", revenue: 2_654_310, cost: 1_783_956 },
]
/** January–May actuals. The crops are there. */
const ACTUAL: AnnualSide[] = [
  { productCode: "PLF.01.01.05", productName: "Cotton", revenue: 1_387_524, cost: 1_371_625 },
  { productCode: "PLF.01.01.01", productName: "Wheat", revenue: 47_006, cost: 34_635 },
  { productCode: "PLF.01.02.01", productName: "Glucose", revenue: 3_581_237, cost: 2_389_537 },
]

describe("annual progress", () => {
  const rows = buildAnnualProgress(PLAN_YEAR, PLAN_WINDOW, ACTUAL)
  const byCode = (c: string) => rows.find((r) => r.productCode === c)!

  it("states the comparison the month-truncated card cannot: 28.0% planned, 1.1% delivered", () => {
    const cotton = byCode("PLF.01.01.05")
    expect(cotton.planMarginPct).toBeCloseTo(28.0, 1)
    expect(cotton.actualMarginPct).toBeCloseTo(1.1, 1)
    expect(cotton.marginGapPoints).toBeCloseTo(-26.9, 1)
  })

  it("marks a product whose plan lies wholly outside the delivered months", () => {
    expect(byCode("PLF.01.01.05").plannedLater).toBe(true)
    expect(byCode("PLF.01.01.01").plannedLater).toBe(true)
    // Glucose is planned across the window, so it is an ordinary row.
    expect(byCode("PLF.01.02.01").plannedLater).toBe(false)
  })

  it("puts those rows first, since no other card can show them", () => {
    expect(rows.slice(0, 2).every((r) => r.plannedLater)).toBe(true)
  })

  it("reports delivery as progress and never as a revenue variance", () => {
    // 1,387,524 of a 6,545,120 annual plan. Subtracting these would recreate
    // the five-months-against-twelve error the truncation exists to prevent.
    expect(byCode("PLF.01.01.05").revenueProgress).toBeCloseTo(0.212, 3)
    expect(byCode("PLF.01.02.01").revenueProgress).toBeCloseTo(1.349, 3)
  })

  it("withholds a rate rather than reading a zero cost as 100% margin", () => {
    const rows2 = buildAnnualProgress(
      [{ productCode: "S", productName: "Farming Services", revenue: 6_250, cost: 0 }],
      [],
      [{ productCode: "S", productName: "Farming Services", revenue: 6_250, cost: 0 }],
    )
    expect(rows2[0].actualMarginPct).toBeNull()
    expect(rows2[0].marginGapPoints).toBeNull()
  })

  it("keeps a product that sold with no annual plan at all", () => {
    const rows2 = buildAnnualProgress(
      [],
      [],
      [{ productCode: "X", productName: "Unplanned", revenue: 100, cost: 60 }],
    )
    expect(rows2).toHaveLength(1)
    expect(rows2[0].revenueProgress).toBeNull()
    expect(rows2[0].plannedLater).toBe(false)
  })

  it("drops a product that is neither planned nor sold", () => {
    const rows2 = buildAnnualProgress(
      [{ productCode: "Z", productName: "Dormant", revenue: 0, cost: 0 }],
      [],
      [],
    )
    expect(rows2).toHaveLength(0)
  })
})

describe("exposure if the rest realises at the delivered rate", () => {
  const rows = buildAnnualProgress(PLAN_YEAR, PLAN_WINDOW, ACTUAL)
  const cotton = rows.find((r) => r.productCode === "PLF.01.01.05")!

  it("sizes the cotton gap on the plan still to come", () => {
    // 5,157,596 of plan left, missing 26.86 points of rate → 1,385,468.
    expect(exposureAtDeliveredRate(cotton)).toBeCloseTo(1_385_468, -3)
  })

  it("returns nothing once the plan is already delivered", () => {
    const glucose = rows.find((r) => r.productCode === "PLF.01.02.01")!
    expect(exposureAtDeliveredRate(glucose)).toBeNull()
  })

  it("returns nothing when either rate is unknown", () => {
    expect(
      exposureAtDeliveredRate({
        productCode: "S",
        productName: "s",
        planRevenue: 100,
        planMarginPct: null,
        actualRevenue: 10,
        actualMarginPct: 5,
        marginGapPoints: null,
        revenueProgress: 0.1,
        plannedLater: false,
      }),
    ).toBeNull()
  })
})
