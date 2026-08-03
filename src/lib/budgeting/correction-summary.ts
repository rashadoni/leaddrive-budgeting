/**
 * Phase 13.6 (2026-08-02) — what a total contains that a workbook did not.
 *
 * A correction moves the derived figures. That is the whole reason it is a row
 * and not an override: the terminal, the P&L, the exports and the deck all
 * shift together. But a total that silently contains hand-entered money is the
 * same failure this phase keeps finding — the number is right and the sentence
 * around it is missing. 72.3M of revenue was a plausible figure. So was 373M of
 * assets. So is a P&L that quietly includes an adjustment somebody made in
 * April and nobody remembers.
 *
 * The rule from the design: **marked everywhere, forever.** This is the shape
 * of that mark for any surface built from budget lines.
 */

import { MANUAL_CORRECTION_ORIGIN } from "./manual-correction"

/** The fields this needs. Anything with them can be summarised. */
export interface CorrectableLine {
  origin?: string | null
  plannedAmount: number
  correctionReviewAt?: Date | string | null
}

export interface CorrectionSummary {
  /** How many hand-entered rows are inside this total. */
  count: number
  /**
   * Their NET effect, signed. Not absolute, unlike the elimination weight in
   * 11.73: an elimination cancels by design and its net says nothing, whereas
   * corrections are meant to move the total and by exactly this much.
   */
  net: number
  /**
   * Of those, how many a later import has put in doubt by rewriting their
   * cell. Nonzero means the total may be double-counting and nobody has
   * looked yet.
   */
  needsReview: number
}

export const NO_CORRECTIONS: CorrectionSummary = {
  count: 0,
  net: 0,
  needsReview: 0,
}

/**
 * Summarise the corrections inside a set of lines.
 *
 * Returns the zero shape rather than null when there are none, so a caller
 * cannot accidentally render "contains corrections" from a truthy object. The
 * absence of corrections is a fact worth being able to state plainly, and
 * `count === 0` states it.
 */
export function summarizeCorrections(
  lines: ReadonlyArray<CorrectableLine>,
): CorrectionSummary {
  let count = 0
  let net = 0
  let needsReview = 0
  for (const l of lines) {
    if (l.origin !== MANUAL_CORRECTION_ORIGIN) continue
    count += 1
    net += Number.isFinite(l.plannedAmount) ? l.plannedAmount : 0
    if (l.correctionReviewAt) needsReview += 1
  }
  return { count, net, needsReview }
}

/**
 * The i18n key and params a surface needs to say this out loud.
 *
 * Null when there is nothing to say. A banner on every clean P&L is a banner
 * nobody reads by the second week — the same reason `coverageNotice` stays
 * quiet on a full year.
 *
 * Two different sentences, not one with a conditional clause: "this total
 * includes a correction" is information, and "one of them may now be
 * double-counting" is a call to act. Collapsing them would bury the second.
 */
export function correctionNotice(
  s: CorrectionSummary,
): { key: string; params: Record<string, string | number> } | null {
  if (s.count === 0) return null
  if (s.needsReview > 0) {
    return {
      key: "corrections.includesAndNeedsReview",
      params: { count: s.count, needsReview: s.needsReview },
    }
  }
  return { key: "corrections.includes", params: { count: s.count } }
}

/**
 * Phase 14.5 (2026-08-03) — the same fact, for a file that leaves the company.
 *
 * `correctionNotice` returns an i18n key for a React surface. An exported XLSX
 * has no translation runtime and no reader we control: it goes to a bank, an
 * auditor, a board pack, and it is opened months later by someone who was
 * never in this conversation. That is the whole argument for saying it in the
 * file rather than only on the screen — the screen has a banner, a banner has
 * a session, and a spreadsheet outlives both.
 *
 * A plain sentence in the export's own language (English, like every header in
 * it), formatted here rather than in the route so the wording is testable and
 * cannot drift between the two exports that need it.
 *
 * Returns null on a clean plan. A disclosure on every file is furniture by the
 * second week, and then the one that matters reads like furniture too.
 */
export function correctionDisclosureLine(s: CorrectionSummary): string | null {
  if (s.count === 0) return null
  const rows = s.count === 1 ? "1 manual correction" : `${s.count} manual corrections`
  const net = s.net.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const signed = s.net > 0 ? `+${net}` : net
  const base =
    `CONTAINS ${rows.toUpperCase()}, net ${signed} ₼ — figures adjusted by hand after import, ` +
    `not present in the source workbook.`
  if (s.needsReview === 0) return base
  // Deliberately a second sentence rather than a clause: "included" is
  // information, "may be double-counting" is a call to act, and one buries
  // the other when they share a sentence.
  const which =
    s.needsReview === 1
      ? "1 of them has"
      : `${s.needsReview} of them have`
  return (
    `${base} ${which} had the same cell rewritten by a later import and may now ` +
    `double-count — not yet reviewed.`
  )
}
