/**
 * Tests for the AZ State Statistics CPI breakdown adapter.
 *
 * Covers:
 *  - CSV parser (comma + semicolon delimiters, quoted cells, decimal
 *    comma normalization)
 *  - Category-to-metric mapping (English + AZ-cyrillic spellings)
 *  - 1 point per (category, month)
 *  - Idempotency: UTC 1st-of-month anchor
 *  - Unknown categories silently dropped
 *  - Graceful 404 / empty CSV
 */
import { describe, it, expect, vi } from "vitest"
import {
  parseAzCpiCsv,
  azCpiRowsToDataPoints,
  createAzStatCpiAdapter,
  AZ_STAT_CPI_SOURCE,
  AZ_CPI_CATEGORY_MAP,
} from "./az-stat-cpi"

const SAMPLE_CSV = `category,year,month,value
"All-items",2026,1,101.5
"All-items",2026,2,102.2
"All-items",2026,3,102.9
"Food",2026,1,103.2
"Food",2026,2,104.1
"Food",2026,3,105.0
"Non-Food",2026,1,100.8
"Services",2026,3,102.4
"Housing",2026,3,103.1
"UnknownCategory",2026,1,99.0
`

describe("parseAzCpiCsv", () => {
  it("maps recognized categories and skips unknowns", () => {
    const rows = parseAzCpiCsv(SAMPLE_CSV)
    expect(rows.length).toBe(9) // 10 data rows minus 1 unknown
    expect(rows.find((r) => r.category === "UnknownCategory")).toBeUndefined()
  })

  it("maps all 5 known categories correctly", () => {
    const rows = parseAzCpiCsv(SAMPLE_CSV)
    const metrics = new Set(rows.map((r) => r.metric))
    expect(metrics).toEqual(
      new Set([
        "AZ_CPI_ALL_ITEMS",
        "AZ_CPI_FOOD",
        "AZ_CPI_NON_FOOD",
        "AZ_CPI_SERVICES",
        "AZ_CPI_HOUSING",
      ]),
    )
  })

  it("handles semicolon delimiter", () => {
    const csv = `category;year;month;value
"Food";2026;5;105.5`
    const rows = parseAzCpiCsv(csv)
    expect(rows.length).toBe(1)
    expect(rows[0].metric).toBe("AZ_CPI_FOOD")
    expect(rows[0].value).toBe(105.5)
  })

  it("normalizes decimal commas (Euro-style numbers)", () => {
    const csv = `Food,2026,5,"105,5"`
    const rows = parseAzCpiCsv(csv)
    expect(rows[0].value).toBe(105.5)
  })

  it("recognizes AZ-cyrillic category names", () => {
    const csv = `Ərzaq,2026,5,105`
    const rows = parseAzCpiCsv(csv)
    expect(rows[0].metric).toBe("AZ_CPI_FOOD")
  })

  it("rejects rows with bad month (out of 1-12)", () => {
    const csv = `Food,2026,13,105
Food,2026,0,105
Food,2026,5,105`
    const rows = parseAzCpiCsv(csv)
    expect(rows.length).toBe(1)
    expect(rows[0].month).toBe(5)
  })

  it("returns [] on empty/garbage CSV", () => {
    expect(parseAzCpiCsv("")).toEqual([])
    expect(parseAzCpiCsv("not a real csv")).toEqual([])
  })

  it("category map is case-insensitive", () => {
    const csv = `FOOD,2026,1,103
food,2026,2,104
Food,2026,3,105`
    const rows = parseAzCpiCsv(csv)
    expect(rows.length).toBe(3)
  })
})

describe("azCpiRowsToDataPoints", () => {
  it("anchors datetime to UTC 1st-of-month", () => {
    const points = azCpiRowsToDataPoints([
      { category: "Food", metric: "AZ_CPI_FOOD", year: 2026, month: 5, value: 104.2 },
    ])
    expect(points[0].datetime.toISOString()).toBe("2026-05-01T00:00:00.000Z")
    expect(points[0].sourceCode).toBe(AZ_STAT_CPI_SOURCE)
    expect(points[0].unit).toBe("index")
  })
})

describe("createAzStatCpiAdapter", () => {
  it("returns adapter with correct contract", () => {
    const adapter = createAzStatCpiAdapter()
    expect(adapter.source).toBe(AZ_STAT_CPI_SOURCE)
    expect(adapter.label).toContain("CPI")
  })

  it("fetches + parses successful CSV", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(SAMPLE_CSV, { status: 200 }),
    )
    const adapter = createAzStatCpiAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.dataPoints.length).toBe(9) // 10 - 1 unknown
  })

  it("returns 404 error gracefully", async () => {
    const fetchImpl = vi.fn(async () => new Response("not found", { status: 404 }))
    const adapter = createAzStatCpiAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.dataPoints).toEqual([])
    expect(result.errors[0]).toContain("HTTP 404")
  })

  it("returns error when CSV has 0 mappable rows", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("garbage\nunknown,1,1,1", { status: 200 }),
    )
    const adapter = createAzStatCpiAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.errors[0]).toContain("0 mappable rows")
  })

  it("returns fetched=false on network error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED")
    })
    const adapter = createAzStatCpiAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(false)
    expect(result.errors[0]).toContain("ECONNREFUSED")
  })

  it("honors csvUrl override", async () => {
    const fetchImpl = vi.fn<(url: string) => Promise<Response>>(
      async () => new Response("Food,2026,5,105", { status: 200 }),
    )
    const customUrl = "https://my-org.local/cpi.csv"
    const adapter = createAzStatCpiAdapter({
      fetchImpl: fetchImpl as never,
      csvUrl: customUrl,
    })
    await adapter.fetch()
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(customUrl)
  })

  it("category map covers ≥10 keys (forward-compat)", () => {
    expect(Object.keys(AZ_CPI_CATEGORY_MAP).length).toBeGreaterThanOrEqual(10)
  })
})
