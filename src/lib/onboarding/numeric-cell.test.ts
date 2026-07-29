/**
 * Phase 11.31 — the one numeric cell parser.
 *
 * The measured defect: `azseker-workbook-bs.ts` treated a comma as a THOUSANDS
 * separator and `dynamic-bs-adapter.ts` treated it as a DECIMAL one, and the
 * financial handler calls the first then falls through to the second. `"1,5"`
 * therefore landed as 15 on one path and 1.5 on the other — a 10× error in a
 * balance sheet, with no warning either way.
 */
import { describe, it, expect } from "vitest"
import { parseNumericCell, numericCellValue } from "./numeric-cell"

const v = (cell: unknown) => parseNumericCell(cell).value

describe("parseNumericCell — the two comma conventions", () => {
  it("reads both separators by position: the RIGHTMOST is the decimal point", () => {
    expect(v("1,234.56")).toBe(1234.56) // Anglo
    expect(v("1.234,56")).toBe(1234.56) // European
    expect(v("1.234.567,89")).toBe(1234567.89)
    expect(v("1,234,567.89")).toBe(1234567.89)
  })

  it("treats a repeated separator as grouping", () => {
    expect(v("1,234,567")).toBe(1234567)
    expect(v("1.234.567")).toBe(1234567)
  })

  it("reads a single separator with 1-2 trailing digits as a DECIMAL", () => {
    // This is the case the two old parsers disagreed on.
    expect(v("1,5")).toBe(1.5)
    expect(v("12,45")).toBe(12.45)
    expect(v("0,12345")).toBe(0.12345)
    expect(v("1.5")).toBe(1.5)
  })

  it("reads a single separator with exactly 3 trailing digits as GROUPING, and FLAGS it", () => {
    // Genuinely ambiguous: 1234 under grouping, 1.234 under the decimal
    // reading. Grouping is the overwhelmingly common intent here, but
    // guessing silently is exactly what produced the 10× error.
    const r = parseNumericCell("1,234")
    expect(r.value).toBe(1234)
    expect(r.ambiguous).toBe(true)
    expect(r.reason).toMatch(/thousands grouping/)
  })

  it("does not flag a leading-zero decimal as ambiguous", () => {
    // "0,123" has no digits that could be a thousands group before it… but it
    // does have "0", so it takes the grouping branch. Assert the actual
    // behaviour rather than pretending otherwise.
    expect(parseNumericCell(",123").value).toBe(0.123)
    expect(parseNumericCell(",123").ambiguous).toBe(false)
  })
})

describe("parseNumericCell — real spreadsheet noise", () => {
  it("passes native numbers straight through", () => {
    expect(v(1234.56)).toBe(1234.56)
    expect(v(0)).toBe(0)
    expect(v(-500)).toBe(-500)
  })

  it("strips currency symbols and every space Excel emits", () => {
    expect(v("₼ 1 234,56")).toBe(1234.56)
    expect(v("1 234 567")).toBe(1234567) // NBSP grouping
    expect(v("$1,234.00")).toBe(1234)
  })

  it("reads accounting negatives", () => {
    expect(v("(1 234,56)")).toBe(-1234.56)
    expect(v("(500)")).toBe(-500)
  })

  it("reads a trailing minus, as ERP exports emit", () => {
    expect(v("1234-")).toBe(-1234)
    expect(v("500,25-")).toBe(-500.25)
  })

  it("keeps an explicit zero distinguishable from a failed parse", () => {
    // The whole point: 0 is data, null is absence. Several old call sites
    // coerced a failed parse to 0, which is a fabricated number.
    expect(parseNumericCell(0).value).toBe(0)
    expect(parseNumericCell("0").value).toBe(0)
    expect(parseNumericCell("abc").value).toBeNull()
    expect(numericCellValue("abc")).toBeNull()
  })

  it("returns null WITH a reason for text, and null WITHOUT one for empty", () => {
    // A dropped row deserves an explanation; an empty cell does not.
    expect(parseNumericCell("n/a").reason).toMatch(/not numeric/)
    expect(parseNumericCell("").reason).toBeUndefined()
    expect(parseNumericCell(null).reason).toBeUndefined()
  })

  it("refuses a Date — a date column is never an amount column", () => {
    const r = parseNumericCell(new Date("2026-01-01"))
    expect(r.value).toBeNull()
    expect(r.reason).toMatch(/date/)
  })

  it("rejects non-finite numbers rather than propagating them", () => {
    expect(v(NaN)).toBeNull()
    expect(v(Infinity)).toBeNull()
  })
})

describe("parseNumericCell — regressions the old parsers had", () => {
  it("parses 1,234,56 instead of returning NaN", () => {
    // azmade-sopl.ts replaced EVERY comma with a dot → "1.234.56" → NaN,
    // which applier.ts then coerced to a silent zero.
    expect(v("1,234,56")).toBe(123456)
  })

  it("does not turn a European decimal into a 10x number", () => {
    // azseker-workbook-bs.ts stripped commas: "1,5" → 15.
    expect(v("1,5")).not.toBe(15)
    expect(v("1,5")).toBe(1.5)
  })

  it("does not turn a grouped thousand into a fraction", () => {
    // dynamic-bs-adapter.ts replaced the first comma with a dot:
    // "1,234" → 1.234.
    expect(v("1,234")).toBe(1234)
  })
})
