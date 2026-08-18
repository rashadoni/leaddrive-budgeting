/**
 * 2026-08-18 — the absence of a check is not a passed check.
 *
 * `plf-crossfoot.ts` has said since 11.88 that a sheet stating no total leaves
 * "the ABSENCE of a check, and the caller should say so rather than treating
 * silence as agreement". No caller did. The parser warns only on `mismatch`,
 * which is false when there is nothing to disagree WITH, so a workbook with no
 * subtotals produced a clean import report while the strongest guarantee in
 * the pipeline had quietly not applied.
 *
 * The question that produced this: "if I upload other files, will everything
 * land to the kopek too?" It lands to the kopek on `actual-budget-v1.xlsx`
 * BECAUSE that workbook states its own `PLF.10` and the import checks against
 * it. A file without one gets no such guarantee — and, until this change, no
 * notice that it was missing. That is the difference between "verified" and
 * "nothing is known to be wrong", and only one of them is worth trusting a
 * financial statement to.
 *
 * The post-write reconciliation does not close it: that proves everything
 * PARSED was written, never that everything in the file was parsed (11.71).
 * Only the sheet's own total can do that.
 *
 * Tested on the pure helper rather than through the parser, because the first
 * cut put this sentence in `PlfParseWarning[]` and a test caught it: that list
 * is a PROBLEM channel whose emptiness means "clean parse", and a routine
 * verdict about what could be established belongs on the result — the same
 * rule that keeps `signConvention` out of it.
 */
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { crossFootPlfSheet, crossFootAbsenceNotice } from "./plf-crossfoot"
import { parsePlfPlSheet } from "./azseker-plf"

const jan = (v: number) => [v, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

function sheetAoa(rows: unknown[][]): unknown[][] {
  const header = [
    "Code",
    "Label",
    ...Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, i, 1))),
  ]
  return [["PLF"], header, ...rows]
}

/** The twelve month columns in the fixtures above. */
const MONTH_COLS = Array.from({ length: 12 }, (_, i) => i + 2)

function workbook(rows: unknown[][]): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(sheetAoa(rows))
  return { SheetNames: ["S"], Sheets: { S: ws } }
}

describe("cross-foot absence notice", () => {
  it("speaks when the sheet states no total to check against", () => {
    const cf = crossFootPlfSheet(
      [1_000, -400],
      sheetAoa([
        ["PLF.01.01.01", "Revenue from Sale of Wheat", ...jan(1_000)],
        ["PLF.02.01.01", "Cost of Wheat", ...jan(-400)],
      ]),
      MONTH_COLS,
    )
    expect(cf.sheetTotal).toBeNull()
    expect(cf.mismatch).toBe(false) // nothing to disagree WITH — the trap

    const notice = crossFootAbsenceNotice(cf, 2)!
    expect(notice).toMatch(/CROSS-FOOT NOT AVAILABLE/)
    // It must say what was NOT established, not merely that a row is absent.
    expect(notice).toMatch(/nothing was\s+verified/i)
    // And name the total nobody checked, so a human can check it by hand.
    expect(notice).toContain("600.00")
  })

  it("stays silent when the check actually ran", () => {
    // The client's own workbook shape. Silence has to keep meaning "checked
    // and matched", or the new sentence is noise on every healthy import.
    const cf = crossFootPlfSheet(
      [1_000, -400],
      sheetAoa([
        ["PLF.01.01.01", "Revenue from Sale of Wheat", ...jan(1_000)],
        ["PLF.02.01.01", "Cost of Wheat", ...jan(-400)],
        ["PLF.10", "NET PROFIT / (LOSS)", ...jan(600)],
      ]),
      MONTH_COLS,
    )
    expect(cf.mismatch).toBe(false)
    expect(crossFootAbsenceNotice(cf, 2)).toBeNull()
  })

  it("stays silent on a disagreement, which already has its own voice", () => {
    const cf = crossFootPlfSheet(
      [1_000],
      sheetAoa([
        ["PLF.01.01.01", "Revenue from Sale of Wheat", ...jan(1_000)],
        ["PLF.10", "NET PROFIT / (LOSS)", ...jan(800)],
      ]),
      MONTH_COLS,
    )
    expect(cf.mismatch).toBe(true)
    expect(crossFootAbsenceNotice(cf, 1)).toBeNull()
  })

  it("stays silent when nothing parsed", () => {
    // An empty parse fails loudly elsewhere; "could not be checked" on top of
    // it buries the message that matters under one that does not.
    const cf = crossFootPlfSheet([], sheetAoa([]), MONTH_COLS)
    expect(crossFootAbsenceNotice(cf, 0)).toBeNull()
  })

  it("leaves the parser's warnings a problem channel", () => {
    // The rule this notice was moved out of the parser to respect: a sheet
    // with no total is not a defective sheet, so a clean parse of one still
    // reports zero problems.
    const res = parsePlfPlSheet(
      workbook([
        ["PLF.01.01.01", "Revenue from Sale of Wheat", ...jan(1_000)],
        ["PLF.02.01.01", "Cost of Wheat", ...jan(-400)],
      ]),
      "S",
      XLSX,
      { preferYear: 2026 },
    )
    expect(res.warnings).toEqual([])
    // The fact still travels — on the result, where the report reads it.
    expect(res.crossFoot?.sheetTotal).toBeNull()
  })
})
