/**
 * 11.71 — the check that would have caught 11.70 before a row was written.
 *
 * `PLF.09.01` was dropped during PARSING, so it never entered `expectedSums`
 * and the post-write reconciliation had nothing to disagree with: GREEN,
 * `evidence: db-readback`, 80,000 AZN missing. That verdict answers
 * "was everything I parsed written?" and is read as "was the file transferred
 * correctly?" — a much stronger claim it cannot make.
 *
 * The workbook states its own bottom line in `PLF.10`. Comparing the parsed
 * leaves against it turns a silent loss into a number.
 */
import { describe, it, expect } from "vitest"
import { crossFootPlfSheet, CROSSFOOT_TOLERANCE_AZN } from "./plf-crossfoot"

/** Columns D..O in the real sheets. */
const MONTH_COLS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

function row(code: string, ...months: number[]): unknown[] {
  const r: unknown[] = [code, `${code} label`, null]
  for (let i = 0; i < 12; i++) r[MONTH_COLS[i]] = months[i] ?? 0
  return r
}

describe("crossFootPlfSheet", () => {
  it("agrees when every leaf was parsed", () => {
    const aoa = [row("PLF.01.01.01", 100), row("PLF.02.01.01", -40), row("PLF.10", 60)]
    const res = crossFootPlfSheet([100, -40], aoa, MONTH_COLS)
    expect(res.sheetTotal).toBe(60)
    expect(res.delta).toBe(0)
    expect(res.mismatch).toBe(false)
  })

  it("catches the 11.70 loss — a dropped leaf becomes an 80,000 gap", () => {
    // The real shape: AZSF's PLF.09.01 carried −40,000 in February and again
    // in April, and the parser never emitted it. The sheet's own PLF.10 still
    // counts it, so the two disagree by exactly the missing money.
    const aoa = [
      row("PLF.01.01.01", 1_000_000),
      row("PLF.09.01", -40_000, 0, -40_000), // present in the file…
      row("PLF.10", 920_000), // …and counted in the sheet's own total
    ]
    // …but absent from what the parser produced:
    const res = crossFootPlfSheet([1_000_000], aoa, MONTH_COLS)

    expect(res.mismatch).toBe(true)
    expect(res.delta).toBe(80_000)
  })

  it("stays silent within half a qəpik — float noise is not a defect", () => {
    const aoa = [row("PLF.01.01.01", 100), row("PLF.10", 100.004)]
    const res = crossFootPlfSheet([100], aoa, MONTH_COLS)
    expect(Math.abs(res.delta!)).toBeLessThanOrEqual(CROSSFOOT_TOLERANCE_AZN)
    expect(res.mismatch).toBe(false)
  })

  it("reports NO CHECK rather than agreement when the sheet states no total", () => {
    // The distinction that matters: a sheet without PLF.10 has not been
    // verified. Returning `mismatch: false` with `sheetTotal: null` lets the
    // caller say "unchecked" instead of implying "checked and fine".
    const res = crossFootPlfSheet([100], [row("PLF.01.01.01", 100)], MONTH_COLS)
    expect(res.sheetTotal).toBeNull()
    expect(res.delta).toBeNull()
    expect(res.mismatch).toBe(false)
  })

  it("sums stacked total rows on a sheet holding several business units", () => {
    // Before the BU split, one sheet carries a PLF.10 per unit. Their sum is
    // the sheet's bottom line, and the leaves are all of them together.
    const aoa = [
      row("PLF.01.01.01", 100),
      row("PLF.10", 100),
      row("PLF.01.01.01", 250),
      row("PLF.10", 250),
    ]
    const res = crossFootPlfSheet([100, 250], aoa, MONTH_COLS)
    expect(res.sheetTotal).toBe(350)
    expect(res.mismatch).toBe(false)
  })

  it("catches an EXTRA leaf too, not just a missing one", () => {
    // Double-counting a subtotal is the opposite failure and equally silent.
    // The check is symmetric by construction; pinned so it stays that way.
    const aoa = [row("PLF.01.01.01", 100), row("PLF.10", 100)]
    const res = crossFootPlfSheet([100, 100], aoa, MONTH_COLS)
    expect(res.delta).toBe(100)
    expect(res.mismatch).toBe(true)
  })

  it("ignores text in the total row rather than treating it as zero", () => {
    const aoa: unknown[][] = [row("PLF.01.01.01", 100)]
    const totalRow = row("PLF.10", 100)
    totalRow[MONTH_COLS[5]] = "n/a"
    aoa.push(totalRow)
    const res = crossFootPlfSheet([100], aoa, MONTH_COLS)
    expect(res.sheetTotal).toBe(100)
    expect(res.mismatch).toBe(false)
  })
})
