/**
 * Phase 7.I — Yahoo Finance sugar adapter tests.
 *
 * Locks the cents/lb → USD/tonne conversion math + timestamp anchoring,
 * since downstream indicator thresholds depend on the right unit.
 */

import { describe, it, expect, vi } from "vitest"
import {
  createSugarYahooAdapter,
  yahooSugarResponseToDataPoints,
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
