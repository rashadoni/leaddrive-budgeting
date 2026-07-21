// @vitest-environment node
/**
 * Phase 7.G CXLV — tests for `parsePlfPlSheet` + `parsePlfCfSheet`.
 * Covers: header detection (Excel date serials), code-prefix → accountType
 * mapping, leaf-only filter (skips PLF.XX / PLF.XX.XX parents), all-zero
 * skip, CF activity-type + inflow/outflow inference from segment.
 */

import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parsePlfPlSheet, parsePlfCfSheet, findPlfHeaderRow, parsePlfEbitdaSubtotalAllYears } from "./azseker-plf"

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

  it("STRICT preferYear: returns null when the requested year is absent (Codex re-review)", () => {
    // Sheet carries only 2026 month dates. Asking for 2025 must NOT fall back
    // to 2026 (which would write 2026 values into the 2025 plan).
    const aoa: unknown[][] = [[null, null, null, ...MONTH_DATES]]
    expect(findPlfHeaderRow(aoa, { preferYear: 2025 })).toBeNull()
    expect(findPlfHeaderRow(aoa, { preferYear: 2026 })?.year).toBe(2026)
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
    // 2026-06-02: perMonth is now SIGNED (was abs) so refund/reversal months net correctly.
    expect(r.entries[1].perMonth).toEqual([-50, -50, -50, -50, -50, -50, -50, -50, -50, -50, -50, -50])
    expect(r.entries[2]).toMatchObject({ activityType: "investing", entryType: "outflow" })
    expect(r.entries[3]).toMatchObject({ activityType: "financing", entryType: "inflow" })
  })

  it("preserves the SIGN of a refund month inside an outflow line (regression: MALT/AZSF op-CF)", () => {
    // Real shape from CF Malt: an outflow line (CF.01.02.*) whose Jan is a
    // positive refund. The pre-fix parser abs'd it → flipped the refund into
    // an outflow, overstating outflow by 2× the refund. perMonth must keep
    // the sign; the LINE entryType stays "outflow" (segment-based, for
    // account classification), and the handler re-derives per-month direction.
    const wb = makeWorkbook("CF_X", [
      [null, "Cash Flow", null, ...MONTH_DATES],
      ["CF.01.02.23", "Payment for Other Materials", null, 102239, -122597, -217, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ])
    const r = parsePlfCfSheet(wb, "CF_X", XLSX)
    expect(r.entries).toHaveLength(1)
    expect(r.entries[0].entryType).toBe("outflow") // line default by segment .02
    expect(r.entries[0].perMonth[0]).toBe(102239) // refund kept POSITIVE (was -102239 pre-fix)
    expect(r.entries[0].perMonth[1]).toBe(-122597)
    // Net = refund - outflows = signed sum (was -225053 pre-fix; now -20575)
    const net = r.entries[0].perMonth.reduce<number>(
      (sum, value) => sum + (value ?? 0),
      0,
    )
    expect(net).toBe(-20575)
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

  it("preserves CF.04–CF.07 bridge evidence and distinguishes absent from zero", () => {
    const wb = makeWorkbook("CF_X", [
      [null, "Cash Flow", null, ...MONTH_DATES],
      ["CF.01.01.01", "Operating inflow", null, 100, ...Array(11).fill(null)],
      ["CF.04", "FX effect", null, 0, null, -5, ...Array(9).fill(null)],
      ["CF.05", "Net change", null, 95, ...Array(11).fill(null)],
      ["CF.06", "Opening cash", null, 1_000, ...Array(11).fill(null)],
      ["CF.07", "Closing cash", null, 1_095, ...Array(11).fill(null)],
    ])

    const r = parsePlfCfSheet(wb, "CF_X", XLSX)
    const byCode = new Map(r.entries.map((entry) => [entry.code, entry]))

    expect(r.entries).toHaveLength(5)
    for (const code of ["CF.04", "CF.05", "CF.06", "CF.07"]) {
      expect(byCode.get(code)?.activityType).toBe("bridge")
    }
    expect(byCode.get("CF.04")?.perMonth[0]).toBe(0)
    expect(byCode.get("CF.04")?.perMonth[1]).toBeNull()
    expect(byCode.get("CF.04")?.perMonth[2]).toBe(-5)
  })

  it("uses leaf-most bridge rows when a subtotal ancestor is also present", () => {
    const wb = makeWorkbook("CF_X", [
      [null, "Cash Flow", null, ...MONTH_DATES],
      ["CF.01.01.01", "Movement", null, 10, ...Array(11).fill(null)],
      ["CF.04", "FX subtotal", null, 7, ...Array(11).fill(null)],
      ["CF.04.01.01", "FX evidenced leaf", null, 7, ...Array(11).fill(null)],
    ])

    const r = parsePlfCfSheet(wb, "CF_X", XLSX)
    expect(r.entries.map((entry) => entry.code)).toEqual([
      "CF.01.01.01",
      "CF.04.01.01",
    ])
    expect(r.warnings.some((warning) => warning.reason.includes("CF.04 skipped"))).toBe(true)
  })

  it("suppresses a bridge ancestor per month, preserving sparse parent evidence", () => {
    const wb = makeWorkbook("CF_X", [
      [null, "Cash Flow", null, ...MONTH_DATES],
      ["CF.01.01.01", "Movement", null, 10, ...Array(11).fill(null)],
      ["CF.04", "FX subtotal", null, 7, 8, ...Array(10).fill(null)],
      ["CF.04.01.01", "FX evidenced leaf", null, 7, null, ...Array(10).fill(null)],
    ])

    const r = parsePlfCfSheet(wb, "CF_X", XLSX)
    const parent = r.entries.find((entry) => entry.code === "CF.04")
    const child = r.entries.find((entry) => entry.code === "CF.04.01.01")

    expect(parent?.perMonth[0]).toBeNull()
    expect(parent?.perMonth[1]).toBe(8)
    expect(child?.perMonth[0]).toBe(7)
    expect(child?.perMonth[1]).toBeNull()
  })
})

describe("parsePlfEbitdaSubtotalAllYears", () => {
  const Y2025 = Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(2025, m, 1)))
  const Y2026 = Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(2026, m, 1)))

  it("extracts the EBITDA subtotal for EVERY year block in the sheet", () => {
    // Header carries 2025 (cols 3..14) and 2026 (cols 16..27) side by side.
    const wb = makeWorkbook("PLF X", [
      [null, "P&L", null, ...Y2025, null, ...Y2026],
      // EBITDA subtotal row: 2025 = 100/mo, 2026 = 200/mo.
      [null, "EBITDA", null, ...Array(12).fill(100), null, ...Array(12).fill(200)],
    ])
    const res = parsePlfEbitdaSubtotalAllYears(wb, "PLF X", XLSX)
    expect(res.map((r) => r.year)).toEqual([2025, 2026]) // sorted ascending
    expect(res[0].monthly).toHaveLength(12)
    expect(res[0].monthly.reduce((s, x) => s + x.value, 0)).toBe(1200)
    expect(res[1].monthly.reduce((s, x) => s + x.value, 0)).toBe(2400)
    expect(res[1].monthly[0]).toEqual({ month: 1, value: 200 })
  })

  it("captures a PARTIAL year (only the months with data)", () => {
    // 2026 has only Jan–Mar booked; the rest are 0 → 3 months captured.
    const partial2026 = [300, 300, 300, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const wb = makeWorkbook("PLF X", [
      [null, "P&L", null, ...Y2025, null, ...Y2026],
      [null, "EBITDA", null, ...Array(12).fill(50), null, ...partial2026],
    ])
    const res = parsePlfEbitdaSubtotalAllYears(wb, "PLF X", XLSX)
    expect(res).toHaveLength(2)
    expect(res[1].year).toBe(2026)
    expect(res[1].monthly).toHaveLength(3)
    expect(res[1].monthly.map((x) => x.month)).toEqual([1, 2, 3])
  })

  it("returns [] when there is no EBITDA subtotal row (so the handler never deletes)", () => {
    const wb = makeWorkbook("PLF X", [
      [null, "P&L", null, ...Y2025],
      ["PLF.01.01.01", "Revenue from Wheat", null, ...Array(12).fill(10)],
    ])
    expect(parsePlfEbitdaSubtotalAllYears(wb, "PLF X", XLSX)).toEqual([])
  })

  it("ignores an EBITDA MARGIN % row (not the absolute subtotal)", () => {
    const wb = makeWorkbook("PLF X", [
      [null, "P&L", null, ...Y2025],
      [null, "EBITDA Margin %", null, ...Array(12).fill(28)],
    ])
    expect(parsePlfEbitdaSubtotalAllYears(wb, "PLF X", XLSX)).toEqual([])
  })

  it("returns [] for a missing sheet", () => {
    const wb = makeWorkbook("PLF X", [[null, "EBITDA", null, ...Y2025]])
    expect(parsePlfEbitdaSubtotalAllYears(wb, "NOPE", XLSX)).toEqual([])
  })
})
