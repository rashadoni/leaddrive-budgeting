/**
 * Tests for the USDA NASS Quick Stats adapter.
 */
import { describe, it, expect, vi } from "vitest"
import {
  buildUsdaUrl,
  usdaResponseToDataPoint,
  createUSDANassAdapter,
  USDA_NASS_SOURCE,
  USDA_SERIES,
} from "./usda-nass"

const BROILER_SERIES = USDA_SERIES.find((s) => s.metric === "BROILER_PRICE_USD_LB")!

describe("buildUsdaUrl", () => {
  it("includes api key + short_desc in querystring", () => {
    const url = buildUsdaUrl(BROILER_SERIES, "KEY_123")
    expect(url).toContain("key=KEY_123")
    expect(url).toContain("short_desc=")
    expect(url).toContain("PRICE+RECEIVED")
    expect(url).toContain("format=JSON")
    expect(url).toContain("agg_level_desc=NATIONAL")
  })
})

describe("usdaResponseToDataPoint", () => {
  it("picks latest week_ending row", () => {
    const response = {
      data: [
        { week_ending: "2026-04-15", Value: "1.10" },
        { week_ending: "2026-05-10", Value: "1.25" },
        { week_ending: "2026-03-01", Value: "1.05" },
      ],
    }
    const point = usdaResponseToDataPoint(response, BROILER_SERIES)
    expect(point).toBeTruthy()
    expect(point!.value).toBe(1.25)
    expect(point!.datetime.toISOString().slice(0, 10)).toBe("2026-05-10")
  })

  it("falls back to year+month when week_ending absent", () => {
    const point = usdaResponseToDataPoint(
      {
        data: [
          { year: 2026, reference_period_desc: "JANUARY", Value: 1.1 },
          { year: 2026, reference_period_desc: "MARCH", Value: 1.3 },
        ],
      },
      BROILER_SERIES,
    )
    expect(point!.value).toBe(1.3)
    expect(point!.datetime.toISOString().slice(0, 7)).toBe("2026-03")
  })

  it("returns null on empty/malformed", () => {
    expect(usdaResponseToDataPoint({}, BROILER_SERIES)).toBeNull()
    expect(usdaResponseToDataPoint({ data: [] }, BROILER_SERIES)).toBeNull()
    expect(
      usdaResponseToDataPoint({ data: [{ Value: "NaN" }] }, BROILER_SERIES),
    ).toBeNull()
  })

  it("coerces string Value to number, strips thousand separators", () => {
    const point = usdaResponseToDataPoint(
      { data: [{ week_ending: "2026-05-10", Value: "1,250.5" }] },
      BROILER_SERIES,
    )
    expect(point!.value).toBe(1250.5)
  })

  it("applies divisor when series declares one (HEAD → thousand-head)", () => {
    // CHICK_PLACEMENT series uses divisor: 1000 — NASS reports raw
    // head count, we emit thousand-head so threshold values stay in
    // a manageable range.
    const placementSeries = USDA_SERIES.find(
      (s) => s.metric === "CHICK_PLACEMENT_THOUSAND",
    )!
    expect(placementSeries.divisor).toBe(1000)
    const point = usdaResponseToDataPoint(
      { data: [{ week_ending: "2026-05-10", Value: "187,500,000" }] },
      placementSeries,
    )
    // 187.5M head / 1000 = 187500 thousand-head
    expect(point!.value).toBe(187500)
    expect((point!.raw as Record<string, unknown>).divisorApplied).toBe(1000)
  })
})

describe("createUSDANassAdapter", () => {
  it("returns api_key_missing when no key", async () => {
    const adapter = createUSDANassAdapter({})
    const result = await adapter.fetch()
    expect(result.fetched).toBe(false)
    expect(result.errors[0]).toContain("api_key_missing")
    expect(result.dataPoints).toEqual([])
  })

  it("fetches all 3 series when key provided", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: [{ week_ending: "2026-05-10", Value: 1.0 }] }),
          { status: 200 },
        ),
    )
    const adapter = createUSDANassAdapter({
      apiKey: "test-key",
      fetchImpl: fetchImpl as never,
    })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.dataPoints.length).toBe(3)
    expect(result.dataPoints.map((p) => p.metric).sort()).toEqual([
      "BROILER_PRICE_USD_LB",
      "CHICK_PLACEMENT_THOUSAND",
      "EGG_PRICE_USD_DOZ",
    ])
    for (const p of result.dataPoints) {
      expect(p.sourceCode).toBe(USDA_NASS_SOURCE)
    }
  })

  it("isolates per-series HTTP errors", async () => {
    let call = 0
    const fetchImpl = vi.fn(async () => {
      call++
      if (call === 1) return new Response("denied", { status: 401 })
      return new Response(
        JSON.stringify({ data: [{ week_ending: "2026-05-10", Value: 1.5 }] }),
        { status: 200 },
      )
    })
    const adapter = createUSDANassAdapter({
      apiKey: "test-key",
      fetchImpl: fetchImpl as never,
    })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.dataPoints.length).toBe(2)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toContain("HTTP 401")
  })
})
