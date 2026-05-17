/**
 * Tests for the EIA Energy adapter.
 *
 * Covers:
 *  - api_key_missing graceful path (no fetch attempted)
 *  - JSON parser picks latest row by period
 *  - 3 series → 3 data points
 *  - Per-series error isolation (one fail doesn't block others)
 */
import { describe, it, expect, vi } from "vitest"
import {
  eiaResponseToDataPoint,
  createEIAEnergyAdapter,
  EIA_ENERGY_SOURCE,
} from "./eia-energy"

const BRENT_SERIES = {
  metric: "BRENT_USD_BBL",
  unit: "USD/bbl",
  route: "petroleum/pri/spt/data",
  facets: { product: "EPCBRENT" },
}

describe("eiaResponseToDataPoint", () => {
  it("picks the latest period row", () => {
    const response = {
      response: {
        data: [
          { period: "2026-04-15", value: 82.5 },
          { period: "2026-05-15", value: 85.1 },
          { period: "2026-03-15", value: 80.2 },
        ],
      },
    }
    const point = eiaResponseToDataPoint(response, BRENT_SERIES)
    expect(point).toBeTruthy()
    expect(point!.value).toBe(85.1)
    expect(point!.datetime.toISOString().slice(0, 10)).toBe("2026-05-15")
  })

  it("returns null on empty/malformed data", () => {
    expect(eiaResponseToDataPoint({}, BRENT_SERIES)).toBeNull()
    expect(eiaResponseToDataPoint({ response: { data: [] } }, BRENT_SERIES)).toBeNull()
    expect(eiaResponseToDataPoint({ response: { data: [{ period: "2026-01-01", value: "NaN" }] } }, BRENT_SERIES)).toBeNull()
  })

  it("handles YYYY-MM period (monthly series)", () => {
    const point = eiaResponseToDataPoint(
      { response: { data: [{ period: "2026-05", value: 85.0 }] } },
      BRENT_SERIES,
    )
    expect(point!.datetime.toISOString().slice(0, 10)).toBe("2026-05-01")
  })

  it("coerces string value to number", () => {
    const point = eiaResponseToDataPoint(
      { response: { data: [{ period: "2026-05-15", value: "82.45" }] } },
      BRENT_SERIES,
    )
    expect(point!.value).toBe(82.45)
  })
})

describe("createEIAEnergyAdapter", () => {
  it("returns api_key_missing when no key supplied", async () => {
    const adapter = createEIAEnergyAdapter({})
    const result = await adapter.fetch()
    expect(result.fetched).toBe(false)
    expect(result.errors[0]).toContain("api_key_missing")
    expect(result.dataPoints).toEqual([])
  })

  it("fetches all 3 series when key provided", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            response: { data: [{ period: "2026-05-15", value: 85.0 }] },
          }),
          { status: 200 },
        ),
    )
    const adapter = createEIAEnergyAdapter({
      apiKey: "test-key",
      fetchImpl: fetchImpl as never,
    })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.dataPoints.length).toBe(3) // Brent + WTI + NatGas
    expect(result.dataPoints.map((p) => p.metric).sort()).toEqual([
      "BRENT_USD_BBL",
      "NATGAS_USD_MMBTU",
      "WTI_USD_BBL",
    ])
    for (const p of result.dataPoints) {
      expect(p.sourceCode).toBe(EIA_ENERGY_SOURCE)
    }
  })

  it("isolates per-series failures", async () => {
    let call = 0
    const fetchImpl = vi.fn(async () => {
      call++
      if (call === 1) return new Response("denied", { status: 403 })
      return new Response(
        JSON.stringify({ response: { data: [{ period: "2026-05-15", value: 82.0 }] } }),
        { status: 200 },
      )
    })
    const adapter = createEIAEnergyAdapter({ apiKey: "test-key", fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.dataPoints.length).toBe(2) // 1 failed, 2 succeeded
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toContain("HTTP 403")
  })

  it("passes api_key in query string", async () => {
    const fetchImpl = vi.fn<(url: string) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ response: { data: [] } }), { status: 200 }),
    )
    const adapter = createEIAEnergyAdapter({ apiKey: "MY_SECRET", fetchImpl: fetchImpl as never })
    await adapter.fetch()
    const url = fetchImpl.mock.calls[0]?.[0] ?? ""
    expect(url).toContain("api_key=MY_SECRET")
    expect(url).toContain("facets%5Bproduct%5D%5B%5D=EPCBRENT")
  })
})
