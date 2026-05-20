/**
 * Unit tests for parseWorkbookBsSheet — BS (balance sheet) deterministic
 * adapter for AzerSheker × Workbook workbook.
 *
 * Covers:
 *  - Header detection for the target year only (multi-year sheet with
 *    sparse 2026 column coverage)
 *  - Code → lineType/subType classification (asset / liability / equity
 *    with non_current / current / long_term / short_term subtypes)
 *  - Skip rows with no current-year columns + all-zero leaves
 *  - Warning emitted for unknown BS prefix
 */
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parseWorkbookBsSheet } from "./azseker-workbook-bs"

function buildWb(name: string, rows: unknown[][]): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, name)
  return wb
}

function serial(year: number, month0: number): number {
  return Date.UTC(year, month0, 1) / 86400_000 + 25569
}

describe("parseWorkbookBsSheet", () => {
  it("parses leaves with sparse 2026 month coverage (Malt-style)", () => {
    // Real BS Malt layout: col D = 2025-Jan ... col O = 2025-Dec,
    // then col P = 2026-Jan, col Q = 2026-Feb, col R = 2026-Mar.
    // We only emit rows for the 2026 cols.
    const rows = [
      [null, "BALANCE SHEET", null,
       serial(2025, 0), serial(2025, 1), serial(2025, 2),
       serial(2026, 0), serial(2026, 1), serial(2026, 2)],
      ["BS.01", "ASSETS", null, 100, 100, 100, 200, 200, 200],
      ["BS.01.01.01", "Intangible Assets", null, 0, 0, 0, 50, 60, 70],
      ["BS.01.02.01", "Inventory", null, 5, 5, 5, 30, 35, 40],
      ["BS.02.01.01", "Share Capital", null, 1000, 1000, 1000, 1100, 1100, 1100],
      ["BS.03.01.01", "LT Loan", null, 500, 500, 500, 450, 425, 400],
      ["BS.03.02.01", "ST Loan", null, 100, 100, 100, 80, 70, 60],
    ]
    const wb = buildWb("BS Malt", rows)
    const result = parseWorkbookBsSheet(wb, "BS Malt", XLSX, { preferYear: 2026 })
    expect(result.year).toBe(2026)
    expect(result.warnings).toEqual([])
    expect(result.lines.length).toBe(5)

    const intangible = result.lines.find((l) => l.code === "BS.01.01.01")!
    expect(intangible.lineType).toBe("asset")
    expect(intangible.subType).toBe("non_current")
    expect(intangible.monthlyAmounts).toEqual({
      "2026-01": 50, "2026-02": 60, "2026-03": 70,
    })

    const inventory = result.lines.find((l) => l.code === "BS.01.02.01")!
    expect(inventory.subType).toBe("current")

    const equity = result.lines.find((l) => l.code === "BS.02.01.01")!
    expect(equity.lineType).toBe("equity")
    expect(equity.subType).toBeNull()

    const ltLoan = result.lines.find((l) => l.code === "BS.03.01.01")!
    expect(ltLoan.lineType).toBe("liability")
    expect(ltLoan.subType).toBe("long_term")

    const stLoan = result.lines.find((l) => l.code === "BS.03.02.01")!
    expect(stLoan.subType).toBe("short_term")
  })

  it("skips all-zero leaves for the target year", () => {
    const rows = [
      [null, null, null, serial(2026, 0), serial(2026, 1)],
      ["BS.01.01.99", "Empty Asset", null, 0, 0],
      ["BS.01.02.01", "Cash", null, 100, 200],
    ]
    const wb = buildWb("BS X", rows)
    const result = parseWorkbookBsSheet(wb, "BS X", XLSX, { preferYear: 2026 })
    expect(result.lines.length).toBe(1)
    expect(result.lines[0].code).toBe("BS.01.02.01")
  })

  it("returns empty + warning when no target-year columns found", () => {
    const rows = [
      [null, null, null, serial(2023, 0), serial(2023, 1)],
      ["BS.01.01.01", "Stuff", null, 100, 200],
    ]
    const wb = buildWb("BS X", rows)
    const result = parseWorkbookBsSheet(wb, "BS X", XLSX, { preferYear: 2026 })
    expect(result.year).toBeNull()
    expect(result.lines).toEqual([])
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0].reason).toContain("2026")
  })

  it("emits warning on unknown BS prefix and skips the row", () => {
    const rows = [
      [null, null, null, serial(2026, 0)],
      ["BS.99.01.01", "Mystery", null, 100],
      ["BS.01.01.01", "Real", null, 50],
    ]
    const wb = buildWb("BS X", rows)
    const result = parseWorkbookBsSheet(wb, "BS X", XLSX, { preferYear: 2026 })
    expect(result.lines.length).toBe(1)
    expect(result.lines[0].code).toBe("BS.01.01.01")
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0].reason).toContain("BS.99.01.01")
  })

  it("ignores non-leaf rows (parent-section codes like BS.01)", () => {
    const rows = [
      [null, null, null, serial(2026, 0)],
      ["BS.01", "ASSETS", null, 5000],
      ["BS.01.01", "NON-CURRENT", null, 3000],
      ["BS.01.01.01", "Cash", null, 100],
    ]
    const wb = buildWb("BS X", rows)
    const result = parseWorkbookBsSheet(wb, "BS X", XLSX, { preferYear: 2026 })
    // Parent rows skipped — only the leaf matters
    expect(result.lines.length).toBe(1)
    expect(result.lines[0].code).toBe("BS.01.01.01")
  })
})
