/**
 * Tests for the UN Comtrade AZ trade-flow adapter.
 */
import { describe, it, expect, vi } from "vitest"
import {
  buildComtradeUrl,
  comtradePeriods,
  comtradeResponseToDataPoints,
  createUnComtradeAzAdapter,
  isComtradeYearPlausible,
  COMTRADE_MIN_LEG_USD,
  UN_COMTRADE_AZ_SOURCE,
} from "./un-comtrade-az"

describe("buildComtradeUrl", () => {
  it("includes AZ reporter 031 + TOTAL, defaulting to the newest period", () => {
    const url = buildComtradeUrl(new Date("2026-05-17"))
    expect(url).toContain("reporterCode=031")
    expect(url).toContain("period=2025")
    expect(url).toContain("cmdCode=TOTAL")
    expect(url).toContain("flowCode=M%2CX")
  })

  it("asks for exactly ONE period — the preview tier refuses more", () => {
    // 2026-08-05 — this used to send `period=2025,2024`, and Comtrade answered
    // HTTP 400 {"error":"Maximum number of periods for preview is 1"}. The
    // adapter had therefore been returning nothing at all, showing up in the
    // run log as an unexplained 400.
    for (const p of [2025, 2024]) {
      const url = buildComtradeUrl(new Date("2026-05-17"), p)
      const period = new URL(url).searchParams.get("period")
      expect(period).toBe(String(p))
      expect(period).not.toContain(",")
    }
  })

  it("still covers two years, because Comtrade publishes late", () => {
    expect(comtradePeriods(new Date("2026-05-17"))).toEqual([2025, 2024])
  })
})

describe("createUnComtradeAzAdapter — one request per period", () => {
  const okResponse = (rows: unknown[]) =>
    ({ ok: true, status: 200, json: async () => ({ data: rows }) }) as unknown as Response

  const row = (period: number, flowCode: string, value: number) => ({
    period,
    flowCode,
    primaryValue: value,
    partnerCode: 0,
    cmdCode: "TOTAL",
  })

  it("fetches each year separately and merges the rows", async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url)
      const period = Number(new URL(url).searchParams.get("period"))
      return period === 2025
        ? okResponse([row(2025, "X", 1_000_000_000), row(2025, "M", 24_000_000_000)])
        : okResponse([row(2024, "X", 30_000_000_000), row(2024, "M", 14_000_000_000)])
    })
    const adapter = createUnComtradeAzAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    })
    const result = await adapter.fetch(new Date("2026-05-17"))

    expect(urls).toHaveLength(2)
    expect(new URL(urls[0]).searchParams.get("period")).toBe("2025")
    expect(new URL(urls[1]).searchParams.get("period")).toBe("2024")
    // 2025 is a partial report (X $1B vs M $24B) so the plausibility walk
    // falls back to 2024 — which only works because both years were fetched.
    expect(result.dataPoints.length).toBeGreaterThan(0)
    expect(result.dataPoints[0].datetime.getUTCFullYear()).toBe(2024)
  })

  it("keeps the year it could fetch when the other one fails", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const period = Number(new URL(url).searchParams.get("period"))
      if (period === 2025) return { ok: false, status: 400 } as unknown as Response
      return okResponse([row(2024, "X", 30_000_000_000), row(2024, "M", 14_000_000_000)])
    })
    const adapter = createUnComtradeAzAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    })
    const result = await adapter.fetch(new Date("2026-05-17"))

    expect(result.dataPoints.length).toBeGreaterThan(0)
    expect(result.errors.some((e) => e.includes("2025: HTTP 400"))).toBe(true)
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
