/**
 * Phase 7.H F4.v2.3.1 — bulk-import parser tests.
 *
 * Locks the column-shape contract + every error/warning branch so a
 * future seed-author can't silently break the user's Excel workflow.
 * Round-trips real xlsx buffers through the parser to catch
 * sheet_to_json + cellDates regressions early.
 */

import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parseOperationalFactsWorkbook } from "./operational-facts-import"

function buildWorkbook(rows: Array<Array<string | number | null>>): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "OperationalFacts")
  return wb
}

const HEADERS = [
  "companyCode",
  "metric",
  "date",
  "value",
  "unit",
  "sourceNote",
]

describe("parseOperationalFactsWorkbook — happy path", () => {
  it("parses a clean 1-row workbook", () => {
    const wb = buildWorkbook([
      HEADERS,
      ["AAC-MAIN", "harvest_tons", "2026-04-01", 50, "tons", "Q1 actuals"],
    ])
    const r = parseOperationalFactsWorkbook(wb, XLSX)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({
      companyCode: "AAC-MAIN",
      metric: "harvest_tons",
      date: "2026-04-01",
      value: 50,
      unit: "tons",
      sourceNote: "Q1 actuals",
    })
  })

  it("accepts case-variant headers and alias names", () => {
    const wb = buildWorkbook([
      ["Company Code", "Metric", "Period", "Amount", "Unit", "Note"],
      ["AAC-MAIN", "harvest_tons", "2026-01-01", 50, "tons", "ok"],
    ])
    const r = parseOperationalFactsWorkbook(wb, XLSX)
    expect(r.errors).toEqual([])
    expect(r.rows).toHaveLength(1)
  })

  it("accepts xlsx Date objects from cellDates parsing", () => {
    const wb = buildWorkbook([
      HEADERS,
      ["AAC-MAIN", "harvest_tons", new Date("2026-04-01T00:00:00Z") as unknown as string, 50, "tons", null],
    ])
    const r = parseOperationalFactsWorkbook(wb, XLSX)
    expect(r.errors).toEqual([])
    expect(r.rows[0].date).toBe("2026-04-01")
  })

  it("skips fully-empty rows without erroring", () => {
    const wb = buildWorkbook([
      HEADERS,
      ["AAC-MAIN", "harvest_tons", "2026-04-01", 50, "tons", null],
      [null, null, null, null, null, null],
      ["AAC-MAIN", "harvest_tons", "2026-05-01", 60, "tons", null],
    ])
    const r = parseOperationalFactsWorkbook(wb, XLSX)
    expect(r.errors).toEqual([])
    expect(r.rows).toHaveLength(2)
  })

  it("treats sourceNote as optional", () => {
    const wb = buildWorkbook([
      ["companyCode", "metric", "date", "value", "unit"],
      ["AAC-MAIN", "harvest_tons", "2026-04-01", 50, "tons"],
    ])
    const r = parseOperationalFactsWorkbook(wb, XLSX)
    expect(r.errors).toEqual([])
    expect(r.rows[0].sourceNote).toBeNull()
  })
})

describe("parseOperationalFactsWorkbook — error branches", () => {
  it("rejects a workbook with no sheets", () => {
    const wb = { SheetNames: [], Sheets: {} } as XLSX.WorkBook
    const r = parseOperationalFactsWorkbook(wb, XLSX)
    expect(r.errors[0].reason).toContain("no sheets")
  })

  it("rejects a sheet with header-only (no data rows)", () => {
    const wb = buildWorkbook([HEADERS])
    const r = parseOperationalFactsWorkbook(wb, XLSX)
    expect(r.errors[0].reason).toContain("at least one data row")
  })

  it("rejects when a required header is missing", () => {
    const wb = buildWorkbook([
      ["companyCode", "metric", "date", "value"], // no `unit`
      ["AAC-MAIN", "harvest_tons", "2026-04-01", 50],
    ])
    const r = parseOperationalFactsWorkbook(wb, XLSX)
    expect(r.errors[0].reason.toLowerCase()).toContain("unit")
  })

  it("rejects an unknown metric name", () => {
    const wb = buildWorkbook([
      HEADERS,
      ["AAC-MAIN", "totally_fake_metric", "2026-04-01", 50, "tons", null],
    ])
    const r = parseOperationalFactsWorkbook(wb, XLSX)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].reason).toContain("Unknown metric")
  })

  it("rejects a malformed date string", () => {
    const wb = buildWorkbook([
      HEADERS,
      ["AAC-MAIN", "harvest_tons", "not-a-date", 50, "tons", null],
    ])
    const r = parseOperationalFactsWorkbook(wb, XLSX)
    expect(r.errors[0].reason).toContain("date")
  })

  it("rejects a non-numeric value", () => {
    const wb = buildWorkbook([
      HEADERS,
      ["AAC-MAIN", "harvest_tons", "2026-04-01", "lots", "tons", null],
    ])
    const r = parseOperationalFactsWorkbook(wb, XLSX)
    expect(r.errors[0].reason).toContain("value")
  })

  it("rejects a unit mismatch (kg vs tons)", () => {
    const wb = buildWorkbook([
      HEADERS,
      ["AAC-MAIN", "harvest_tons", "2026-04-01", 50, "kg", null],
    ])
    const r = parseOperationalFactsWorkbook(wb, XLSX)
    expect(r.errors[0].reason.toLowerCase()).toContain("unit")
  })

  it("rejects a value outside the hard-bound range", () => {
    const wb = buildWorkbook([
      HEADERS,
      ["AAC-MAIN", "harvest_tons", "2026-04-01", 99_999_999_999, "tons", null],
    ])
    const r = parseOperationalFactsWorkbook(wb, XLSX)
    expect(r.errors[0].reason.toLowerCase()).toContain("maximum")
  })

  it("surfaces excel row numbers (1-indexed, header at row 1)", () => {
    const wb = buildWorkbook([
      HEADERS,
      ["AAC-MAIN", "harvest_tons", "2026-04-01", 50, "tons", null], // row 2 = OK
      ["AAC-MAIN", "harvest_tons", "bad-date", 50, "tons", null], // row 3 = ERR
    ])
    const r = parseOperationalFactsWorkbook(wb, XLSX)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].rowNumber).toBe(3)
  })
})

describe("parseOperationalFactsWorkbook — warning branch", () => {
  it("surfaces soft-bound warnings without rejecting the row", () => {
    // feed_consumed_kg: warnMax = 1_000_000, hard max = 10_000_000.
    // 5M lies in warn band — produces warning but row is kept.
    const wb = buildWorkbook([
      HEADERS,
      ["AAC-MAIN", "feed_consumed_kg", "2026-04-01", 5_000_000, "kg", null],
    ])
    const r = parseOperationalFactsWorkbook(wb, XLSX)
    expect(r.errors).toEqual([])
    expect(r.rows).toHaveLength(1)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0].rowNumber).toBe(2)
    expect(r.warnings[0].message.toLowerCase()).toContain("unusually high")
  })
})

describe("parseOperationalFactsWorkbook — round-trip via xlsx buffer", () => {
  it("reads a workbook serialized to xlsx and back", () => {
    const wb = buildWorkbook([
      HEADERS,
      ["AAC-MAIN", "harvest_tons", "2026-04-01", 50, "tons", "fresh"],
      ["AAC-MAIN", "area_hectares", "2026-04-01", 100, "hectares", "fresh"],
    ])
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer
    const reloaded = XLSX.read(buf, { type: "buffer", cellDates: true })
    const r = parseOperationalFactsWorkbook(reloaded, XLSX)
    expect(r.errors).toEqual([])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0].metric).toBe("harvest_tons")
    expect(r.rows[1].metric).toBe("area_hectares")
  })
})
