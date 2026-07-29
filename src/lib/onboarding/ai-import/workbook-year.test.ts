/**
 * Phase 11.5b — workbook year detection.
 *
 * The failure this guards: pick 2026, upload a 2025 workbook, and every
 * adapter's year guard drops every sheet at zero rows while the group commits
 * "green" with nothing written. Right after a reset that reads as "my numbers
 * are gone".
 */
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { detectWorkbookYears } from "./workbook-year"

function wb(sheets: Record<string, unknown[][]>) {
  const book = XLSX.utils.book_new()
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(aoa), name)
  }
  return book
}

const monthDates = (year: number) =>
  Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(year, m, 1)))

describe("detectWorkbookYears", () => {
  it("reads the year from a 12-month date header", () => {
    const d = detectWorkbookYears(
      wb({ PLF: [["P&L", ...monthDates(2025)], ["PLF.01", 1, 2, 3]] }),
      XLSX,
    )
    expect(d.dominant).toBe(2025)
    expect(d.years).toEqual([2025])
    expect(d.multiYear).toBe(false)
  })

  it("reads a bare year written as a number", () => {
    const d = detectWorkbookYears(wb({ S: [["Budget", 2026], ["x", 1]] }), XLSX)
    expect(d.dominant).toBe(2026)
  })

  it("reads a year embedded in a header string", () => {
    const d = detectWorkbookYears(
      wb({ S: [["Jan 2024", "Feb 2024", "Mar 2024"]] }),
      XLSX,
    )
    expect(d.dominant).toBe(2024)
  })

  it("reports BOTH years of a two-year reporting pack", () => {
    const d = detectWorkbookYears(
      wb({ PLF: [["P&L", ...monthDates(2025), ...monthDates(2026)]] }),
      XLSX,
    )
    expect(d.years).toEqual([2025, 2026])
    expect(d.multiYear).toBe(true)
  })

  it("counts a year once per ROW, so a 12-month header cannot outvote everything", () => {
    // Without per-row dedupe, one 12-column header row would score 12 and
    // drown out a genuinely more common year elsewhere in the workbook.
    const d = detectWorkbookYears(
      wb({
        Wide: [["P&L", ...monthDates(2025)]],
        A: [["Report 2026"]],
        B: [["Report 2026"]],
      }),
      XLSX,
    )
    expect(d.counts[2025]).toBe(1)
    expect(d.counts[2026]).toBe(2)
    expect(d.dominant).toBe(2026)
  })

  it("ignores numbers that are not plausible years", () => {
    // Amounts, quantities and IDs must not be mistaken for years.
    const d = detectWorkbookYears(
      wb({ S: [["Revenue", 1500, 999, 12345, 1990, 2050]] }),
      XLSX,
    )
    expect(d.years).toEqual([])
    expect(d.dominant).toBeNull()
  })

  it("returns an empty detection for a workbook with no year at all", () => {
    const d = detectWorkbookYears(wb({ S: [["Item", "Qty"], ["Wheat", 5]] }), XLSX)
    expect(d.dominant).toBeNull()
    expect(d.multiYear).toBe(false)
  })

  it("only scans the top of each sheet, not the body", () => {
    // Transaction dates deep in the body say nothing about which year the
    // sheet is FOR, and 60 of them would swamp a single header row. The
    // 2019 rows start below the default 12-row window.
    const filler = Array.from({ length: 11 }, () => ["", ""])
    const body = Array.from({ length: 60 }, () => [
      "txn",
      new Date(Date.UTC(2019, 0, 1)),
    ])
    const d = detectWorkbookYears(
      wb({ S: [["Report 2026"], ...filler, ...body] }),
      XLSX,
    )
    expect(d.dominant).toBe(2026)
    expect(d.years).not.toContain(2019)
  })
})
