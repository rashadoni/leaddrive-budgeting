// @vitest-environment node
/**
 * Phase 7.G CXXXVI — tests for `parseAacSalesAllSheet`. Covers product
 * detection (header with "Jan" in col 3 + name in col 2), total-row
 * lookup ("CƏMİ məbləğ:" within 10 rows), code mapping (canonical AZ →
 * EN like "Əhəng yanmış" → LIME_BURNT), all-zero product skip.
 */

import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parseAacSalesAllSheet } from "./azmade-sales"

function makeWorkbook(sheetName: string, aoa: unknown[][]): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(aoa as (string | number | null)[][])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return wb
}

describe("parseAacSalesAllSheet — error paths", () => {
  it("returns warning when sheet missing", () => {
    const wb = makeWorkbook("Other", [["x"]])
    const r = parseAacSalesAllSheet(wb, "S-all", XLSX)
    expect(r.products).toEqual([])
    expect(r.warnings[0]?.reason).toMatch(/not found/)
  })

  it("returns empty when no Jan-headers exist", () => {
    const wb = makeWorkbook("S-all", [["just label rows", "x", "y"]])
    const r = parseAacSalesAllSheet(wb, "S-all", XLSX)
    expect(r.products).toEqual([])
    expect(r.warnings).toEqual([])
  })
})

describe("parseAacSalesAllSheet — happy path with multiple products", () => {
  it("parses 6 AAC products with canonical codes + monthly totals", () => {
    const wb = makeWorkbook("S-all", [
      [null, "2026ci il üçün"], // R1 title
      [], // R2
      [], // R3
      [null, "MHB", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "CƏMİ:"], // R4 header
      [null, "1-ci növ", 700, 776, 1021, 1152, 1180, 1181, 1181, 1181, 1227, 1227, 1277, 1181, 13286], // R5 sub-type
      [null, "2-ci növ", 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12], // R6 sub-type
      [null, "CƏMİ məbləğ: ", 701, 777, 1022, 1153, 1181, 1182, 1182, 1182, 1228, 1228, 1278, 1182, 13298], // R7 total
      [], [],
      [null, "Əhəng yanmış", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "CƏMİ:"],
      [null, "CƏMİ məbləğ: ", 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 1200],
      [], [],
      [null, "Əhəng sönmüş", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "CƏMİ:"],
      [null, "CƏMİ məbləğ: ", 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 600],
      [], [],
      [null, "Yapışqan", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "CƏMİ:"],
      [null, "CƏMİ məbləğ: ", 30, 41, 44, 46, 49, 52, 52, 52, 52, 52, 52, 52, 574],
      [], [],
      [null, "Əhəng tullantı", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "CƏMİ:"],
      [null, "CƏMİ məbləğ: ", 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 8.4],
      [], [],
      [null, "U-block", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "CƏMİ:"],
      [null, "CƏMİ məbləğ: ", 28, 9, 6, 5, 3, 0, 0, 3, 0, 0, 3, 3, 60],
    ])
    const r = parseAacSalesAllSheet(wb, "S-all", XLSX)
    expect(r.warnings).toEqual([])
    expect(r.products).toHaveLength(6)
    expect(r.products.map((p) => p.code)).toEqual([
      "MHB",
      "LIME_BURNT",
      "LIME_SLAKED",
      "ADHESIVE",
      "LIME_WASTE",
      "UBLOCK",
    ])
    expect(r.products[0].perMonth[0]).toBe(701)
    expect(r.products[0].totalAnnual).toBeCloseTo(13296, 0)
  })

  it("skips all-zero products silently", () => {
    const wb = makeWorkbook("S-all", [
      [null, "MHB", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "CƏMİ:"],
      [null, "CƏMİ məbləğ: ", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [null, "Yapışqan", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "CƏMİ:"],
      [null, "CƏMİ məbləğ: ", 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12],
    ])
    const r = parseAacSalesAllSheet(wb, "S-all", XLSX)
    expect(r.products).toHaveLength(1)
    expect(r.products[0].code).toBe("ADHESIVE")
  })

  it("emits warning when product header has no name", () => {
    const wb = makeWorkbook("S-all", [
      [null, null, "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "CƏMİ:"],
      [null, "CƏMİ məbləğ: ", 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12],
    ])
    const r = parseAacSalesAllSheet(wb, "S-all", XLSX)
    expect(r.products).toEqual([])
    expect(r.warnings[0]?.reason).toMatch(/no name/)
  })

  it("emits warning when no CƏMİ məbləğ row found in 10 rows", () => {
    const rows: unknown[][] = [
      [null, "MHB", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "CƏMİ:"],
    ]
    // 12 blank rows after — total row never appears
    for (let i = 0; i < 12; i++) rows.push([])
    const wb = makeWorkbook("S-all", rows)
    const r = parseAacSalesAllSheet(wb, "S-all", XLSX)
    expect(r.products).toEqual([])
    expect(r.warnings[0]?.reason).toMatch(/CƏMİ məbləğ/)
  })

  it("falls back to slugified code for unknown product names", () => {
    const wb = makeWorkbook("S-all", [
      [null, "Yeni Məhsul Növü", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "CƏMİ:"],
      [null, "CƏMİ məbləğ: ", 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12],
    ])
    const r = parseAacSalesAllSheet(wb, "S-all", XLSX)
    expect(r.products).toHaveLength(1)
    expect(r.products[0].code).toBe("YENI_MIHSUL_NOVU")
  })
})
