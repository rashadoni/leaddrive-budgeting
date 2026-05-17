/**
 * Tests for the Yahoo Finance grains adapter.
 *
 * Covers:
 *  - Conversion math (cents/bushel → USD/tonne) for each grain
 *  - Per-series error isolation (one symbol fails, others succeed)
 *  - 5 series × ≤12 months = bounded output
 *  - Idempotency: 1st-of-month UTC anchor
 */
import { describe, it, expect, vi } from "vitest"
import {
  yahooGrainsResponseToDataPoints,
  createYahooGrainsAdapter,
  YAHOO_GRAINS_SOURCE_CODE,
  YAHOO_GRAINS_SYMBOLS,
} from "./yahoo-grains"

/** Build a 2-month canned Yahoo response for any symbol. */
function makeYahooResponse(prices: Array<number | null>) {
  // 2026-04-01 + 2026-05-01 UTC
  const ts = [1743465600, 1746057600]
  return {
    chart: {
      result: [
        {
          timestamp: ts.slice(0, prices.length),
          indicators: { quote: [{ close: prices }] },
        },
      ],
      error: null,
    },
  }
}

describe("yahooGrainsResponseToDataPoints", () => {
  it("converts corn cents/bushel → USD/tonne", () => {
    const cornSym = YAHOO_GRAINS_SYMBOLS.find((s) => s.metric === "CORN_USD_TONNE")!
    const points = yahooGrainsResponseToDataPoints(makeYahooResponse([450]), cornSym)
    expect(points.length).toBe(1)
    // 450 × 0.393682 = 177.16... → rounded to 177.2
    expect(points[0].value).toBe(177.2)
    expect(points[0].metric).toBe("CORN_USD_TONNE")
    expect(points[0].unit).toBe("USD/tonne")
  })

  it("converts cotton cents/lb → USD/tonne", () => {
    const cotSym = YAHOO_GRAINS_SYMBOLS.find((s) => s.metric === "COTTON_USD_TONNE")!
    const points = yahooGrainsResponseToDataPoints(makeYahooResponse([75]), cotSym)
    // 75 cents/lb × 22.0462 = 1653.465 → 1653.5
    expect(points[0].value).toBe(1653.5)
  })

  it("anchors datetime to 1st-of-month UTC", () => {
    const sym = YAHOO_GRAINS_SYMBOLS[0]
    const points = yahooGrainsResponseToDataPoints(makeYahooResponse([400, 410]), sym)
    expect(points.length).toBe(2)
    for (const p of points) {
      expect(p.datetime.getUTCDate()).toBe(1)
      expect(p.datetime.getUTCHours()).toBe(0)
    }
  })

  it("skips null / NaN closes (mid-day open bars)", () => {
    const sym = YAHOO_GRAINS_SYMBOLS[0]
    const points = yahooGrainsResponseToDataPoints(
      makeYahooResponse([400, null]),
      sym,
    )
    expect(points.length).toBe(1)
  })

  it("returns [] on malformed payload", () => {
    expect(yahooGrainsResponseToDataPoints({}, YAHOO_GRAINS_SYMBOLS[0])).toEqual([])
    expect(
      yahooGrainsResponseToDataPoints(
        { chart: { result: [] } },
        YAHOO_GRAINS_SYMBOLS[0],
      ),
    ).toEqual([])
  })

  it("trims to last N months", () => {
    const sym = YAHOO_GRAINS_SYMBOLS[0]
    // 5 prices but maxMonths=2 → only last 2 returned
    const longResponse = {
      chart: {
        result: [
          {
            timestamp: [1, 2, 3, 4, 5].map((m) => Date.UTC(2026, m - 1, 1) / 1000),
            indicators: { quote: [{ close: [400, 410, 420, 430, 440] }] },
          },
        ],
        error: null,
      },
    }
    const points = yahooGrainsResponseToDataPoints(longResponse, sym, 2)
    expect(points.length).toBe(2)
    expect(points[1].raw).toMatchObject({ closeRaw: 440 })
  })
})

describe("createYahooGrainsAdapter", () => {
  it("returns adapter with correct contract", () => {
    const adapter = createYahooGrainsAdapter()
    expect(adapter.source).toBe(YAHOO_GRAINS_SOURCE_CODE)
    expect(adapter.label).toContain("Yahoo")
  })

  it("fetches all 5 series and aggregates points", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(makeYahooResponse([500])), { status: 200 }),
    )
    const adapter = createYahooGrainsAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.errors).toEqual([])
    // 5 symbols × 1 month each
    expect(result.dataPoints.length).toBe(5)
    const metrics = result.dataPoints.map((p) => p.metric).sort()
    expect(metrics).toEqual([
      "CORN_USD_TONNE",
      "COTTON_USD_TONNE",
      "OATS_USD_TONNE",
      "SOYBEAN_USD_TONNE",
      "WHEAT_USD_TONNE",
    ])
  })

  it("isolates per-series HTTP errors", async () => {
    let call = 0
    const fetchImpl = vi.fn(async () => {
      call++
      if (call === 1) return new Response("denied", { status: 403 })
      return new Response(JSON.stringify(makeYahooResponse([500])), { status: 200 })
    })
    const adapter = createYahooGrainsAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.dataPoints.length).toBe(4) // 1 failed, 4 succeeded
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toContain("HTTP 403")
  })

  it("returns fetched=false when every fetch throws (network-level)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED")
    })
    const adapter = createYahooGrainsAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(false)
    expect(result.errors.length).toBe(5) // every symbol failed
    for (const e of result.errors) expect(e).toContain("ECONNREFUSED")
  })

  it("sends User-Agent header (Yahoo rejects without it)", async () => {
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify(makeYahooResponse([500])), { status: 200 }),
    )
    const adapter = createYahooGrainsAdapter({ fetchImpl: fetchImpl as never })
    await adapter.fetch()
    const init = fetchImpl.mock.calls[0]?.[1]
    expect(init?.headers).toMatchObject({ "User-Agent": expect.stringContaining("BudgetPro") })
  })
})
