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
import {
  detectWorkbookYears,
  detectSheetYears,
  detectMonthHeaderYears,
} from "./workbook-year"

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

// ── 2026-07-30 — per-sheet scan ────────────────────────────────────
//
// Extracted so a financial adapter can ask "is this sheet even about my year?"
// BEFORE paying for an LLM call: the zero-row fallback used to send every
// off-year sheet to the dynamic detector, which cost a Claude call each and
// could return `blocked` — refusing the entire import over the half of a
// two-year workbook the operator never asked for.
describe("detectSheetYears", () => {
  const xlsx = {
    utils: {
      sheet_to_json: (sheet: { aoa: unknown[][] }) => sheet.aoa,
    },
  }
  const sheetOf = (aoa: unknown[][]) => ({ aoa })

  it("reads the year off a month-serial header row", () => {
    // 45658 = 2025-01-01, 45689 = 2025-02-01
    const res = detectSheetYears(sheetOf([["code", "label", "", 45658, 45689]]), xlsx)
    expect(res.years).toEqual([2025])
    expect(res.multiYear).toBe(false)
  })

  it("reports BOTH years for a two-year sheet", () => {
    const res = detectSheetYears(
      sheetOf([["", "", 45658, 46023]]), // 2025-01 and 2026-01
      xlsx,
    )
    expect(res.years).toEqual([2025, 2026])
    expect(res.multiYear).toBe(true)
  })

  it("finds nothing on a sheet with no year — the caller must NOT skip it", () => {
    // This is the genuine "unknown layout" case that still deserves the LLM.
    const res = detectSheetYears(sheetOf([["Product", "Yes/No"], ["Nişanta", "Yes"]]), xlsx)
    expect(res.years).toEqual([])
    expect(res.dominant).toBeNull()
  })

  it("survives a null sheet and a parser that throws", () => {
    expect(detectSheetYears(null, xlsx).years).toEqual([])
    const boom = {
      utils: {
        sheet_to_json: () => {
          throw new Error("corrupt")
        },
      },
    }
    expect(detectSheetYears(sheetOf([[45658]]), boom).years).toEqual([])
  })

  it("agrees with the workbook-wide scan on the same content", () => {
    // Two copies of "what year is this" would drift; the workbook scan is
    // built from this one, and this pins that they stay the same answer.
    const aoa = [["", "", 45658, 45689]]
    const perSheet = detectSheetYears(sheetOf(aoa), xlsx)
    const wholeBook = detectWorkbookYears(
      { SheetNames: ["only"], Sheets: { only: sheetOf(aoa) } },
      xlsx,
    )
    expect(perSheet).toEqual(wholeBook)
  })
})

// ── 2026-07-30 — what the file can be IMPORTED for ────────────────
//
// The loose scan answers "is this year mentioned"; deciding what to WRITE
// needs a stricter question. Measured on actual-budget-v1.xlsx the loose scan
// reported FOURTEEN years (2015…2035), and the cause was not stray text but
// MONEY: an amount of 40,000-55,000 AZN sits inside the Excel date-serial
// range, so a column of figures reads as a column of dates.
describe("detectMonthHeaderYears", () => {
  const xlsx = { utils: { sheet_to_json: (s: { aoa: unknown[][] }) => s.aoa } }
  const book = (aoa: unknown[][]) => ({
    SheetNames: ["s"],
    Sheets: { s: { aoa } },
  })
  /** Twelve monthly serials starting at Jan of `year`. */
  const months = (year: number): number[] => {
    const base = Date.UTC(year, 0, 1)
    return Array.from({ length: 12 }, (_, m) =>
      Math.round((Date.UTC(year, m, 1) - Date.UTC(1899, 11, 30)) / 86_400_000),
    ).map((v, i) => (i === 0 ? Math.round((base - Date.UTC(1899, 11, 30)) / 86_400_000) : v))
  }

  it("finds the year of a real 12-month header", () => {
    expect(detectMonthHeaderYears(book([["code", "label", ...months(2026)]]), xlsx).years)
      .toEqual([2026])
  })

  it("IGNORES a row of amounts that merely fall in the serial range", () => {
    // This is the actual production failure: ordinary AZN figures.
    const amounts = [41_000, 52_300, 47_800, 44_100, 49_900, 43_200]
    expect(detectMonthHeaderYears(book([["Revenue", ...amounts]]), xlsx).years).toEqual([])
  })

  it("finds BOTH years of a two-year header", () => {
    expect(
      detectMonthHeaderYears(book([["", "", ...months(2025), ...months(2026)]]), xlsx).years,
    ).toEqual([2025, 2026])
  })

  it("does not offer a lone comparative column as its own year", () => {
    // A December-2024 comparative opening a 2025 header: importing "2024"
    // would write a single month. It is part of the run, not a year the sheet
    // is about.
    const dec2024 = Math.round((Date.UTC(2024, 11, 1) - Date.UTC(1899, 11, 30)) / 86_400_000)
    const res = detectMonthHeaderYears(book([["", dec2024, ...months(2025)]]), xlsx)
    expect(res.years).toEqual([2025])
  })

  it("needs at least three consecutive monthly steps", () => {
    const m = months(2026)
    // Two dates alone are a coincidence, not a header.
    expect(detectMonthHeaderYears(book([[m[0], m[1]]]), xlsx).years).toEqual([])
  })

  it("counts header rows per year, so a caller can weigh the evidence", () => {
    const res = detectMonthHeaderYears(
      {
        SheetNames: ["a", "b"],
        Sheets: {
          a: { aoa: [["", ...months(2026)]] },
          b: { aoa: [["", ...months(2026)]] },
        },
      },
      xlsx,
    )
    expect(res.counts[2026]).toBe(2)
  })
})

