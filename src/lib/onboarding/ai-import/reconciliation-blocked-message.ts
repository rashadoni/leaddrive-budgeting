/**
 * 2026-08-03 — why a red reconciliation is red, in the sentence that announces
 * it.
 *
 * Every other blocking issue in the AI-import panel names a number: "3 conflicts
 * across files", "8 accounts need review". This one said a colour —
 * "Reconciliation is red, so the import cannot be applied safely" — and stopped.
 *
 * The evidence was already on the wire. `/api/import/ai-auto-multi` has sent
 * `reconciliation.evidence` since Phase 11.2, and the comment it ships with is
 * the whole argument for this file:
 *
 *     A verdict with `sheetsVerified: 0` is NOT proof of anything, and the
 *     receipt has to say so: before this phase every verdict was a parse-time
 *     self-compare (expected vs expected, green by construction) that was
 *     being read as a database reconciliation.
 *
 * The panel rendered that as a flat red. So an operator whose check never RAN
 * was told their numbers disagreed — a different problem, with a different
 * remedy, and the more alarming of the two. Measured on production 2026-08-03:
 * `sheetsVerified: 0`, `sheetsUnverified: 0`, `allCommittedGroupsVerified:
 * false` — nothing was compared to anything.
 *
 * Pure so the wording is testable without mounting the form.
 */

import { describeDrift, type NamedDrift } from "./drift-summary"

export interface ReconciliationEvidence {
  /** Sheets whose sums were re-queried from the DB after the write. */
  sheetsVerified: number
  /** Sheets that carry no reconcilable sums (settings JSON, zero rows). */
  sheetsUnverified: number
  unverifiedSheetNames?: string[]
  allCommittedGroupsVerified: boolean
  /**
   * The biggest workbook-vs-database disagreements, worst absolute manat
   * first. The whole point of this module after 2026-08-03: a controller is
   * not chasing "a red verdict", they are chasing a figure.
   */
  worstDrift?: ReadonlyArray<NamedDrift>
}

export interface ReconciliationMessageChoice {
  /** i18n key under `doctor.issue`. */
  key:
    | "reconciliationBlockedNothingChecked"
    | "reconciliationBlockedNamed"
    | "reconciliationBlockedDrifted"
    | "reconciliationBlocked"
  params?: Record<string, string | number>
  /**
   * The drift lines behind the sentence, already formatted. Rendered as a
   * list under the message so the reader can start on the biggest one without
   * opening anything.
   */
  lines?: string[]
}

/** How many unverified sheet names to name before the list stops helping. */
const MAX_NAMED_SHEETS = 4

/**
 * Choose the sentence a red reconciliation deserves.
 *
 * Three outcomes, and the first two are genuinely different findings:
 *
 *  • **Nothing was checked** — zero verified AND zero unverified means no group
 *    was formed at all. Not a mismatch; a check that did not run. Saying so is
 *    the point of this module.
 *  • **Something was checked and disagreed** — name how many, and which sheets
 *    could not be covered, so the reader knows the scope of what was proven.
 *  • **No evidence at all** — a receipt from a deployment older than Phase 11.2.
 *    Falls back to the original wording rather than inventing counts.
 */
export function chooseReconciliationBlockedMessage(
  evidence: ReconciliationEvidence | null | undefined,
): ReconciliationMessageChoice {
  if (!evidence) return { key: "reconciliationBlocked" }

  const verified = evidence.sheetsVerified ?? 0
  const unverified = evidence.sheetsUnverified ?? 0

  if (verified === 0 && unverified === 0) {
    return { key: "reconciliationBlockedNothingChecked" }
  }

  // The figure beats the count. When the reconciler actually found lines that
  // disagree, a controller needs THOSE — company, statement, account, month,
  // both amounts — not "3 of 5 sheets". The count stays available in the
  // receipt for anyone who wants it.
  const drifts = evidence.worstDrift ?? []
  if (drifts.length > 0) {
    return {
      key: "reconciliationBlockedNamed",
      params: { n: drifts.length, verified, total: verified + unverified },
      lines: drifts.map(describeDrift),
    }
  }

  const names = (evidence.unverifiedSheetNames ?? []).slice(0, MAX_NAMED_SHEETS)
  return {
    key: "reconciliationBlockedDrifted",
    params: {
      verified,
      total: verified + unverified,
      unverified,
      // An em dash rather than an empty string: "()" reads as a rendering bug.
      names: names.length > 0 ? names.join(", ") : "—",
    },
  }
}
