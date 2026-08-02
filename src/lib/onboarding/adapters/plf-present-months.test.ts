/**
 * Phase 14.1 (2026-08-02) — an empty cell and a written zero stop being the
 * same thing.
 *
 * The owner asked for manual entry wherever data is missing. Looking at the
 * COGS tab to size that, three different situations turned out to render
 * identically as `—`:
 *
 *   Almond Costs Jan–Aug   no row; the account has 4 rows, months 8–11 only.
 *                          Almonds are harvested in autumn — the blank is
 *                          CORRECT and must never invite an entry.
 *   Corn Costs Sep–Nov     rows holding 2.5e-10, -1.0e-10, -1.2e-10 —
 *                          floating-point residue from the workbook's own
 *                          formulas, rendered as "0.00".
 *   Corn Costs Dec         genuinely absent.
 *
 * The first two are the dangerous pair. A `+` on every blank invites almond
 * costs for March; a cell showing "0.00" reads as filled when it holds
 * nothing.
 *
 * The information that separates them was destroyed in the parser by a single
 * `?? 0` — and the cash-flow parser in the same file never destroyed it, its
 * `perMonth` being `Array<number | null>` with "null means absent source
 * evidence; numeric zero is explicit evidence". `presentMonths` brings the P&L
 * side level without touching `perMonth`, so the sign flip, the cross-foot and
 * the zero-skip all behave exactly as before.
 */
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parsePlfPlSheet } from "./azseker-plf"

/** A 12-month PLF sheet. `null` in `cells` is an EMPTY cell, not a zero. */
function sheet(cells: Array<number | null>): XLSX.WorkBook {
  const header = ["Code", "Label", ...Array.from({ length: 12 }, (_, i) =>
    new Date(Date.UTC(2026, i, 1)))]
  const aoa: unknown[][] = [
    ["PLF"],
    header,
    ["PLF.01.01.01", "Revenue from Sale of Almond", ...cells],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  return { SheetNames: ["S"], Sheets: { S: ws } }
}

const only = (months: number[], value = 1000) =>
  Array.from({ length: 12 }, (_, i) => (months.includes(i) ? value : null))

describe("presentMonths — what the sheet actually showed", () => {
  it("marks the autumn-only shape that started this", () => {
    // Almond Costs on production: months 8–11, nothing before. Zero-based, so
    // September to December — the harvest.
    const res = parsePlfPlSheet(sheet(only([8, 9, 10, 11])), "S", XLSX, {
      preferYear: 2026,
    })
    expect(res.lines).toHaveLength(1)
    expect(res.lines[0].presentMonths).toEqual([
      false, false, false, false, false, false, false, false,
      true, true, true, true,
    ])
  })

  it("distinguishes a WRITTEN zero from an empty cell", () => {
    // The whole point. Both end up as 0 in `perMonth`; only `presentMonths`
    // can still tell them apart, and only if it is captured before the `?? 0`.
    const cells = only([0], 500)
    cells[1] = 0 // the client wrote a zero for February
    // cells[2] stays null — the sheet had nothing for March
    const line = parsePlfPlSheet(sheet(cells), "S", XLSX, { preferYear: 2026 })
      .lines[0]
    expect(line.perMonth[1]).toBe(0)
    expect(line.perMonth[2]).toBe(0)
    expect(line.presentMonths[1], "February: the client wrote 0").toBe(true)
    expect(line.presentMonths[2], "March: the sheet had nothing").toBe(false)
  })

  it("leaves perMonth exactly as it was", () => {
    // Additive by construction. The sign flip, the cross-foot sum and the
    // handler's zero-skip all read `perMonth`, and a change there would be a
    // money-path change disguised as a display fix.
    const line = parsePlfPlSheet(sheet(only([0, 5], 1234.56)), "S", XLSX, {
      preferYear: 2026,
    }).lines[0]
    expect(line.perMonth).toHaveLength(12)
    expect(line.perMonth[0]).toBe(1234.56)
    expect(line.perMonth[1]).toBe(0)
    expect(line.perMonth[5]).toBe(1234.56)
  })

  it("normalises sub-qəpik residue to a real zero", () => {
    // What a spreadsheet actually produces when its formulas cancel
    // imperfectly. Measured on `Corn Costs` in the 2026 budget: 2.5e-10,
    // -1.0e-10, -1.2e-10. The cell means "nothing here", and storing it as a
    // tiny amount made the account appear on the COGS list as a real cost
    // line — "0.0% pay · 0.00 AZN" — while a manual-entry surface would read
    // it as already filled.
    const cells = only([0], 5000)
    cells[3] = 2.510205376893282e-10
    cells[4] = -1.164153218269348e-10
    const line = parsePlfPlSheet(sheet(cells), "S", XLSX, { preferYear: 2026 })
      .lines[0]
    expect(line.perMonth[3]).toBe(0)
    expect(line.perMonth[4]).toBe(0)
    // Still PRESENT — the client's sheet did have a cell there, and that is a
    // different fact from the value being zero.
    expect(line.presentMonths[3]).toBe(true)
    expect(line.presentMonths[4]).toBe(true)
  })

  it("drops an account whose every cell is empty or residue", () => {
    // The Corn Costs case end to end. Normalising in the parser rather than at
    // the write boundary is what lets `allZero` see the truth and remove the
    // line entirely, instead of it reaching the screen as a cost line worth
    // nothing.
    const cells = Array.from({ length: 12 }, () => null) as Array<number | null>
    cells[8] = 2.5e-10
    cells[9] = -1.0e-10
    expect(parsePlfPlSheet(sheet(cells), "S", XLSX, { preferYear: 2026 }).lines)
      .toHaveLength(0)
  })

  it("always reports twelve months, however short the row", () => {
    // A consumer indexing by month must never fall off the end.
    const line = parsePlfPlSheet(sheet(only([0])), "S", XLSX, { preferYear: 2026 })
      .lines[0]
    expect(line.presentMonths).toHaveLength(12)
  })
})
