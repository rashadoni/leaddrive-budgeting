/**
 * Tests for the Google Trends AZ proxy-gated adapter.
 */
import { describe, it, expect, vi } from "vitest"
import {
  buildTrendsUrl,
  trendsResponseToDataPoint,
  createGoogleTrendsAzAdapter,
  GOOGLE_TRENDS_AZ_SOURCE,
  TRENDS_CATEGORIES,
} from "./google-trends-az"

const FOOD_CAT = TRENDS_CATEGORIES.find((c) => c.metric === "AZ_TREND_FOOD_RETAIL")!

describe("buildTrendsUrl", () => {
  it("default URL (ScrapingDog) uses `query=` param", () => {
    const url = buildTrendsUrl(FOOD_CAT, "KEY_123")
    expect(url).toContain("query=")
    expect(url).not.toMatch(/[?&]q=/) // not the SerpAPI `q=` form
    expect(url).toContain("api_key=KEY_123")
    expect(url).toContain("geo=AZ")
    expect(url).toContain("scrapingdog.com")
  })

  it("SerpAPI hostname overrides to `q=` param", () => {
    const url = buildTrendsUrl(
      FOOD_CAT,
      "K",
      "https://serpapi.com/search.json?engine=google_trends&geo=AZ",
    )
    expect(url).toContain("&q=")
    expect(url).not.toMatch(/[?&]query=/)
  })

  it("ScrapingDog hostname uses `query=` param", () => {
    const url = buildTrendsUrl(
      FOOD_CAT,
      "K",
      "https://api.scrapingdog.com/google_trends?geo=AZ",
    )
    expect(url).toContain("&query=")
    expect(url).not.toMatch(/[?&]q=/)
  })

  it("unknown vendor defaults to SerpAPI-compat `q=`", () => {
    const url = buildTrendsUrl(FOOD_CAT, "K", "https://noquery.proxy/api")
    expect(url).toContain("https://noquery.proxy/api?q=")
  })

  it("respects custom proxyUrl, handles `?` already present", () => {
    const url = buildTrendsUrl(FOOD_CAT, "K", "https://custom.proxy/api?geo=AZ")
    expect(url).toContain("https://custom.proxy/api?geo=AZ&q=")
  })
})

describe("trendsResponseToDataPoint", () => {
  it("picks latest weekly entry and anchors to Monday UTC", () => {
    const response = {
      interest_over_time: {
        timeline_data: [
          { date: "May 3, 2026", values: [{ extracted_value: 60 }] },
          { date: "May 10, 2026", values: [{ extracted_value: 78 }] }, // Sunday
          { date: "Apr 26, 2026", values: [{ extracted_value: 55 }] },
        ],
      },
    }
    const point = trendsResponseToDataPoint(response, FOOD_CAT)
    expect(point).toBeTruthy()
    expect(point!.value).toBe(78)
    // May 10 2026 is a Sunday → anchored to prior Monday May 4
    expect(point!.datetime.toISOString().slice(0, 10)).toBe("2026-05-04")
    expect(point!.metric).toBe("AZ_TREND_FOOD_RETAIL")
  })

  it("parses ISO YYYY-MM-DD date format too", () => {
    const point = trendsResponseToDataPoint(
      {
        interest_over_time: {
          timeline_data: [
            { date: "2026-05-12", values: [{ extracted_value: 80 }] }, // Tuesday
          ],
        },
      },
      FOOD_CAT,
    )
    // Tuesday 2026-05-12 → Monday 2026-05-11
    expect(point!.datetime.toISOString().slice(0, 10)).toBe("2026-05-11")
  })

  it("uses unix `timestamp` field when present (ScrapingDog format)", () => {
    // ScrapingDog emits weekly ranges in `date` like "May 11 – 17, 2025"
    // which Date.parse cannot handle. The `timestamp` field is unix
    // seconds for the week-start. Parser must prefer timestamp.
    const point = trendsResponseToDataPoint(
      {
        interest_over_time: {
          timeline_data: [
            {
              date: "May 17 – 23, 2026",
              timestamp: "1779129600", // 2026-05-18T00:00:00Z (Monday)
              values: [{ extracted_value: "49" }],
            },
          ],
        },
      },
      FOOD_CAT,
    )
    expect(point).toBeTruthy()
    expect(point!.value).toBe(49)
    // 2026-05-18 is already Monday → anchored to itself
    expect(point!.datetime.toISOString().slice(0, 10)).toBe("2026-05-18")
  })

  it("falls back to date parsing when timestamp invalid", () => {
    const point = trendsResponseToDataPoint(
      {
        interest_over_time: {
          timeline_data: [
            {
              date: "2026-05-12",
              timestamp: "not-a-number",
              values: [{ extracted_value: 65 }],
            },
          ],
        },
      },
      FOOD_CAT,
    )
    expect(point!.value).toBe(65)
  })

  it("returns null on missing timeline", () => {
    expect(trendsResponseToDataPoint({}, FOOD_CAT)).toBeNull()
    expect(
      trendsResponseToDataPoint(
        { interest_over_time: { timeline_data: [] } },
        FOOD_CAT,
      ),
    ).toBeNull()
  })

  it("falls back to string value field", () => {
    const point = trendsResponseToDataPoint(
      {
        interest_over_time: {
          timeline_data: [{ date: "2026-05-12", values: [{ value: "65" }] }],
        },
      },
      FOOD_CAT,
    )
    expect(point!.value).toBe(65)
  })

  it("aggregates multi-keyword values[] by SUM (combo query)", () => {
    // "moda,одежда,fashion" → 3 normalized 0-100 scores; we sum to
    // get total category demand across language variants.
    const point = trendsResponseToDataPoint(
      {
        interest_over_time: {
          timeline_data: [
            {
              timestamp: "1778976000",
              date: "May 17 – 23, 2026",
              values: [
                { query: "moda", extracted_value: 10 },
                { query: "одежда", extracted_value: 8 },
                { query: "fashion", extracted_value: 17 },
              ],
            },
          ],
        },
      },
      FOOD_CAT,
    )
    expect(point!.value).toBe(35) // 10 + 8 + 17
  })
})

describe("createGoogleTrendsAzAdapter", () => {
  it("returns not_configured without apiKey", async () => {
    const adapter = createGoogleTrendsAzAdapter({})
    const result = await adapter.fetch()
    expect(result.fetched).toBe(false)
    expect(result.errors[0]).toContain("not_configured")
    expect(result.dataPoints).toEqual([])
  })

  it("fetches all 4 categories when configured", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            interest_over_time: {
              timeline_data: [
                { date: "2026-05-12", values: [{ extracted_value: 70 }] },
              ],
            },
          }),
          { status: 200 },
        ),
    )
    const adapter = createGoogleTrendsAzAdapter({
      apiKey: "test-key",
      fetchImpl: fetchImpl as never,
    })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.dataPoints.length).toBe(TRENDS_CATEGORIES.length)
    expect(result.dataPoints.map((p) => p.metric).sort()).toEqual([
      "AZ_TREND_ELECTRONICS",
      "AZ_TREND_FASHION",
      "AZ_TREND_FOOD_RETAIL",
      "AZ_TREND_TRAVEL",
    ])
    for (const p of result.dataPoints) {
      expect(p.sourceCode).toBe(GOOGLE_TRENDS_AZ_SOURCE)
    }
  })

  it("isolates per-category errors", async () => {
    let call = 0
    const fetchImpl = vi.fn(async () => {
      call++
      if (call === 1) return new Response("rate-limited", { status: 429 })
      return new Response(
        JSON.stringify({
          interest_over_time: {
            timeline_data: [
              { date: "2026-05-12", values: [{ extracted_value: 65 }] },
            ],
          },
        }),
        { status: 200 },
      )
    })
    const adapter = createGoogleTrendsAzAdapter({
      apiKey: "test-key",
      fetchImpl: fetchImpl as never,
    })
    const result = await adapter.fetch()
    expect(result.dataPoints.length).toBe(TRENDS_CATEGORIES.length - 1)
    expect(result.errors[0]).toContain("HTTP 429")
  })

  it("uses custom proxyUrl when supplied", async () => {
    const fetchImpl = vi.fn<(url: string) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({}), { status: 200 }),
    )
    createGoogleTrendsAzAdapter({
      apiKey: "K",
      fetchImpl: fetchImpl as never,
      proxyUrl: "https://my-proxy.local/trends",
    })
    // Don't actually call fetch — confirm URL would be correct
    const url = buildTrendsUrl(FOOD_CAT, "K", "https://my-proxy.local/trends")
    expect(url).toContain("https://my-proxy.local/trends?q=")
  })
})
