/**
 * Cross-foot a parsed P&L against the workbook's OWN total row.
 *
 * 2026-07-31 (11.71) — `PLF.09.01` reached no database row and the import
 * still reported GREEN with `evidence: db-readback` (11.70). That verdict was
 * not lying; it was answering a narrower question than anyone reads it as.
 *
 * Post-write reconciliation compares `expectedSums` — built while PARSING —
 * against what the database holds. A row dropped DURING parsing never enters
 * the expected set, so there is nothing for it to disagree with. The chain
 * proves "everything I parsed was written". It cannot, even in principle,
 * prove "everything in the file was parsed", and that is the half a reader
 * assumes when they see green.
 *
 * The missing check is the one an accountant does first, and the workbook
 * already supplies it: these sheets carry their own computed totals —
 * `PLF.03` GROSS MARGIN, `PLF.08` EBITDA, `PLF.10` NET PROFIT — which the
 * importer deliberately does NOT import (they are derived; importing them
 * would double-count). Those rows are a free, independent statement of what
 * the leaves must add up to. Measured on `actual-budget-v1.xlsx`: the leaf
 * sum equals `PLF.10` to 0.000000 across all five business units.
 *
 * So this compares Σ(parsed leaves) against the sheet's own bottom line. Had
 * it existed, the 80,000 AZN would have surfaced as an 80,000 AZN gap at
 * parse time, before a single row was written.
 *
 * Pure: no I/O, no DB. It receives what was parsed and the raw grid, and
 * returns a number. The caller decides whether a gap warns or blocks.
 */

/** Codes whose rows are the sheet's own arithmetic, not input data. */
const TOTAL_ROW_CODE = "PLF.10"

/** Half a qəpik — the same tolerance the reconciliation layer uses. */
export const CROSSFOOT_TOLERANCE_AZN = 0.005

export interface CrossFootResult {
  /** Sum of the twelve monthly values across every parsed leaf. */
  parsedTotal: number
  /** The sheet's own `PLF.10` total for the same months, or null if absent. */
  sheetTotal: number | null
  /** `parsedTotal - sheetTotal`, or null when the sheet states no total. */
  delta: number | null
  /** True only when a total exists AND the two disagree beyond tolerance. */
  mismatch: boolean
  /**
   * 11.91 — every subtotal the sheet computes for itself, by code.
   *
   * `PLF.10` alone answers "did we read the rows correctly". These answer the
   * next question: does the INDICATOR derived from those rows equal what the
   * client's own statement says? `IND_REVENUE_TOTAL` against `PLF.01`,
   * `IND_GROSS_MARGIN` against `PLF.03 / PLF.01`, and so on — an independent
   * check, because the importer never reads these rows.
   *
   * That is the claim `IndicatorValue.lastReconciledAt` is supposed to carry
   * and which nothing in the product had ever been able to make: the field was
   * written only by a manual CLI that never ran on this data, so the terminal's
   * decision-grade gate withheld certification from every cell in the matrix.
   */
  statedSubtotals: Record<string, number>
}

/**
 * @param leafMonthlySums one entry per parsed leaf: its twelve months summed,
 *        in the FILE's own sign convention (costs negative). Passing
 *        post-flip values would compare a different quantity and always
 *        mismatch.
 * @param aoa the raw sheet grid, so the total row can be read back out.
 * @param monthCols the twelve column indices the header scan resolved.
 */
export function crossFootPlfSheet(
  leafMonthlySums: readonly number[],
  aoa: readonly unknown[][],
  monthCols: readonly number[],
): CrossFootResult {
  const parsedTotal = leafMonthlySums.reduce((a, b) => a + b, 0)

  // Collect every `PLF.NN` the sheet states, not just the bottom line. A
  // section repeated per stacked business unit sums, exactly as PLF.10 does.
  const statedSubtotals: Record<string, number> = {}
  for (const row of aoa) {
    const code = typeof row?.[0] === "string" ? (row[0] as string).trim() : ""
    if (!/^PLF\.\d{2}$/.test(code)) continue
    let rowSum = 0
    let sawNumber = false
    for (const c of monthCols) {
      const v = row[c]
      if (typeof v === "number" && Number.isFinite(v)) {
        rowSum += v
        sawNumber = true
      }
    }
    if (!sawNumber) continue
    statedSubtotals[code] = (statedSubtotals[code] ?? 0) + rowSum
  }

  let sheetTotal: number | null = null
  for (const row of aoa) {
    const code = typeof row?.[0] === "string" ? (row[0] as string).trim() : ""
    if (code !== TOTAL_ROW_CODE) continue
    let rowSum = 0
    let sawNumber = false
    for (const c of monthCols) {
      const v = row[c]
      if (typeof v === "number" && Number.isFinite(v)) {
        rowSum += v
        sawNumber = true
      }
    }
    if (!sawNumber) continue
    // A BU-split sheet holds one total row; an unsplit one holds several
    // stacked, and their sum is the sheet's bottom line either way.
    sheetTotal = (sheetTotal ?? 0) + rowSum
  }

  if (sheetTotal === null) {
    // No stated total is not a failure — plenty of sheets have none. It is
    // the ABSENCE of a check, and the caller should say so rather than
    // treating silence as agreement.
    return { parsedTotal, sheetTotal: null, delta: null, mismatch: false, statedSubtotals }
  }

  const delta = parsedTotal - sheetTotal
  return {
    parsedTotal,
    sheetTotal,
    delta,
    mismatch: Math.abs(delta) > CROSSFOOT_TOLERANCE_AZN,
    statedSubtotals,
  }
}

/**
 * The sentence an import report owes its reader when the sheet stated no
 * total of its own (2026-08-18).
 *
 * `crossFootPlfSheet` has said since 11.88 that a missing total leaves "the
 * ABSENCE of a check, and the caller should say so rather than treating
 * silence as agreement". No caller did: the parser warns only on `mismatch`,
 * which is false when there is nothing to disagree WITH, so a workbook
 * carrying no subtotals produced a clean report while the strongest guarantee
 * in the pipeline had quietly not applied.
 *
 * Returned as a string for the import report rather than pushed into the
 * parser's `warnings`, which is a PROBLEM channel whose emptiness means
 * "clean parse" — the same reason `signConvention` travels on the result.
 * This is not a defect in the file; it is a limit on what was established.
 *
 * `null` when a total WAS stated (the check ran and speaks for itself) or
 * when nothing parsed (an empty sheet fails loudly elsewhere, and a second
 * message would bury the first).
 */
export function crossFootAbsenceNotice(
  crossFoot: CrossFootResult,
  lineCount: number,
): string | null {
  if (crossFoot.sheetTotal !== null || lineCount === 0) return null
  return (
    `CROSS-FOOT NOT AVAILABLE: this sheet states no ${TOTAL_ROW_CODE} ` +
    `(NET PROFIT / (LOSS)) row, so the ${lineCount} imported line(s) totalling ` +
    `${crossFoot.parsedTotal.toFixed(2)} could not be checked against the ` +
    `sheet's own arithmetic. Nothing is known to be wrong — but nothing was ` +
    `verified either, and a row dropped while parsing would leave no trace. ` +
    `Compare the totals by hand, or add the subtotal rows to the workbook so ` +
    `future imports can check themselves.`
  )
}
