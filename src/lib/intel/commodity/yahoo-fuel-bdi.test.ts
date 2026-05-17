/**
 * Tests for the Yahoo fuel + Baltic Dry Index adapter.
 */
import { describe, it, expect, vi } from "vitest"
import {
  fuelBdiResponseToDataPoints,
  createYahooFuelBdiAdapter,
  YAHOO_FUEL_BDI_SOURCE,
  FUEL_BDI_SYMBOLS,
} from "./yahoo-fuel-bdi"

function makeYahooResponse(prices: Array<number | null>) {
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

describe("fuelBdiResponseToDataPoints", () => {
  it("emits BDI as raw points (factor 1.0)", () => {
    const bdi = FUEL_BDI_SYMBOLS.find((s) => s.metric === "BALTIC_DRY_INDEX")!
    const points = fuelBdiResponseToDataPoints(makeYahooResponse([1500]), bdi)
    expect(points[0].value).toBe(1500)
    expect(points[0].unit).toBe("index")
  })

  it("converts ULSD USD/gal → USD/litre", () => {
    const diesel = FUEL_BDI_SYMBOLS.find((s) => s.metric === "DIESEL_USD_LITRE")!
    // 2.50 USD/gal × 0.264172 = 0.660 USD/L (rounded to 3 decimals)
    const points = fuelBdiResponseToDataPoints(makeYahooResponse([2.5]), diesel)
    expect(points[0].value).toBe(0.66)
  })

  it("returns [] on malformed payload", () => {
    expect(fuelBdiResponseToDataPoints({}, FUEL_BDI_SYMBOLS[0])).toEqual([])
  })
})

describe("createYahooFuelBdiAdapter", () => {
  it("returns adapter with correct contract", () => {
    const adapter = createYahooFuelBdiAdapter()
    expect(adapter.source).toBe(YAHOO_FUEL_BDI_SOURCE)
  })

  it("fetches all 3 series", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(makeYahooResponse([1000])), { status: 200 }),
    )
    const adapter = createYahooFuelBdiAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.dataPoints.length).toBe(3)
    expect(result.dataPoints.map((p) => p.metric).sort()).toEqual([
      "BALTIC_DRY_INDEX",
      "DIESEL_USD_LITRE",
      "GASOLINE_USD_LITRE",
    ])
  })

  it("isolates per-series HTTP errors", async () => {
    let call = 0
    const fetchImpl = vi.fn(async () => {
      call++
      if (call === 1) return new Response("err", { status: 500 })
      return new Response(JSON.stringify(makeYahooResponse([100])), { status: 200 })
    })
    const adapter = createYahooFuelBdiAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.dataPoints.length).toBe(2)
    expect(result.errors[0]).toContain("HTTP 500")
  })
})
