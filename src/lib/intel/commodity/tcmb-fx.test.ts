// @vitest-environment node
import { describe, it, expect, vi } from "vitest"
import { createTCMBAdapter, tcmbResponseToDataPoints, TCMB_FX_SOURCE } from "./tcmb-fx"

const NOW = new Date("2026-05-10T20:00:00.000Z")
const DAY_UTC = new Date("2026-05-10T00:00:00.000Z")

function makeFetchOk(body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  })) as unknown as typeof fetch
}

describe("tcmbResponseToDataPoints — pure parser", () => {
  it("parses USD/EUR/RUB/TRY rates into 4 data points", () => {
    const points = tcmbResponseToDataPoints(
      {
        success: true,
        base: "AZN",
        date: "2026-05-10",
        rates: { USD: 0.5882, EUR: 0.5421, RUB: 53.2, TRY: 18.5 },
      },
      NOW,
    )
    expect(points).toHaveLength(4)
    expect(points[0]).toMatchObject({
      sourceCode: TCMB_FX_SOURCE,
      metric: "AZN_USD",
      value: 0.5882,
      unit: "USD/AZN",
    })
    expect(points[0].datetime.getTime()).toBe(DAY_UTC.getTime())
  })

  it("anchors datetime to UTC midnight (idempotency key)", () => {
    const points = tcmbResponseToDataPoints(
      { rates: { USD: 0.58 } },
      new Date("2026-05-10T23:59:59.999Z"),
    )
    expect(points[0].datetime.toISOString()).toBe("2026-05-10T00:00:00.000Z")
  })

  it("drops rates with non-finite values", () => {
    const points = tcmbResponseToDataPoints(
      {
        rates: {
          USD: 0.58,
          EUR: NaN,
          RUB: Infinity,
          TRY: 18.5,
        },
      },
      NOW,
    )
    expect(points.map((p) => p.metric)).toEqual(["AZN_USD", "AZN_TRY"])
  })

  it("returns empty when rates field is missing", () => {
    expect(tcmbResponseToDataPoints({}, NOW)).toEqual([])
    expect(tcmbResponseToDataPoints({ rates: undefined }, NOW)).toEqual([])
  })

  it("orders data points per TCMB_QUOTE_PAIRS const (USD, EUR, RUB, TRY)", () => {
    const points = tcmbResponseToDataPoints(
      { rates: { TRY: 18.5, RUB: 53.2, EUR: 0.54, USD: 0.58 } },
      NOW,
    )
    expect(points.map((p) => p.metric)).toEqual(["AZN_USD", "AZN_EUR", "AZN_RUB", "AZN_TRY"])
  })
})

describe("createTCMBAdapter — fetch happy path", () => {
  it("calls API + returns 4 data points on full response", async () => {
    const fetchImpl = makeFetchOk({
      success: true,
      base: "AZN",
      date: "2026-05-10",
      rates: { USD: 0.58, EUR: 0.54, RUB: 53.2, TRY: 18.5 },
    })
    const adapter = createTCMBAdapter({ fetchImpl })
    const result = await adapter.fetch(NOW)
    expect(result.fetched).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.dataPoints).toHaveLength(4)
    expect(result.source).toBe(TCMB_FX_SOURCE)
  })

  it("includes base + symbols in URL query string", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ rates: { USD: 0.58 } }),
    })) as unknown as typeof fetch
    const adapter = createTCMBAdapter({ fetchImpl })
    await adapter.fetch(NOW)
    const calledUrl = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(calledUrl).toContain("base=AZN")
    expect(calledUrl).toContain("symbols=USD,EUR,RUB,TRY")
  })

  it("surfaces HTTP error as errors[]", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as unknown as typeof fetch
    const adapter = createTCMBAdapter({ fetchImpl })
    const result = await adapter.fetch(NOW)
    expect(result.dataPoints).toEqual([])
    expect(result.errors[0]).toContain("HTTP 503")
    expect(result.fetched).toBe(true)
  })

  it("surfaces network throw as errors[]", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ENETUNREACH")
    }) as unknown as typeof fetch
    const adapter = createTCMBAdapter({ fetchImpl })
    const result = await adapter.fetch(NOW)
    expect(result.dataPoints).toEqual([])
    expect(result.errors[0]).toContain("ENETUNREACH")
    expect(result.fetched).toBe(false)
  })

  it("surfaces JSON parse failure", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <")
      },
    })) as unknown as typeof fetch
    const adapter = createTCMBAdapter({ fetchImpl })
    const result = await adapter.fetch(NOW)
    expect(result.errors[0]).toContain("JSON parse failed")
  })

  it("populates errors[] when response has no usable rates", async () => {
    const fetchImpl = makeFetchOk({ success: true, base: "AZN", rates: {} })
    const adapter = createTCMBAdapter({ fetchImpl })
    const result = await adapter.fetch(NOW)
    expect(result.dataPoints).toEqual([])
    expect(result.errors[0]).toContain("no usable rates")
  })
})
