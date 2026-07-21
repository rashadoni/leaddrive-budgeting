/**
 * Phase 7.I — Yahoo Finance sugar adapter tests.
 *
 * Locks the cents/lb → USD/tonne conversion math + timestamp anchoring,
 * since downstream indicator thresholds depend on the right unit.
 */

import { describe, it, expect, vi } from "vitest"
import {
  createSugarYahooAdapter,
  createSugarYahooHistoricalAdapter,
  sugarYahooHistoryRangeForYear,
  sugarYahooHistoricalUrl,
  yahooSugarResponseToDataPoints,
  yahooSugarHistoricalResponseToDataPoints,
  SUGAR_YAHOO_SOURCE,
  SUGAR_YAHOO_METRIC,
} from "./sugar-yahoo"

// Helper: monthly timestamp (1st of month UTC) → unix seconds.
const monthTs = (y: number, m: number) =>
  Math.floor(Date.UTC(y, m - 1, 1) / 1000)

describe("sugar-yahoo — pure response → data-points", () => {
  it("converts cents/lb closes to USD/tonne and anchors to 1st-of-month UTC", () => {
    // 22.0 cents/lb is a typical Sugar #11 quote.
    // 22.0 × 22.0462 = 485.0164 → rounds to 485.0
    const response = {
      chart: {
        result: [
          {
            timestamp: [monthTs(2026, 4)],
            indicators: { quote: [{ close: [22.0] }] },
          },
        ],
      },
    }
    const points = yahooSugarResponseToDataPoints(response)
    expect(points).toHaveLength(1)
    expect(points[0].metric).toBe(SUGAR_YAHOO_METRIC)
    expect(points[0].unit).toBe("USD/tonne")
    expect(points[0].value).toBe(485.0)
    expect(points[0].datetime.toISOString()).toBe("2026-04-01T00:00:00.000Z")
    expect(points[0].sourceCode).toBe(SUGAR_YAHOO_SOURCE)
  })

  it("drops null / NaN closes (Yahoo's mid-day current-bar null)", () => {
    const response = {
      chart: {
        result: [
          {
            timestamp: [monthTs(2026, 3), monthTs(2026, 4), monthTs(2026, 5)],
            indicators: { quote: [{ close: [20.5, null, Number.NaN] }] },
          },
        ],
      },
    }
    const points = yahooSugarResponseToDataPoints(response)
    expect(points).toHaveLength(1)
    expect(points[0].datetime.toISOString()).toBe("2026-03-01T00:00:00.000Z")
  })

  it("limits output to trailing N months (default 12)", () => {
    const timestamps = Array.from({ length: 24 }, (_, i) =>
      monthTs(2025, i + 1 > 12 ? i - 11 : i + 1),
    )
    // ↑ rough 2-year window; values don't matter for length assertion
    const closes = Array.from({ length: 24 }, () => 20)
    const response = {
      chart: {
        result: [{ timestamp: timestamps, indicators: { quote: [{ close: closes }] } }],
      },
    }
    const points = yahooSugarResponseToDataPoints(response)
    expect(points.length).toBeLessThanOrEqual(12)
  })

  it("supports custom maxMonths (e.g. last 3 months only)", () => {
    const timestamps = [monthTs(2026, 1), monthTs(2026, 2), monthTs(2026, 3), monthTs(2026, 4), monthTs(2026, 5)]
    const closes = [10, 12, 14, 16, 18]
    const response = {
      chart: {
        result: [{ timestamp: timestamps, indicators: { quote: [{ close: closes }] } }],
      },
    }
    const points = yahooSugarResponseToDataPoints(response, new Date(), 3)
    expect(points).toHaveLength(3)
    // Sorted ascending — last 3 = March, April, May
    expect(points[0].datetime.toISOString()).toBe("2026-03-01T00:00:00.000Z")
    expect(points[2].datetime.toISOString()).toBe("2026-05-01T00:00:00.000Z")
  })

  it("returns empty when result envelope malformed", () => {
    expect(yahooSugarResponseToDataPoints({})).toHaveLength(0)
    expect(yahooSugarResponseToDataPoints({ chart: {} })).toHaveLength(0)
    expect(yahooSugarResponseToDataPoints({ chart: { result: [] } })).toHaveLength(0)
  })
})

describe("sugar-yahoo — explicit historical range", () => {
  it("builds an exact 2025 URL with inclusive period1 and exclusive period2", () => {
    const range = sugarYahooHistoryRangeForYear(2025)
    expect(range.start.toISOString()).toBe("2025-01-01T00:00:00.000Z")
    expect(range.end.toISOString()).toBe("2026-01-01T00:00:00.000Z")
    const url = new URL(sugarYahooHistoricalUrl(range))
    expect(url.pathname).toContain("SB%3DF")
    expect(url.searchParams.get("interval")).toBe("1d")
    expect(url.searchParams.get("period1")).toBe(String(monthTs(2025, 1)))
    expect(url.searchParams.get("period2")).toBe(String(monthTs(2026, 1)))
    expect(url.searchParams.has("range")).toBe(false)
  })

  it("rejects invalid historical years and non-month-boundary ranges", () => {
    expect(() => sugarYahooHistoryRangeForYear(2025.5)).toThrow(/integer/)
    expect(() => sugarYahooHistoryRangeForYear(1899)).toThrow(/1900/)
    expect(() => sugarYahooHistoricalUrl({
      start: new Date("2025-01-15T00:00:00Z"),
      end: new Date("2026-01-01T00:00:00Z"),
    })).toThrow(/month-start/)
  })

  it("uses the final real daily close of a month when Yahoo monthly bars omit it", () => {
    const range = sugarYahooHistoryRangeForYear(2025)
    const june30 = Math.floor(Date.UTC(2025, 5, 30, 20) / 1000)
    const points = yahooSugarHistoricalResponseToDataPoints({
      chart: {
        result: [{
          timestamp: [
            Math.floor(Date.UTC(2025, 4, 30, 20) / 1000),
            Math.floor(Date.UTC(2025, 5, 2, 20) / 1000),
            june30,
            Math.floor(Date.UTC(2025, 6, 31, 20) / 1000),
          ],
          indicators: { quote: [{ close: [20, 18, 15.4799995, 21] }] },
        }],
      },
    }, range)
    const june = points.find((point) => point.datetime.toISOString() === "2025-06-01T00:00:00.000Z")
    expect(june?.value).toBe(341.3)
    expect(june?.raw).toMatchObject({
      closeCentsLb: 15.4799995,
      timestamp: june30,
      aggregation: "last_daily_close",
    })
  })

  it("keeps genuinely missing daily months missing and drops the exclusive period2 bar", () => {
    const range = sugarYahooHistoryRangeForYear(2025)
    const timestamps = Array.from({ length: 12 }, (_, i) =>
      monthTs(2025, i < 5 ? i + 1 : i + 2), // real absence of June
    )
    timestamps.push(monthTs(2026, 1)) // period2 boundary: must not enter 2025
    const points = yahooSugarHistoricalResponseToDataPoints({
      chart: {
        result: [{
          timestamp: timestamps,
          indicators: { quote: [{ close: timestamps.map(() => 20) }] },
        }],
      },
    }, range)
    expect(points).toHaveLength(11)
    expect(points.map((point) => point.datetime.toISOString())).not.toContain(
      "2025-06-01T00:00:00.000Z",
    )
    expect(points.map((point) => point.datetime.toISOString())).not.toContain(
      "2026-01-01T00:00:00.000Z",
    )
    expect(points[0].raw).toMatchObject({
      query: { symbol: "SB=F", period1Inclusive: true, period2Exclusive: true },
      requestedStart: "2025-01-01T00:00:00.000Z",
      requestedEnd: "2026-01-01T00:00:00.000Z",
      aggregation: "last_daily_close",
    })
  })
})

describe("sugar-yahoo — full adapter via mock fetch", () => {
  it("sends User-Agent header (Yahoo rate-limits empty UA)", async () => {
    const mockResponse = {
      chart: {
        result: [
          {
            timestamp: [monthTs(2026, 4)],
            indicators: { quote: [{ close: [21.5] }] },
          },
        ],
      },
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    } as Response)
    const adapter = createSugarYahooAdapter({ fetchImpl: fetchMock as typeof fetch })
    await adapter.fetch()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, options] = fetchMock.mock.calls[0]
    expect((options?.headers as Record<string, string>)["User-Agent"]).toMatch(/BudgetPro/)
  })

  it("surfaces Yahoo error codes as errors (without dropping any points)", async () => {
    const mockResponse = {
      chart: {
        result: [
          {
            timestamp: [monthTs(2026, 4)],
            indicators: { quote: [{ close: [22] }] },
          },
        ],
        error: { code: "Bad Request", description: "Invalid symbol" },
      },
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    } as Response)
    const adapter = createSugarYahooAdapter({ fetchImpl: fetchMock as typeof fetch })
    const result = await adapter.fetch()
    expect(result.errors).toContain("Yahoo error Bad Request: Invalid symbol")
    expect(result.dataPoints.length).toBeGreaterThan(0)
  })

  it("captures HTTP error as fetched=true with error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    } as Response)
    const adapter = createSugarYahooAdapter({ fetchImpl: fetchMock as typeof fetch })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.dataPoints).toHaveLength(0)
    expect(result.errors[0]).toMatch(/HTTP 429/)
  })

  it("captures network failure as fetched=false", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ETIMEDOUT"))
    const adapter = createSugarYahooAdapter({ fetchImpl: fetchMock as typeof fetch })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(false)
    expect(result.errors[0]).toMatch(/fetch failed.*ETIMEDOUT/)
  })
})

describe("sugar-yahoo — historical adapter via mock fetch", () => {
  it("uses the explicit historical URL and retains only in-range source bars", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        chart: {
          result: [{
            timestamp: [monthTs(2025, 12), monthTs(2026, 1)],
            indicators: { quote: [{ close: [20, 99] }] },
          }],
        },
      }),
    } as Response)
    const result = await createSugarYahooHistoricalAdapter(2025, {
      fetchImpl: fetchMock as typeof fetch,
    }).fetch()
    expect(result.dataPoints).toHaveLength(1)
    expect(result.dataPoints[0].datetime.toISOString()).toBe("2025-12-01T00:00:00.000Z")
    const [url, options] = fetchMock.mock.calls[0]
    expect(String(url)).toContain("period1=1735689600")
    expect(String(url)).toContain("period2=1767225600")
    expect(String(url)).toContain("interval=1d")
    expect((options?.headers as Record<string, string>)["User-Agent"]).toMatch(/history-backfill/)
  })

  it("keeps historical HTTP and network errors explicit", async () => {
    const http = await createSugarYahooHistoricalAdapter(2025, {
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch,
    }).fetch()
    expect(http.fetched).toBe(true)
    expect(http.errors[0]).toMatch(/HTTP 429/)

    const network = await createSugarYahooHistoricalAdapter(2025, {
      fetchImpl: vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch,
    }).fetch()
    expect(network.fetched).toBe(false)
    expect(network.errors[0]).toMatch(/fetch failed.*offline/)
  })
})
