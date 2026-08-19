/**
 * 2026-08-19 — the product chart, on the client's own 2025 actuals.
 *
 * The decisive test is the last one in the first block: corn must be unable to
 * take over the plot. On the previous chart it did, because the axis carried a
 * rate and 142 AZN of revenue bought the same width as 16.4M.
 */
import { describe, it, expect } from "vitest"
import {
  buildMarginChartRows,
  grossProfitDomain,
  standingOf,
  type MarginChartInput,
} from "./product-margin-chart"

const P2025: MarginChartInput[] = [
  { productCode: "PLF.01.01.06.FY2025", productName: "Processed Corn Products", revenue: 16_428_573, cost: 13_231_466, marginPct: 19.46 },
  { productCode: "PLF.01.01.01", productName: "Wheat", revenue: 5_754_664, cost: 3_647_847, marginPct: 36.61 },
  { productCode: "PLF.01.01.02", productName: "Sugar Beet", revenue: 3_160_378, cost: 1_994_598, marginPct: 36.89 },
  { productCode: "PLF.01.01.04", productName: "Barley", revenue: 2_272_334, cost: 1_564_403, marginPct: 31.15 },
  { productCode: "PLF.01.03.02", productName: "Laboratory Services", revenue: 264_060, cost: 286_335, marginPct: -8.43 },
  { productCode: "PLF.01.01.03", productName: "Corn", revenue: 142, cost: 654, marginPct: -360.56 },
  { productCode: "PLF.01.01.99", productName: "Other Products", revenue: 1_921_539, cost: null, marginPct: null },
]

describe("what the chart draws", () => {
  const rows = buildMarginChartRows(P2025, 30)
  const by = (n: string) => rows.find((r) => r.productName === n)!

  it("ranks by the money each product earns", () => {
    expect(rows.map((r) => r.productName)).toEqual([
      "Processed Corn Products",
      "Wheat",
      "Sugar Beet",
      "Barley",
      // −512 is a smaller loss than −22,275, so corn sits above the lab.
      "Corn",
      "Laboratory Services",
    ])
  })

  it("draws gross profit, not the rate", () => {
    expect(by("Processed Corn Products").grossProfit).toBe(3_197_107)
    expect(by("Wheat").grossProfit).toBe(2_106_817)
    expect(by("Corn").grossProfit).toBe(-512)
  })

  it("cannot let a 142-manat line take over a 29.6M chart", () => {
    // The whole point. Corn's bar is now four ten-thousandths of the largest
    // one; on the rate axis it was the longest bar on the plot.
    const biggest = Math.abs(by("Processed Corn Products").grossProfit)
    expect(Math.abs(by("Corn").grossProfit) / biggest).toBeLessThan(0.001)
  })

  it("omits a product whose margin the screen refuses to state", () => {
    // 1,921,539 of "other products" has no usable cost. It stays in the table
    // and in the no-margin block; it is not drawn as a zero.
    expect(rows.find((r) => r.productName === "Other Products")).toBeUndefined()
  })
})

describe("standing against the reader's target", () => {
  it("separates a loss from merely missing the target", () => {
    expect(standingOf(-8.43, 30)).toBe("loss")
    expect(standingOf(19.46, 30)).toBe("below_target")
    expect(standingOf(36.61, 30)).toBe("at_target")
  })

  it("counts exactly on target as met", () => {
    expect(standingOf(30, 30)).toBe("at_target")
  })

  it("follows the slider rather than a fixed threshold", () => {
    // 19.46% is a miss at 30 and a beat at 15 — the reader decides.
    expect(standingOf(19.46, 15)).toBe("at_target")
  })

  it("calls zero margin a miss, not a loss", () => {
    expect(standingOf(0, 30)).toBe("below_target")
  })
})

describe("the axis", () => {
  it("starts at zero when everything earns", () => {
    const rows = buildMarginChartRows(P2025.filter((p) => (p.marginPct ?? 0) > 0), 30)
    expect(grossProfitDomain(rows)[0]).toBe(0)
  })

  it("reaches exactly as far as the worst loss and no further", () => {
    const rows = buildMarginChartRows(P2025, 30)
    expect(grossProfitDomain(rows)).toEqual([-22_275, 3_197_107])
  })

  it("stays valid when there is nothing to draw", () => {
    expect(grossProfitDomain([])).toEqual([0, 1])
  })
})
