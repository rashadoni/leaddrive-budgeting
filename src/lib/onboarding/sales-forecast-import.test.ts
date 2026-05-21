/**
 * Phase 7.M Tier 7 (Phase 4) — sales-forecast parser tests.
 * Pure module — no Prisma, no LLM.
 */
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parseSalesForecastWorkbook } from "./sales-forecast-import"

function buildWorkbook(aoa: Array<Array<unknown>>): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  return wb
}

describe("parseSalesForecastWorkbook", () => {
  it("parses department × 12-month grid into one entry per cell", () => {
    const wb = buildWorkbook([
      ["Department", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      ["Sales", 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2100],
      ["Marketing", 500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 1000, 1050],
    ])
    const result = parseSalesForecastWorkbook(wb, XLSX)
    expect(result.errors).toEqual([])
    expect(result.entries).toHaveLength(24) // 2 departments × 12 months
    // Sales month 1 = 1000
    const sales1 = result.entries.find(
      (e) => e.departmentLabel === "sales" && e.month === 1,
    )
    expect(sales1).toMatchObject({ amount: 1000, month: 1 })
    // Marketing month 12 = 1050
    const mk12 = result.entries.find(
      (e) => e.departmentLabel === "marketing" && e.month === 12,
    )
    expect(mk12?.amount).toBe(1050)
  })

  it("normalizes department label to lowercase trimmed", () => {
    const wb = buildWorkbook([
      ["Department", "Jan"],
      ["  Online Sales  ", 5000],
      ["B2B", 3000],
    ])
    const result = parseSalesForecastWorkbook(wb, XLSX)
    expect(result.entries[0].departmentLabel).toBe("online sales")
    expect(result.entries[1].departmentLabel).toBe("b2b")
  })

  it("skips Total / Итого / Cəmi rows", () => {
    const wb = buildWorkbook([
      ["Department", "Jan"],
      ["Sales", 1000],
      ["Total", 9999],
      ["Итого", 9999],
      ["Cəmi", 9999],
      ["ümumi", 9999],
    ])
    const result = parseSalesForecastWorkbook(wb, XLSX)
    expect(result.entries.map((e) => e.departmentLabel)).toEqual(["sales"])
    expect(result.entries[0].amount).toBe(1000)
  })

  it("skips empty/blank label rows", () => {
    const wb = buildWorkbook([
      ["Department", "Jan"],
      ["", 1000],
      ["Sales", 2000],
      [null, 3000],
    ])
    const result = parseSalesForecastWorkbook(wb, XLSX)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].departmentLabel).toBe("sales")
  })

  it("skips empty cells (does not emit zero-amount entries for blanks)", () => {
    const wb = buildWorkbook([
      ["Department", "Jan", "Feb", "Mar"],
      ["Sales", 1000, null, ""],
    ])
    const result = parseSalesForecastWorkbook(wb, XLSX)
    expect(result.entries).toHaveLength(1) // only Jan
    expect(result.entries[0].month).toBe(1)
  })

  it("INCLUDES explicit zero amounts as legitimate forecast values", () => {
    const wb = buildWorkbook([
      ["Department", "Jan", "Feb"],
      ["Sales", 1000, 0],
    ])
    const result = parseSalesForecastWorkbook(wb, XLSX)
    expect(result.entries).toHaveLength(2)
    expect(result.entries[1].amount).toBe(0)
  })

  it("warns and skips non-finite amounts", () => {
    const wb = buildWorkbook([
      ["Department", "Jan", "Feb"],
      ["Sales", 1000, "not-a-number"],
    ])
    const result = parseSalesForecastWorkbook(wb, XLSX)
    expect(result.entries).toHaveLength(1) // only Jan kept
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].message).toMatch(/non-finite amount in month 2/)
  })

  it("warns and skips negative amounts", () => {
    const wb = buildWorkbook([
      ["Department", "Jan", "Feb"],
      ["Sales", 1000, -500],
    ])
    const result = parseSalesForecastWorkbook(wb, XLSX)
    expect(result.entries).toHaveLength(1)
    expect(result.warnings[0].message).toMatch(/negative amount -500 in month 2/)
  })

  it("ignores cells beyond column 13 (defensive)", () => {
    const wb = buildWorkbook([
      ["Department", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Total?", "Extra"],
      ["Sales", 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 1200, 99],
    ])
    const result = parseSalesForecastWorkbook(wb, XLSX)
    expect(result.entries).toHaveLength(12) // exactly 12, extra cols ignored
  })

  it("returns error for workbook with no sheets", () => {
    const wb: XLSX.WorkBook = { Sheets: {}, SheetNames: [] }
    const result = parseSalesForecastWorkbook(wb, XLSX)
    expect(result.errors[0].reason).toMatch(/no sheets/)
    expect(result.entries).toEqual([])
  })

  it("returns error for header-only workbook", () => {
    const wb = buildWorkbook([["Department", "Jan", "Feb"]])
    const result = parseSalesForecastWorkbook(wb, XLSX)
    expect(result.errors[0].reason).toMatch(/at least one data row/)
    expect(result.entries).toEqual([])
  })
})
