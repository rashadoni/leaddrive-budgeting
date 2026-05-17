/**
 * Tests for the UN Comtrade AZ trade-flow adapter.
 */
import { describe, it, expect, vi } from "vitest"
import {
  buildComtradeUrl,
  comtradeResponseToDataPoints,
  createUnComtradeAzAdapter,
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

describe("comtradeResponseToDataPoints", () => {
  it("returns 3 points (exports + imports + balance) for latest complete year", () => {
    const response = {
      data: [
        { period: 2025, flowCode: "X", primaryValue: 30_000_000_000 },
        { period: 2025, flowCode: "M", primaryValue: 14_000_000_000 },
        { period: 2024, flowCode: "X", primaryValue: 28_000_000_000 },
        { period: 2024, flowCode: "M", primaryValue: 12_000_000_000 },
      ],
    }
    const points = comtradeResponseToDataPoints(response)
    expect(points.length).toBe(3)
    const byMetric = Object.fromEntries(points.map((p) => [p.metric, p]))
    expect(byMetric["AZ_GOODS_EXPORTS_USD"].value).toBe(30_000_000_000)
    expect(byMetric["AZ_GOODS_IMPORTS_USD"].value).toBe(14_000_000_000)
    expect(byMetric["AZ_TRADE_BALANCE_USD"].value).toBe(16_000_000_000)
  })

  it("falls back to prior year when latest has only one leg", () => {
    const response = {
      data: [
        { period: 2025, flowCode: "X", primaryValue: 30_000_000_000 }, // only exports
        { period: 2024, flowCode: "X", primaryValue: 28_000_000_000 },
        { period: 2024, flowCode: "M", primaryValue: 12_000_000_000 },
      ],
    }
    const points = comtradeResponseToDataPoints(response)
    expect(points.length).toBe(3)
    // Should pick 2024 since 2025 is missing imports
    expect(points[0].datetime.getUTCFullYear()).toBe(2024)
  })

  it("recognizes flowDesc verbiage (Export/Import)", () => {
    const response = {
      data: [
        { period: 2025, flowDesc: "Export", primaryValue: 100 },
        { period: 2025, flowDesc: "Import", primaryValue: 60 },
      ],
    }
    const points = comtradeResponseToDataPoints(response)
    expect(points.length).toBe(3)
  })

  it("anchors datetime to UTC 1st-of-January", () => {
    const points = comtradeResponseToDataPoints({
      data: [
        { period: 2025, flowCode: "X", primaryValue: 100 },
        { period: 2025, flowCode: "M", primaryValue: 50 },
      ],
    })
    expect(points[0].datetime.toISOString()).toBe("2025-01-01T00:00:00.000Z")
  })

  it("returns [] when no year has both legs", () => {
    expect(
      comtradeResponseToDataPoints({
        data: [{ period: 2025, flowCode: "X", primaryValue: 100 }],
      }),
    ).toEqual([])
    expect(comtradeResponseToDataPoints({})).toEqual([])
    expect(comtradeResponseToDataPoints({ data: [] })).toEqual([])
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

  it("returns informative error when neither year has both legs", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ period: 2025, flowCode: "X", primaryValue: 100 }],
          }),
          { status: 200 },
        ),
    )
    const adapter = createUnComtradeAzAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.dataPoints).toEqual([])
    expect(result.errors[0]).toContain("publishing lag")
  })
})
