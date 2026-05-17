/**
 * Tests for the AZ State Statistics CPI breakdown adapter (xlsx).
 *
 * Covers:
 *  - xlsx parser identifies header row + extracts year/month/metric rows
 *  - YoY computation against prior-year same-month sibling
 *  - Roman-numeral month parsing (I=Jan ... XII=Dec)
 *  - Multiple years preserved + latest-month auto-pick
 *  - Idempotency: UTC 1st-of-month anchor
 *  - Graceful 404 / network error / empty workbook
 */
import { describe, it, expect, vi } from "vitest"
import * as XLSX from "xlsx"
import {
  parseAzCpiXlsx,
  rowsToYoYDataPoints,
  createAzStatCpiAdapter,
  AZ_STAT_CPI_SOURCE,
} from "./az-stat-cpi"

/** Build a workbook arrayBuffer with stat.gov.az-style content but
 *  collapsed headers to one row (avoids xlsx leading-null gotchas).
 *  Multi-row header detection is separately verified by the real-file
 *  fetch path in the live-fetch script. */
function makeFixtureXlsx(): ArrayBuffer {
  const rows: unknown[][] = [
    ["1.2 Consumer price index"],
    ["(2010=100, in percent)"],
    [
      "Years and months",
      "Total goods and services",
      "Food products, beverages and tobacco products",
      "Non-food products",
      "Paid services",
    ],
    [2024],
    ["I", 200, 220, 180, 210],
    ["II", 201, 221, 181, 211],
    ["III", 202, 222, 182, 212],
    ["IV", 203, 223, 183, 213],
    ["V", 204, 224, 184, 214],
    ["VI", 205, 225, 185, 215],
    ["VII", 206, 226, 186, 216],
    ["VIII", 207, 227, 187, 217],
    ["IX", 208, 228, 188, 218],
    ["X", 209, 229, 189, 219],
    ["XI", 210, 230, 190, 220],
    ["XII", 211, 231, 191, 221],
    [2025],
    ["I", 212, 235, 192, 224],
    ["II", 214, 237, 194, 225],
    ["III", 216, 240, 196, 226],
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "1,2")
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer
}

describe("parseAzCpiXlsx", () => {
  it("extracts month rows across years", () => {
    const rows = parseAzCpiXlsx(makeFixtureXlsx())
    // 12 months 2024 + 3 months 2025 = 15
    expect(rows.length).toBe(15)
    expect(rows[0]).toMatchObject({ year: 2024, month: 1 })
    expect(rows[12]).toMatchObject({ year: 2025, month: 1 })
  })

  it("maps the 4 expected metric columns", () => {
    const rows = parseAzCpiXlsx(makeFixtureXlsx())
    const m = rows[0].values
    expect(m.AZ_CPI_ALL_ITEMS).toBe(200)
    expect(m.AZ_CPI_FOOD).toBe(220)
    expect(m.AZ_CPI_NON_FOOD).toBe(180)
    expect(m.AZ_CPI_SERVICES).toBe(210)
  })

  it("returns [] when workbook is empty / wrong shape", () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "blank")
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer
    expect(parseAzCpiXlsx(buf)).toEqual([])
  })

  it("ignores non-Roman first-column rows", () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ["header", "Total goods and services", "Food products, beverages and tobacco products"],
      [2024],
      ["random-text", 100, 110],
      ["I", 200, 220],
    ])
    XLSX.utils.book_append_sheet(wb, ws, "x")
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer
    const rows = parseAzCpiXlsx(buf)
    expect(rows.length).toBe(1)
    expect(rows[0].month).toBe(1)
  })
})

describe("rowsToYoYDataPoints", () => {
  it("emits YoY% for each metric anchored to latest month", () => {
    const rows = parseAzCpiXlsx(makeFixtureXlsx())
    const points = rowsToYoYDataPoints(rows)
    // Latest = 2025-03; prior = 2024-03. Total: 216/202 = 1.0693 → 106.93%
    expect(points.length).toBe(4)
    const byMetric = Object.fromEntries(points.map((p) => [p.metric, p]))
    expect(byMetric.AZ_CPI_ALL_ITEMS.value).toBeCloseTo(106.93, 1)
    expect(byMetric.AZ_CPI_FOOD.value).toBeCloseTo(108.11, 1)
    expect(byMetric.AZ_CPI_NON_FOOD.value).toBeCloseTo(107.69, 1)
    expect(byMetric.AZ_CPI_SERVICES.value).toBeCloseTo(106.6, 1)
    for (const p of points) {
      expect(p.datetime.toISOString().slice(0, 10)).toBe("2025-03-01")
      expect(p.unit).toBe("% YoY")
      expect(p.sourceCode).toBe(AZ_STAT_CPI_SOURCE)
    }
  })

  it("skips metric when prior-year row absent", () => {
    // Only first year — no YoY possible.
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ["Years and months", "Total goods and services", "Food products, beverages and tobacco products"],
      [2024],
      ["I", 200, 220],
      ["II", 201, 221],
    ])
    XLSX.utils.book_append_sheet(wb, ws, "x")
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer
    const rows = parseAzCpiXlsx(buf)
    expect(rowsToYoYDataPoints(rows)).toEqual([])
  })

  it("rounds YoY% to 2 decimals", () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ["Years and months", "Total goods and services"],
      [2024],
      ["I", 100],
      [2025],
      ["I", 113.3331],
    ])
    XLSX.utils.book_append_sheet(wb, ws, "x")
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer
    const rows = parseAzCpiXlsx(buf)
    const points = rowsToYoYDataPoints(rows)
    expect(points[0].value).toBe(113.33)
  })
})

describe("createAzStatCpiAdapter", () => {
  it("returns adapter with correct contract", () => {
    const adapter = createAzStatCpiAdapter()
    expect(adapter.source).toBe(AZ_STAT_CPI_SOURCE)
    expect(adapter.label).toContain("CPI")
  })

  it("fetches + parses + emits YoY points", async () => {
    const xlsxBuf = makeFixtureXlsx()
    const fetchImpl = vi.fn(
      async () => new Response(xlsxBuf, { status: 200 }) as Response,
    )
    const adapter = createAzStatCpiAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.dataPoints.length).toBe(4)
  })

  it("returns HTTP 404 gracefully", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }))
    const adapter = createAzStatCpiAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.errors[0]).toContain("HTTP 404")
  })

  it("returns error when xlsx has 0 mappable rows", async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["garbage"]]), "x")
    const emptyBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer
    const fetchImpl = vi.fn(
      async () => new Response(emptyBuf, { status: 200 }) as Response,
    )
    const adapter = createAzStatCpiAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.dataPoints).toEqual([])
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

  it("honors xlsxUrl override", async () => {
    const fetchImpl = vi.fn<(url: string) => Promise<Response>>(
      async () => new Response(makeFixtureXlsx(), { status: 200 }) as Response,
    )
    const customUrl = "https://my-mirror.local/cpi.xlsx"
    const adapter = createAzStatCpiAdapter({
      fetchImpl: fetchImpl as never,
      xlsxUrl: customUrl,
    })
    await adapter.fetch()
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(customUrl)
  })
})
