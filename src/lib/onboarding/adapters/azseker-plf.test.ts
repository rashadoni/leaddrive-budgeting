// @vitest-environment node
/**
 * Phase 7.G CXLV — tests for `parsePlfPlSheet` + `parsePlfCfSheet`.
 * Covers: header detection (Excel date serials), code-prefix → accountType
 * mapping, leaf-only filter (skips PLF.XX / PLF.XX.XX parents), all-zero
 * skip, CF activity-type + inflow/outflow inference from segment.
 */

import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parsePlfPlSheet, parsePlfCfSheet, findPlfHeaderRow } from "./azseker-plf"

function makeWorkbook(sheetName: string, aoa: unknown[][]): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(aoa as (string | number | Date | null)[][])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return wb
}

const MONTH_DATES = Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(2026, m, 1)))

describe("findPlfHeaderRow", () => {
  it("finds row with 12 consecutive month-Date headers", () => {
    const aoa: unknown[][] = [
      [], // R1 blank
      [null, null, null, ...MONTH_DATES, null, 2026], // R2: dates at cols 4..15
      [],
    ]
    const r = findPlfHeaderRow(aoa)
    expect(r).not.toBeNull()
    expect(r!.row).toBe(1)
    expect(r!.monthCols).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
  })

  it("returns null when no Date headers present", () => {
    const aoa: unknown[][] = [["Code", "Label", "Jan", "Feb", "Mar"]]
    expect(findPlfHeaderRow(aoa)).toBeNull()
  })
})

describe("parsePlfPlSheet — happy path", () => {
  it("imports only LEAF rows (PLF.XX.XX.XX), skips parent sections", () => {
    const wb = makeWorkbook("PL_X", [
      [],
      [null, "P&L", null, ...MONTH_DATES, null, 2026], // R2 header
      [],
      ["PLF.01", "REVENUE", null, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100], // PARENT — skip
      ["PLF.01.01", "Revenue from Products Sold", null, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], // SUB — skip
      ["PLF.01.01.01", "Revenue from Sale of Wheat", null, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // LEAF
      ["PLF.01.01.02", "Revenue from Sale of Sugar Beet", null, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20], // LEAF
      ["PLF.02", "COGS", null, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], // PARENT — skip
      ["PLF.02.01.01", "Wheat Costs", null, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25], // LEAF cogs
      ["PLF.05.15.01", "Depreciation", null, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], // LEAF expense
      ["PLF.10", "NET PROFIT", null, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10], // PLF.10 — explicit skip (computed)
    ])
    const r = parsePlfPlSheet(wb, "PL_X", XLSX)
    expect(r.warnings).toEqual([])
    expect(r.lines).toHaveLength(4)
    expect(r.lines.map((l) => l.code)).toEqual(["PLF.01.01.01", "PLF.01.01.02", "PLF.02.01.01", "PLF.05.15.01"])
    expect(r.lines[0]).toMatchObject({ accountType: "revenue", totalAnnual: 360 })
    expect(r.lines[2]).toMatchObject({ accountType: "cogs" })
    expect(r.lines[3]).toMatchObject({ accountType: "expense" })
  })

  it("skips all-zero rows", () => {
    const wb = makeWorkbook("PL_X", [
      [null, "P&L", null, ...MONTH_DATES],
      ["PLF.01.01.01", "Revenue", null, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // all zero — skip
      ["PLF.01.01.02", "Revenue 2", null, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ])
    const r = parsePlfPlSheet(wb, "PL_X", XLSX)
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].code).toBe("PLF.01.01.02")
  })
})

describe("parsePlfPlSheet — error paths", () => {
  it("returns warning when sheet missing", () => {
    const wb = makeWorkbook("Other", [["x"]])
    const r = parsePlfPlSheet(wb, "PL_X", XLSX)
    expect(r.lines).toEqual([])
    expect(r.warnings[0]?.reason).toMatch(/not found/)
  })

  it("returns warning when no date header row", () => {
    const wb = makeWorkbook("PL_X", [["PLF.01.01.01", "Revenue", null, 100]])
    const r = parsePlfPlSheet(wb, "PL_X", XLSX)
    expect(r.lines).toEqual([])
    expect(r.warnings[0]?.reason).toMatch(/12-month/)
  })
})

describe("parsePlfCfSheet — activity + inflow/outflow inference", () => {
  it("CF.XX.01.* = inflow, CF.XX.02.* = outflow; classifies activity by section", () => {
    const wb = makeWorkbook("CF_X", [
      [null, "Cash Flow", null, ...MONTH_DATES],
      ["CF.01.01.01", "Inflow from Clients", null, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100], // operating inflow
      ["CF.01.02.01", "Payment to Suppliers", null, -50, -50, -50, -50, -50, -50, -50, -50, -50, -50, -50, -50], // operating outflow
      ["CF.02.02.01", "Purchase of Equipment", null, -1000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // investing outflow
      ["CF.03.01.01", "Bank Loan Received", null, 0, 0, 0, 5000, 0, 0, 0, 0, 0, 0, 0, 0], // financing inflow
    ])
    const r = parsePlfCfSheet(wb, "CF_X", XLSX)
    expect(r.warnings).toEqual([])
    expect(r.entries).toHaveLength(4)
    expect(r.entries[0]).toMatchObject({ activityType: "operating", entryType: "inflow" })
    expect(r.entries[0].perMonth).toEqual([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100])
    expect(r.entries[1]).toMatchObject({ activityType: "operating", entryType: "outflow" })
    expect(r.entries[1].perMonth).toEqual([50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50]) // |value|
    expect(r.entries[2]).toMatchObject({ activityType: "investing", entryType: "outflow" })
    expect(r.entries[3]).toMatchObject({ activityType: "financing", entryType: "inflow" })
  })

  it("skips parent rows + non-CF codes", () => {
    const wb = makeWorkbook("CF_X", [
      [null, "Cash Flow", null, ...MONTH_DATES],
      ["CF.01", "CF FROM OPERATIONS", null, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100], // parent — skip
      ["CF.01.01", "Inflows", null, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], // sub-parent — skip
      ["PLF.01.01.01", "Wrong prefix", null, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], // not CF — skip
      ["CF.01.01.01", "Real leaf", null, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25], // LEAF
    ])
    const r = parsePlfCfSheet(wb, "CF_X", XLSX)
    expect(r.entries).toHaveLength(1)
    expect(r.entries[0].code).toBe("CF.01.01.01")
  })
})
