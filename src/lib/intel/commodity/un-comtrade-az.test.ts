/**
 * Tests for the UN Comtrade AZ trade-flow adapter.
 */
import { describe, it, expect, vi } from "vitest"
import {
  buildComtradeUrl,
  comtradeResponseToDataPoints,
  createUnComtradeAzAdapter,
  isComtradeYearPlausible,
  COMTRADE_MIN_LEG_USD,
  UN_COMTRADE_AZ_SOURCE,
} from "./un-comtrade-az"

describe("buildComtradeUrl", () => {
  it("includes AZ reporter 031 + 2 prior years + TOTAL", () => {
    const url = buildComtradeUrl(new Date("2026-05-17"))
    expect(url).toContain("reporterCode=031")
    expect(url).toContain("period=2025%2C2024")
    expect(url).toContain("cmdCode=TOTAL")
    expect(url).toContain("flowCode=M%2CX")
  })
})

describe("isComtradeYearPlausible", () => {
  it("accepts realistic AZ figures (X≈$30B, M≈$14B)", () => {
    expect(isComtradeYearPlausible(30_000_000_000, 14_000_000_000).ok).toBe(true)
  })

  it("rejects partial-year exports (X=$1B, M=$24B)", () => {
    const r = isComtradeYearPlausible(1_180_000_000, 24_400_000_000)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("below")
  })

  it("rejects when X/M ratio is absurdly skewed (X=$6B, M=$30B)", () => {
    const r = isComtradeYearPlausible(6_000_000_000, 30_000_000_000)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("ratio")
  })

  it("rejects when both legs below floor", () => {
    expect(isComtradeYearPlausible(1_000_000, 1_000_000).ok).toBe(false)
  })
})

describe("comtradeResponseToDataPoints", () => {
  it("returns 3 points (exports + imports + balance) for latest plausible year", () => {
    const response = {
      data: [
        { period: 2025, flowCode: "X", primaryValue: 30_000_000_000 },
        { period: 2025, flowCode: "M", primaryValue: 14_000_000_000 },
        { period: 2024, flowCode: "X", primaryValue: 28_000_000_000 },
        { period: 2024, flowCode: "M", primaryValue: 12_000_000_000 },
      ],
    }
    const { dataPoints, skipped } = comtradeResponseToDataPoints(response)
    expect(dataPoints.length).toBe(3)
    expect(skipped).toEqual([])
    const byMetric = Object.fromEntries(dataPoints.map((p) => [p.metric, p]))
    expect(byMetric["AZ_GOODS_EXPORTS_USD"].value).toBe(30_000_000_000)
    expect(byMetric["AZ_GOODS_IMPORTS_USD"].value).toBe(14_000_000_000)
    expect(byMetric["AZ_TRADE_BALANCE_USD"].value).toBe(16_000_000_000)
  })

  it("falls back to prior year when latest has only one leg", () => {
    const response = {
      data: [
        { period: 2025, flowCode: "X", primaryValue: 30_000_000_000 },
        { period: 2024, flowCode: "X", primaryValue: 28_000_000_000 },
        { period: 2024, flowCode: "M", primaryValue: 12_000_000_000 },
      ],
    }
    const { dataPoints } = comtradeResponseToDataPoints(response)
    expect(dataPoints.length).toBe(3)
    expect(dataPoints[0].datetime.getUTCFullYear()).toBe(2024)
  })

  it("regression: skips partial-year 2025 ($1.2B X / $24.4B M) and falls back to plausible 2024", () => {
    // This is the exact pattern that produced the -$23B "balance"
    // that broadcast across the holding's services entities and
    // dominated the Top-3 Worst panel. Both legs in 2024 are
    // realistic; both legs in 2025 are partial-year fragments.
    const response = {
      data: [
        { period: 2025, flowCode: "X", primaryValue: 1_180_000_000 },
        { period: 2025, flowCode: "M", primaryValue: 24_400_000_000 },
        { period: 2024, flowCode: "X", primaryValue: 28_000_000_000 },
        { period: 2024, flowCode: "M", primaryValue: 12_000_000_000 },
      ],
    }
    const { dataPoints, skipped } = comtradeResponseToDataPoints(response)
    expect(dataPoints.length).toBe(3)
    expect(dataPoints[0].datetime.getUTCFullYear()).toBe(2024)
    const balance = dataPoints.find((p) => p.metric === "AZ_TRADE_BALANCE_USD")
    expect(balance?.value).toBeGreaterThan(0)
    expect(skipped).toHaveLength(1)
    expect(skipped[0].year).toBe(2025)
  })

  it("recognizes flowDesc verbiage (Export/Import) when both legs are plausible", () => {
    const response = {
      data: [
        { period: 2025, flowDesc: "Export", primaryValue: 30_000_000_000 },
        { period: 2025, flowDesc: "Import", primaryValue: 14_000_000_000 },
      ],
    }
    const { dataPoints } = comtradeResponseToDataPoints(response)
    expect(dataPoints.length).toBe(3)
  })

  it("anchors datetime to UTC 1st-of-January", () => {
    const { dataPoints } = comtradeResponseToDataPoints({
      data: [
        { period: 2025, flowCode: "X", primaryValue: 30_000_000_000 },
        { period: 2025, flowCode: "M", primaryValue: 14_000_000_000 },
      ],
    })
    expect(dataPoints[0].datetime.toISOString()).toBe(
      "2025-01-01T00:00:00.000Z",
    )
  })

  it("returns [] when no year has both legs", () => {
    expect(
      comtradeResponseToDataPoints({
        data: [{ period: 2025, flowCode: "X", primaryValue: 100 }],
      }).dataPoints,
    ).toEqual([])
    expect(comtradeResponseToDataPoints({}).dataPoints).toEqual([])
    expect(comtradeResponseToDataPoints({ data: [] }).dataPoints).toEqual([])
  })

  it("re-exports the floor constant for downstream visibility", () => {
    expect(COMTRADE_MIN_LEG_USD).toBe(5_000_000_000)
  })
})

describe("createUnComtradeAzAdapter", () => {
  it("returns adapter with correct contract", () => {
    const adapter = createUnComtradeAzAdapter()
    expect(adapter.source).toBe(UN_COMTRADE_AZ_SOURCE)
    expect(adapter.label).toContain("Comtrade")
  })

  it("fetches + parses successful response", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { period: 2025, flowCode: "X", primaryValue: 30_000_000_000 },
              { period: 2025, flowCode: "M", primaryValue: 14_000_000_000 },
            ],
          }),
          { status: 200 },
        ),
    )
    const adapter = createUnComtradeAzAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.dataPoints.length).toBe(3)
  })

  it("returns 404 gracefully", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }))
    const adapter = createUnComtradeAzAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.dataPoints).toEqual([])
    expect(result.errors[0]).toContain("HTTP 404")
  })

  it("returns informative error when no plausible year exists", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { period: 2025, flowCode: "X", primaryValue: 1_180_000_000 },
              { period: 2025, flowCode: "M", primaryValue: 24_400_000_000 },
            ],
          }),
          { status: 200 },
        ),
    )
    const adapter = createUnComtradeAzAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.dataPoints).toEqual([])
    expect(result.errors.join(" ")).toContain("skipped 2025")
    expect(result.errors.join(" ")).toContain("plausibility")
  })
})
