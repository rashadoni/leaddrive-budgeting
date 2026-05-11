// @vitest-environment node
/**
 * Phase 7.G CXXXIV — tests for `parseSofpSheet`. Covers header detection,
 * section context inheritance, label-based fallback classification, skip
 * patterns (CƏMİ totals / Kontrol / signatures), and the all-zero row skip.
 */

import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parseSofpSheet } from "./azmade-sofp"

/** Build a tiny in-memory workbook with one sheet from an array-of-arrays. */
function makeWorkbook(sheetName: string, aoa: unknown[][]): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(aoa as (string | number | null)[][])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return wb
}

describe("parseSofpSheet — error paths", () => {
  it("returns warning when sheet is missing", () => {
    const wb = makeWorkbook("OtherSheet", [["x"]])
    const r = parseSofpSheet(wb, "SOFP", XLSX)
    expect(r.lines).toEqual([])
    expect(r.warnings[0]?.reason).toMatch(/not found/)
  })

  it("returns warning when no 12-month header row exists", () => {
    const wb = makeWorkbook("SOFP", [
      ["Title"],
      ["", "Yanvar", "Fevral"], // only 2 months — incomplete
    ])
    const r = parseSofpSheet(wb, "SOFP", XLSX)
    expect(r.lines).toEqual([])
    expect(r.warnings[0]?.reason).toMatch(/No header row/)
  })
})

describe("parseSofpSheet — happy path with section context", () => {
  it("parses LLS-shape SOFP (label, opening, 12 months)", () => {
    const months = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "İyun", "İyul", "Avqust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"]
    const wb = makeWorkbook("SOFP", [
      [], // R1 blank
      ["", "Balans hesabatı", new Date("2025-12-31"), ...months], // R2 header
      [], // R3 blank
      ["", "Uzunmüddətli aktiv", 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220], // section header — skipped
      ["", "Əsas vəsaitlərin qalıq dəyəri", 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62], // asset/fixed_asset
      ["", "Qısamüddətli aktiv", 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42], // section header — skipped
      ["", "Pul və pul vəsaiti", 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22], // asset/current_asset
      ["", "Qısamüddətli öhdəlik", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // section header — skipped (all zero too)
      ["", "Bank kredit", 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], // liability/current
      ["", "Kapital", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // section header
      ["", "Səhmdar kapital", 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100], // equity
      ["", "CƏMİ ÖHDƏLİKLƏR VƏ KAPİTAL", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], // skip pattern
      ["", "Kontrol", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // skip pattern
      ["", '"LLS MMC" Direktor', "", "", "", "", "", "", "", "", "", "", "", "", ""], // signature
    ])
    const r = parseSofpSheet(wb, "SOFP", XLSX)
    expect(r.warnings).toEqual([])
    expect(r.lines).toHaveLength(3)
    expect(r.lines[0]).toMatchObject({ label: "Əsas vəsaitlərin qalıq dəyəri", lineType: "asset", subType: "fixed_asset" })
    expect(r.lines[0].perMonth).toEqual([51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62])
    expect(r.lines[1]).toMatchObject({ label: "Pul və pul vəsaiti", lineType: "asset", subType: "current_asset" })
    expect(r.lines[2]).toMatchObject({ label: "Bank kredit", lineType: "liability", subType: "current_liability" })
  })

  it("synthetic codes are unique within sheet (suffix on collision)", () => {
    const months = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "İyun", "İyul", "Avqust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"]
    const wb = makeWorkbook("SOFP", [
      ["", "Balans hesabatı", "Open", ...months],
      ["", "Qısamüddətli aktiv", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // section
      ["", "Pul və pul vəsaiti", 100, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      ["", "Pul və pul vəsaiti", 200, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2], // duplicate label
    ])
    const r = parseSofpSheet(wb, "SOFP", XLSX)
    expect(r.lines).toHaveLength(2)
    expect(r.lines[0].code).toBe("BS-pul-ve-pul-vesaiti")
    expect(r.lines[1].code).toBe("BS-pul-ve-pul-vesaiti-2")
  })
})

describe("parseSofpSheet — Excel date-serial headers (AAC BS layout, CXXXV)", () => {
  // 2026 month-end Excel serials
  const SERIALS_2026 = [46053, 46081, 46112, 46142, 46173, 46203, 46234, 46265, 46295, 46326, 46356, 46387]

  it("falls back to date-serial header when month-name detection fails", () => {
    const wb = makeWorkbook("BS", [
      [null, "Balans maddəsi", null, null, "BUDCƏ 2026"], // R0
      [null, null, 45657, null, ...SERIALS_2026], // R1: opening date col 2; 12 month-end serials starting col 4
      [null, "Pul və pul vəsaiti", 100, null, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220], // R2 data
      [null, "Bank krediti", 50, null, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], // R3 data — debt
    ])
    const r = parseSofpSheet(wb, "BS", XLSX)
    expect(r.warnings).toEqual([])
    expect(r.lines).toHaveLength(2)
    expect(r.lines[0]).toMatchObject({ label: "Pul və pul vəsaiti", lineType: "asset" })
    expect(r.lines[0].perMonth).toEqual([110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220])
    expect(r.lines[1]).toMatchObject({ label: "Bank krediti", lineType: "liability" })
  })

  it("rejects serials outside reasonable date range (sanity guard)", () => {
    const wb = makeWorkbook("BS", [
      // 100, 200, ... look like dollar amounts — not dates. No month names either.
      [null, "Label", null, null, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200],
      [null, "Bank hesabı", 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ])
    const r = parseSofpSheet(wb, "BS", XLSX)
    expect(r.lines).toEqual([])
    expect(r.warnings[0]?.reason).toMatch(/No header row found/)
  })
})

describe("parseSofpSheet — fallback classification (no section context)", () => {
  it("classifies via label keywords when no section header preceded", () => {
    const months = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "İyun", "İyul", "Avqust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"]
    const wb = makeWorkbook("SOFP", [
      ["", "Balans hesabatı", "Open", ...months],
      ["", "Bank hesabı", 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], // → asset/current via label
      ["", "Bank kredit borcu", 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], // → liability via label
      ["", "Səhmdar mənfəəti", 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], // → equity via label
    ])
    const r = parseSofpSheet(wb, "SOFP", XLSX)
    expect(r.lines).toHaveLength(3)
    expect(r.lines[0]).toMatchObject({ lineType: "asset", subType: "current_asset" })
    expect(r.lines[1]).toMatchObject({ lineType: "liability", subType: "current_liability" })
    expect(r.lines[2]).toMatchObject({ lineType: "equity", subType: "equity" })
  })

  it("emits warning + skips when label is unclassifiable + no section context", () => {
    const months = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "İyun", "İyul", "Avqust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"]
    const wb = makeWorkbook("SOFP", [
      ["", "Balans hesabatı", "Open", ...months],
      ["", "Random unclassified label", 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ])
    const r = parseSofpSheet(wb, "SOFP", XLSX)
    expect(r.lines).toEqual([])
    expect(r.warnings[0]?.reason).toMatch(/Could not classify/)
  })
})
