/**
 * Tests for the Yahoo Finance metals + lumber adapter.
 *
 * Covers:
 *  - Conversion math per symbol (cents/lb, USD/short_ton, native)
 *  - Per-series error isolation
 *  - 4 series × ≤12 months bounded output
 *  - Idempotency: 1st-of-month UTC anchor
 */
import { describe, it, expect, vi } from "vitest"
import {
  yahooMetalsResponseToDataPoints,
  createYahooMetalsAdapter,
  YAHOO_METALS_SOURCE_CODE,
  YAHOO_METALS_SYMBOLS,
} from "./yahoo-metals"

function makeYahooResponse(prices: Array<number | null>) {
  const ts = [1743465600, 1746057600] // 2026-04-01, 2026-05-01 UTC
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

describe("yahooMetalsResponseToDataPoints", () => {
  it("converts copper cents/lb → USD/tonne", () => {
    const sym = YAHOO_METALS_SYMBOLS.find((s) => s.metric === "COPPER_USD_TONNE")!
    const points = yahooMetalsResponseToDataPoints(makeYahooResponse([450]), sym)
    expect(points.length).toBe(1)
    // 450 × 22.0462 = 9920.79 → 9920.8
    expect(points[0].value).toBe(9920.8)
    expect(points[0].unit).toBe("USD/tonne")
  })

  it("converts HRC steel short_ton → metric tonne", () => {
    const sym = YAHOO_METALS_SYMBOLS.find((s) => s.metric === "STEEL_USD_TONNE")!
    const points = yahooMetalsResponseToDataPoints(makeYahooResponse([800]), sym)
    // 800 × 1.10231 = 881.848 → 881.8
    expect(points[0].value).toBe(881.8)
  })

  it("passes aluminum / lumber through with factor=1 (native unit)", () => {
    const alSym = YAHOO_METALS_SYMBOLS.find((s) => s.metric === "ALUMINUM_USD_TONNE")!
    const alPoints = yahooMetalsResponseToDataPoints(makeYahooResponse([2500]), alSym)
    expect(alPoints[0].value).toBe(2500)

    const lbSym = YAHOO_METALS_SYMBOLS.find((s) => s.metric === "LUMBER_USD_MBF")!
    const lbPoints = yahooMetalsResponseToDataPoints(makeYahooResponse([520]), lbSym)
    expect(lbPoints[0].value).toBe(520)
    expect(lbPoints[0].unit).toBe("USD/MBF")
  })

  it("anchors datetime to 1st-of-month UTC", () => {
    const sym = YAHOO_METALS_SYMBOLS[0]
    const points = yahooMetalsResponseToDataPoints(makeYahooResponse([400, 410]), sym)
    expect(points.length).toBe(2)
    for (const p of points) {
      expect(p.datetime.getUTCDate()).toBe(1)
      expect(p.datetime.getUTCHours()).toBe(0)
    }
  })

  it("returns [] on malformed payload", () => {
    expect(yahooMetalsResponseToDataPoints({}, YAHOO_METALS_SYMBOLS[0])).toEqual([])
  })
})

describe("createYahooMetalsAdapter", () => {
  it("returns adapter with correct contract", () => {
    const adapter = createYahooMetalsAdapter()
    expect(adapter.source).toBe(YAHOO_METALS_SOURCE_CODE)
    expect(adapter.label).toContain("Yahoo")
  })

  it("fetches all 4 series and aggregates points", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(makeYahooResponse([1000])), { status: 200 }),
    )
    const adapter = createYahooMetalsAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.dataPoints.length).toBe(4)
    expect(result.dataPoints.map((p) => p.metric).sort()).toEqual([
      "ALUMINUM_USD_TONNE",
      "COPPER_USD_TONNE",
      "LUMBER_USD_MBF",
      "STEEL_USD_TONNE",
    ])
  })

  it("isolates per-series HTTP errors", async () => {
    let call = 0
    const fetchImpl = vi.fn(async () => {
      call++
      if (call === 1) return new Response("denied", { status: 403 })
      return new Response(JSON.stringify(makeYahooResponse([1000])), { status: 200 })
    })
    const adapter = createYahooMetalsAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.dataPoints.length).toBe(3)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toContain("HTTP 403")
  })

  it("returns fetched=false when every fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED")
    })
    const adapter = createYahooMetalsAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(false)
    expect(result.errors.length).toBe(4)
  })

  it("sends User-Agent header", async () => {
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify(makeYahooResponse([1000])), { status: 200 }),
    )
    const adapter = createYahooMetalsAdapter({ fetchImpl: fetchImpl as never })
    await adapter.fetch()
    const init = fetchImpl.mock.calls[0]?.[1]
    expect(init?.headers).toMatchObject({ "User-Agent": expect.stringContaining("BudgetPro") })
  })
})
