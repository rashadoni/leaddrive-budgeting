/**
 * Tests for the FAO Food Price Index adapter.
 *
 * Covers:
 *  - CSV parser handles real-format snippet
 *  - Latest-row selection
 *  - 6 sub-indices → 6 data points
 *  - Idempotency: UTC start-of-month anchor
 */
import { describe, it, expect, vi } from "vitest"
import {
  parseFaoCsv,
  faoRowToDataPoints,
  createFAOFoodPricesAdapter,
  FAO_FOOD_PRICES_SOURCE,
} from "./fao-food-prices"

// Minimal CSV matching FAO's published shape — header rows stripped.
const SAMPLE_CSV = `Notes line
Source: FAO
Date,FFPI Nominal,Meat,Dairy,Cereals,Oils,Sugar
"Jan 2026",125.4,118.2,140.5,128.3,135.8,102.7
"Feb 2026",126.8,119.0,141.2,129.5,136.4,103.5
"Mar 2026",128.1,120.5,142.8,130.9,138.0,104.2
"Apr 2026",129.5,121.2,144.1,132.4,139.5,105.0
`

describe("parseFaoCsv", () => {
  it("parses month/year + 6 numeric columns", () => {
    const rows = parseFaoCsv(SAMPLE_CSV)
    expect(rows.length).toBe(4)
    expect(rows[0]).toEqual({
      year: 2026,
      month: 1,
      ffpi: 125.4,
      meat: 118.2,
      dairy: 140.5,
      cereal: 128.3,
      oils: 135.8,
      sugar: 102.7,
    })
    expect(rows[3].month).toBe(4)
    expect(rows[3].sugar).toBe(105.0)
  })

  it("skips header / commentary rows", () => {
    const rows = parseFaoCsv(SAMPLE_CSV)
    // Notes lines + headers should NOT appear in output
    for (const r of rows) {
      expect(r.year).toBe(2026)
      expect([1, 2, 3, 4]).toContain(r.month)
    }
  })

  it("returns [] on empty/malformed CSV", () => {
    expect(parseFaoCsv("")).toEqual([])
    expect(parseFaoCsv("garbage")).toEqual([])
  })

  it("handles cells with quoted numbers + thousand separators", () => {
    const csv = `Date,FFPI,Meat,Dairy,Cereals,Oils,Sugar
"May 2026","1,250.4","1,180.2","1,140.5","1,280.3","1,358.8","1,027.5"`
    const rows = parseFaoCsv(csv)
    expect(rows[0].ffpi).toBe(1250.4)
    expect(rows[0].sugar).toBe(1027.5)
  })

  it("handles ISO YYYY-MM date format (FAO 2026-05+ schema)", () => {
    // FAO migrated date column from "Jan 2026" to "2026-01" mid-2026.
    // Parser supports both shapes; rows are emitted with identical
    // month/year regardless of how the date was spelled.
    const csv = `Date,Food Price Index,Meat,Dairy,Cereals,Oils,Sugar
2026-01,125.4,118.2,140.5,128.3,135.8,102.7
2026-05,128.1,120.5,142.8,130.9,138.0,104.2`
    const rows = parseFaoCsv(csv)
    expect(rows.length).toBe(2)
    expect(rows[0]).toMatchObject({ year: 2026, month: 1, ffpi: 125.4 })
    expect(rows[1]).toMatchObject({ year: 2026, month: 5, ffpi: 128.1 })
  })

  it("rejects rows where month part of ISO date is out of range", () => {
    const csv = `Date,FFPI,Meat,Dairy,Cereals,Oils,Sugar
2026-13,125,118,140,128,135,102
2026-00,126,118,140,128,135,102
2026-05,128,120,142,130,138,104`
    const rows = parseFaoCsv(csv)
    expect(rows.length).toBe(1)
    expect(rows[0].month).toBe(5)
  })
})

describe("faoRowToDataPoints", () => {
  it("emits 6 data points anchored to start-of-month UTC", () => {
    const points = faoRowToDataPoints({
      year: 2026,
      month: 5,
      ffpi: 130,
      meat: 122,
      dairy: 145,
      cereal: 133,
      oils: 140,
      sugar: 106,
    })
    expect(points.length).toBe(6)
    expect(points.every((p) => p.datetime.toISOString() === "2026-05-01T00:00:00.000Z")).toBe(
      true,
    )
    expect(points.map((p) => p.metric).sort()).toEqual([
      "FAO_CEREAL_INDEX",
      "FAO_DAIRY_INDEX",
      "FAO_FFPI_NOMINAL",
      "FAO_MEAT_INDEX",
      "FAO_OILS_INDEX",
      "FAO_SUGAR_INDEX",
    ])
    expect(points.find((p) => p.metric === "FAO_SUGAR_INDEX")?.value).toBe(106)
  })

  it("skips null fields gracefully", () => {
    const points = faoRowToDataPoints({
      year: 2026,
      month: 5,
      ffpi: 130,
      meat: null,
      dairy: null,
      cereal: null,
      oils: null,
      sugar: 106,
    })
    expect(points.length).toBe(2)
    expect(points.map((p) => p.metric).sort()).toEqual(["FAO_FFPI_NOMINAL", "FAO_SUGAR_INDEX"])
  })
})

describe("createFAOFoodPricesAdapter", () => {
  it("returns adapter with correct contract", () => {
    const adapter = createFAOFoodPricesAdapter()
    expect(adapter.source).toBe(FAO_FOOD_PRICES_SOURCE)
    expect(adapter.label).toContain("FAO")
  })

  it("fetches + parses successful CSV", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(SAMPLE_CSV, { status: 200 }),
    )
    const adapter = createFAOFoodPricesAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.errors).toEqual([])
    // Latest is April 2026 → 6 points anchored to 2026-04-01
    expect(result.dataPoints.length).toBe(6)
    expect(result.dataPoints[0].datetime.toISOString()).toBe("2026-04-01T00:00:00.000Z")
  })

  it("returns 404 error gracefully", async () => {
    const fetchImpl = vi.fn(async () => new Response("not found", { status: 404 }))
    const adapter = createFAOFoodPricesAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.dataPoints).toEqual([])
    expect(result.errors[0]).toContain("HTTP 404")
  })

  it("returns parse-failure error when CSV has 0 rows", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("no usable data", { status: 200 }),
    )
    const adapter = createFAOFoodPricesAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.errors[0]).toContain("0 parseable rows")
  })
})
