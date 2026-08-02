/**
 * Phase 13.6 (2026-08-02) — correcting a wrong import, without destroying the
 * evidence of what the workbook said.
 *
 * The owner asked twice: «чтоб потом можно было отредактировать вручную», and
 * «даже если импорт будет неправильным чтоб потом можно было откорректировать».
 * 11.91 made a discrepancy visible; until this, a person could see that a
 * figure was wrong and still had no way to fix it.
 *
 * ## Why this is not an edit box
 *
 * The obvious implementation — let someone type over the number — is the wrong
 * one, and obvious enough that a future session will reach for it. Four
 * reasons, each sufficient on its own:
 *
 *  1. **An edited indicator produces two truths.** The indicator is derived.
 *     Typing 58,880,102 over a wrong 72,333,200 leaves the P&L tab, the
 *     drill-down, every export and the board deck showing the old number,
 *     because they read the ROWS. The screen would agree with the client and
 *     the reports would not.
 *  2. **It makes the 11.91 check circular.** That check compares a derived
 *     figure against the workbook's own subtotal. If the derived figure can be
 *     hand-set, the natural thing to type is the subtotal — and then it
 *     reconciles, by construction, having verified nothing.
 *  3. **Recompute owns that column.** An override would be either erased on
 *     the next recompute, or permanently exempt the cell from its formula — a
 *     spreadsheet with extra steps, and one nobody would remember agreeing to.
 *  4. **Mutating an imported row burns the only faithful copy.** The imported
 *     rows are what the workbook said. That is what makes re-import safe, what
 *     makes the cross-foot meaningful, and what lets anyone answer "did we
 *     read it wrong, or was it wrong?".
 *
 * ## So a correction is an adjustment ROW
 *
 * Written against a named account and period, with an amount, a reason, an
 * actor and a timestamp. Imported rows stay exactly as parsed. Derived figures
 * move because the underlying sum moved — which means the terminal, the P&L,
 * the exports and the deck all move together, the one thing an override cannot
 * do.
 *
 * And it is a correction, not a reconciliation: `lastReconciledAt` is written
 * only by the 11.91 pass re-running afterwards and finding agreement. That is
 * the whole reason that pass is a separate, re-runnable step over stored
 * values rather than a side effect of the import.
 */

/** The `BudgetLine.origin` value that marks a human-entered adjustment. */
export const MANUAL_CORRECTION_ORIGIN = "manual_correction"

export interface CorrectionInput {
  organizationId: string
  companyId: string
  planId: string
  accountId: string
  /** `YYYY-MM`. Corrections are monthly, like the rows they sit beside. */
  period: string
  /** Signed, in the stored convention — costs positive (see 11.73c). */
  amount: number
  lineType: "revenue" | "cogs" | "expense"
  reason: string
  actorUserId: string
}

export type CorrectionRejection =
  | "empty_reason"
  | "zero_amount"
  | "bad_period"
  | "missing_scope"

/**
 * Why this input cannot become a correction, or null when it can.
 *
 * Pure, so the API route and any future UI validate identically instead of
 * drifting — which is how `budgetRows` ended up with three different
 * definitions of "has rows" (see `missing-data.ts`).
 */
export function rejectCorrection(input: CorrectionInput): CorrectionRejection | null {
  if (!input.organizationId || !input.companyId || !input.planId || !input.accountId) {
    return "missing_scope"
  }
  // A reason is not paperwork. Six months on, a correction with no stated
  // reason is indistinguishable from a mistake, and the person who could have
  // said why has forgotten.
  if (!input.reason || input.reason.trim().length < 3) return "empty_reason"
  // A zero adjustment changes nothing and would sit in every total and every
  // review queue forever, being nothing.
  if (!Number.isFinite(input.amount) || input.amount === 0) return "zero_amount"
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) return "bad_period"
  return null
}

/** The row fields a correction carries beyond an ordinary budget line. */
export function correctionStamp(input: {
  reason: string
  actorUserId: string
  now: Date
}): {
  origin: string
  correctionReason: string
  correctionBy: string
  correctionAt: Date
  correctionReviewAt: null
} {
  return {
    origin: MANUAL_CORRECTION_ORIGIN,
    correctionReason: input.reason.trim(),
    correctionBy: input.actorUserId,
    correctionAt: input.now,
    // A brand-new correction has nothing to review: no import has run since.
    correctionReviewAt: null,
  }
}

/** One correction, reduced to what the review rule needs. */
export interface CorrectionRef {
  id: string
  companyId: string
  accountId: string
  period: string
}

/** One (company × account × period) an import just wrote. */
export interface ImportedCell {
  companyId: string
  accountId: string
  period: string
}

/**
 * Which corrections a just-finished import may have invalidated.
 *
 * A correction SURVIVES a re-import — that is the point of excluding it from
 * the clean-slate. Surviving is not the same as still being right: if the new
 * workbook already contains the fix, the correction is now added on top of it
 * and the total is wrong in the other direction.
 *
 * So the rule is FLAG, never resolve. The platform cannot tell whether the new
 * rows supersede the correction or merely coincide with it — that needs
 * someone who knows what the correction was for. Auto-clearing would silently
 * revert a decision; auto-keeping would silently double it. Both are the class
 * of quiet wrongness this whole phase exists to remove.
 *
 * Matching is on (company, account, period) exactly. Not the amount: a
 * correction is flagged because its cell was rewritten, regardless of whether
 * the new figure happens to equal the old one.
 */
export function correctionsNeedingReview(
  corrections: readonly CorrectionRef[],
  writtenCells: readonly ImportedCell[],
): string[] {
  if (corrections.length === 0 || writtenCells.length === 0) return []
  const touched = new Set(
    writtenCells.map((c) => `${c.companyId}|${c.accountId}|${c.period}`),
  )
  return corrections
    .filter((c) => touched.has(`${c.companyId}|${c.accountId}|${c.period}`))
    .map((c) => c.id)
}
