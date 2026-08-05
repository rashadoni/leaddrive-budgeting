// @vitest-environment node
import { describe, it, expect, vi } from "vitest"
import { createWorldBankCPIAdapter, wbResponseToDataPoints, WB_CPI_SOURCE,
  WB_USER_AGENT,
} from "./worldbank-cpi"

describe("wbResponseToDataPoints — pure parser", () => {
  it("parses WB 2-element envelope into data points", () => {
    const wb: [unknown, Array<{ date: string; value: number; countryiso3code: string }>] = [
      { lastupdated: "2026-04-01" },
      [
        { date: "2024", value: 9.7, countryiso3code: "AZE" },
        { date: "2023", value: 8.8, countryiso3code: "AZE" },
        { date: "2022", value: 13.9, countryiso3code: "AZE" },
      ],
    ]
    const points = wbResponseToDataPoints(wb, "AZ")
    expect(points).toHaveLength(3)
    expect(points[0]).toMatchObject({
      sourceCode: WB_CPI_SOURCE,
      metric: "AZ_CPI_YOY",
      value: 9.7,
      unit: "%",
    })
    // Anchored to YYYY-12-31 UTC
    expect(points[0].datetime.toISOString()).toBe("2024-12-31T00:00:00.000Z")
  })

  it("drops null values (WB serves null for unavailable years)", () => {
    const wb: [unknown, Array<{ date: string; value: number | null; countryiso3code: string }>] = [
      {},
      [
        { date: "2024", value: null, countryiso3code: "AZE" },
        { date: "2023", value: 8.8, countryiso3code: "AZE" },
      ],
    ]
    const points = wbResponseToDataPoints(wb, "AZ")
    expect(points).toHaveLength(1)
    expect(points[0].value).toBe(8.8)
  })

  it("returns empty when response is not a 2-element array", () => {
    expect(wbResponseToDataPoints({} as never, "AZ")).toEqual([])
    expect(wbResponseToDataPoints([], "AZ")).toEqual([])
    expect(wbResponseToDataPoints([{}], "AZ")).toEqual([])
  })

  it("drops malformed rows (missing date)", () => {
    const wb: [unknown, unknown[]] = [
      {},
      [{ value: 5.5, countryiso3code: "AZE" }, { date: "2024", value: 10, countryiso3code: "AZE" }],
    ]
    const points = wbResponseToDataPoints(wb, "AZ")
    expect(points).toHaveLength(1)
  })
})

describe("createWorldBankCPIAdapter — fetch loop", () => {
  it("loops over all 5 countries (AZ/RU/TR/GE/IR), aggregating points", async () => {
    let callCount = 0
    const fetchImpl = vi.fn(async () => {
      callCount++
      return {
        ok: true,
        status: 200,
        json: async () => [
          { lastupdated: "2026-04-01" },
          [{ date: "2024", value: 5.0 + callCount, countryiso3code: "XXX" }],
        ],
      }
    }) as unknown as typeof fetch
    const adapter = createWorldBankCPIAdapter({ fetchImpl })
    const result = await adapter.fetch()
    expect(callCount).toBe(5) // AZ, RU, TR, GE, IR
    expect(result.dataPoints).toHaveLength(5)
    expect(result.fetched).toBe(true)
  })

  it("continues loop when one country fails", async () => {
    let n = 0
    const fetchImpl = vi.fn(async () => {
      n++
      if (n === 2) {
        // 2nd country (RU) → simulate 503
        return { ok: false, status: 503, json: async () => ({}) }
      }
      return {
        ok: true,
        status: 200,
        json: async () => [{}, [{ date: "2024", value: 5.0, countryiso3code: "AZE" }]],
      }
    }) as unknown as typeof fetch
    const adapter = createWorldBankCPIAdapter({ fetchImpl })
    const result = await adapter.fetch()
    // 4 succeed (AZ, TR, GE, IR), 1 errors (RU)
    expect(result.dataPoints).toHaveLength(4)
    expect(result.errors.some((e) => e.includes("RU") && e.includes("HTTP 503"))).toBe(true)
  })

  it("handles network throw per-country", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ENETUNREACH")
    }) as unknown as typeof fetch
    const adapter = createWorldBankCPIAdapter({ fetchImpl })
    const result = await adapter.fetch()
    expect(result.dataPoints).toEqual([])
    expect(result.errors).toHaveLength(5)
    expect(result.fetched).toBe(false)
  })

  it("reports an empty response as unpublished, not as a failed run", async () => {
    // 2026-08-05 — "the API answered, it just has no rows for this country"
    // is a fact about the upstream, not a fault in the run.
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [{}, []], // valid envelope but no data points
    })) as unknown as typeof fetch
    const adapter = createWorldBankCPIAdapter({ fetchImpl })
    const result = await adapter.fetch()
    expect(result.dataPoints).toEqual([])
    expect(result.errors).toEqual([])
    expect(result.unpublished?.length).toBe(5)
    for (const e of result.unpublished ?? [])
      expect(e).toContain("no usable data points")
  })

  it("still fails the run on an HTTP error", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
    })) as unknown as typeof fetch
    const result = await createWorldBankCPIAdapter({ fetchImpl }).fetch()
    expect(result.errors.length).toBe(5)
    expect(result.unpublished ?? []).toEqual([])
  })
})

describe("createWorldBankCPIAdapter — the User-Agent is not optional", () => {
  // 2026-08-04 — every scheduled run recorded five 403s, one per country,
  // and the adapter had therefore never succeeded on the server. Measured
  // against the live API from the production host: `User-Agent: node` (what
  // Node's global fetch sends) is refused 403, while undici/empty/browser
  // agents all return 200. So this header is load-bearing, not politeness,
  // and a regression that drops it is silent — the run still "works", it
  // just returns nothing for every country.
  it("sends an identifying User-Agent on every request", async () => {
    const seen: Array<Record<string, string> | undefined> = []
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(init?.headers as Record<string, string> | undefined)
      return {
        ok: true,
        status: 200,
        json: async () => [{ page: 1 }, []],
      } as unknown as Response
    })
    const adapter = createWorldBankCPIAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await adapter.fetch()

    expect(seen).toHaveLength(5) // AZ, RU, TR, GE, IR
    for (const headers of seen) {
      expect(headers?.["User-Agent"]).toBe(WB_USER_AGENT)
    }
  })

  it("does not identify as bare `node`, which the API rejects", () => {
    expect(WB_USER_AGENT).not.toBe("node")
    expect(WB_USER_AGENT).toContain("BudgetPro")
  })
})
