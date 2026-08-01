/**
 * Phase 8 C5 (2026-05-28) — batch-narrative fact-checker.
 *
 * Extension of C1's per-IV `verifyNarrative` for narratives that cite
 * org-wide numbers instead of per-cell ones (Morning Brief, Board Deck
 * narration). Reuses the same regex extractor + tolerance rules; the
 * only difference is how the «known numbers» set is built.
 *
 * **Known limitation:** C1's known-set includes ×100, ×1000, ×1M
 * expansions for every base number to tolerate ratio↔percent and
 * K/M paraphrases. For batch snapshots that contain many small
 * integers (single-digit company counts, low-teen indicator counts),
 * these expansions saturate the 1k-100k range — a fabricated 4-digit
 * number can fall within 5% of `someSmallCount × 1000`, escaping the
 * flag. This is acceptable: the checker catches obvious drift
 * (composite-score >100, future years, large fabricated currency
 * amounts) while staying silent on the noisy mid-range. Per-IV
 * narratives don't hit this because their inputs are mostly
 * mid-magnitude ratios/amounts already.
 *
 * For batch narratives the snapshot supplies:
 *  - Status totals across the holding (green / amber / red / unknown)
 *  - Per-company composite scores (0..100)
 *  - Alert match counts by severity (critical / warning / info)
 *  - Per-company status counts (one entry per operational company)
 *  - Operational company count + indicator count
 *
 * Numbers the LLM legitimately cites:
 *  - «12 companies in the red»  → totals.red
 *  - «AZSEKER-AZSF score 30/100» → compositeByCompany.get(azsf).score
 *  - «3 critical alerts»          → matchesBySeverity.critical.length
 *  - «8 of 13 sub-cos scored»     → from contributingCount in composite
 *
 * Just like C1, paraphrases (ratio↔percent, K/M, sign-flip,
 * European-decimal) are tolerated. The period field is the snapshot's
 * `period` (e.g. "2026") so the future-year check (claiming 2030 data
 * when snapshot is 2026) catches drift the same way as C1.
 */

import { verifyNarrative, type FactCheckResult } from "./narrative-fact-check"
import type {
  BoardSnapshotStatusCounts,
  BoardSnapshotTotals,
} from "@/lib/board-deck/build-snapshot"
import type { AlertSeverity, AlertMatch } from "@/lib/risk/alert-rules"
import { MIN_SCORING_CELLS, type CompositeScore } from "@/lib/risk/composite-score"

/**
 * Minimal snapshot shape the fact-checker needs. The full BoardSnapshot
 * has many more fields (cells, matches, etc.) but we only consume what
 * the narrative legitimately quotes. Keeping the input narrow makes the
 * Morning Brief adapter (which builds its own snapshot shape) easy too.
 */
export interface BatchNarrativeSnapshot {
  period: string
  totals: BoardSnapshotTotals
  compositeByCompany: Map<string, CompositeScore>
  countsByCompany: Map<string, BoardSnapshotStatusCounts>
  matchesBySeverity: Record<AlertSeverity, AlertMatch[]>
  /** Optional: org-wide aggregates the narrative may cite (e.g. total
   *  revenue, total CAPEX). Pass when the snapshot computes them; absent
   *  → just won't be in the known-numbers set. */
  extras?: Record<string, number>
}

/**
 * Run the batch fact-checker over a narrative. Returns the same
 * FactCheckResult shape as C1 (flags + totalChecked + matched) so the
 * UI banner pattern is identical.
 *
 * The narrative is checked against:
 *  - period year (future-year drift catch)
 *  - the org's status totals + the alert-severity counts as «result.value»
 *    candidates — wrapped in a single result so any cited count matches
 *  - composite scores + per-company status counts as resolved numbers
 *  - extras (optional caller-supplied aggregates) as aggregates
 */
export function verifyBatchNarrative(
  narrative: string,
  snapshot: BatchNarrativeSnapshot,
): FactCheckResult {
  // Flatten composite scores into a numeric resolved map. We expose
  // `score`, `scoreBeforeTags` (if present), and `contributingCount`
  // for every company so the LLM citing «AZSF 30/100» or «scored 19/28
  // indicators» both match.
  const resolved: Record<string, number> = {}
  for (const [companyId, c] of snapshot.compositeByCompany) {
    // CompositeScore.score is `number | null` (null when no scoreable
    // cells exist). Skip null entries — buildKnownNumbers would drop
    // them anyway, but the assignment trips TS.
    if (typeof c.score === "number") {
      resolved[`${companyId}.score`] = c.score
    }
    if (typeof c.scoreBeforeTags === "number") {
      resolved[`${companyId}.scoreBeforeTags`] = c.scoreBeforeTags
    }
    if (typeof c.contributingCount === "number") {
      resolved[`${companyId}.contributingCount`] = c.contributingCount
    }
    if (typeof c.totalCount === "number") {
      resolved[`${companyId}.totalCount`] = c.totalCount
    }
  }

  // Per-company status counts. LLM might cite «AZSF has 5 red
  // indicators» — that's countsByCompany.get(azsf).red.
  for (const [companyId, counts] of snapshot.countsByCompany) {
    resolved[`${companyId}.green`] = counts.green
    resolved[`${companyId}.amber`] = counts.amber
    resolved[`${companyId}.red`] = counts.red
    resolved[`${companyId}.unknown`] = counts.unknown
  }

  // Aggregates (alert-severity counts + totals + extras). C1's
  // flattenNumbers recurses, so any nested numeric leaf becomes a
  // known number.
  const aggregates: Record<string, unknown> = {
    totals: {
      operational: snapshot.totals.operational,
      indicators: snapshot.totals.indicators,
      cells: snapshot.totals.cells,
      green: snapshot.totals.green,
      amber: snapshot.totals.amber,
      red: snapshot.totals.red,
    },
    alertCounts: {
      critical: snapshot.matchesBySeverity.critical.length,
      warning: snapshot.matchesBySeverity.warning.length,
      info: snapshot.matchesBySeverity.info.length,
    },
  }
  if (snapshot.extras) {
    aggregates.extras = snapshot.extras
  }

  // Scale constants commonly cited in batch narratives — pre-seed so
  // we don't false-flag «30/100» or «50%» as fabricated numbers. These
  // are denominator constants, not data.
  aggregates._scaleConstants = {
    pct100: 100,
    halfPct: 50,
    quartile: 25,
    // 11.81 — the coverage floor. The model is told "fewer than 4 indicators"
    // and instructed to explain unscored entities; the moment it repeats the
    // threshold it was given, the fact-checker would flag the 4 as a
    // fabricated figure. It is a rule constant, not data.
    minScoringCells: MIN_SCORING_CELLS,
  }

  // Pick a representative «result.value» — the narrative's headline
  // metric is usually the holding-wide red count or the org composite
  // average. Use totals.red as the canonical headline number (the
  // most-cited single value); it also pulls into the known-numbers set
  // via the aggregates path.
  return verifyNarrative(narrative, {
    result: {
      value: snapshot.totals.red,
      status: "amber",
      period: snapshot.period,
    },
    resolved,
    aggregates,
  })
}

/**
 * Phase 8 C5 close (2026-05-29) — Morning Brief fact-checker adapter.
 *
 * The Morning Brief endpoint's narrative input is shaped differently
 * from BoardSnapshot — it's `{ worstCells, topMovers, activeAlerts,
 * newsBullets }` (see `MorningBriefInput` in `@/lib/intel/morning-brief`).
 * This adapter maps that shape into C1's `{result, resolved, aggregates}`
 * known-numbers contract so the same regex extractor + tolerance rules
 * apply, producing an identical `FactCheckResult` for the UI banner.
 *
 * Numbers the LLM legitimately cites in a Morning Brief:
 *  - «AZSEKER-CPC FP_GROSS_MARGIN at 8.2%»  → worstCells[i].value
 *  - «SUGAR_PRICE jumped +21%»               → topMovers[i].deltaPct
 *  - «3 critical alerts this morning»        → alertCounts.critical
 *  - «scanning 10 worst indicators»          → counts.worstCells
 *
 * The same ×100 / ×1000 / sign-flip / European-decimal paraphrase
 * tolerance from C1 applies; the documented small-integer-saturation
 * limitation (top of this file) carries over too. The `period` drives
 * the future-year drift catch (a brief that cites 2030 data when the
 * snapshot period is the current year is flagged).
 */
export interface MorningBriefSnapshot {
  period: string
  worstCells: Array<{
    companyCode: string
    indicatorCode: string
    value: number
  }>
  topMovers: Array<{
    companyCode: string
    indicatorCode: string
    deltaPct: number
  }>
  /** Active alert counts by severity (length of each MorningBriefInput
   *  activeAlerts bucket). */
  alertCounts: { critical: number; warning: number; info: number }
  /** Count of news bullets fed to the brief (the bullets themselves are
   *  qualitative text — only the count is a checkable number). */
  newsBulletCount: number
}

export function verifyMorningBriefNarrative(
  narrative: string,
  snapshot: MorningBriefSnapshot,
): FactCheckResult {
  // Per-cell worst-indicator values + per-mover delta percentages become
  // resolved formula vars (the most-cited concrete numbers in a brief).
  const resolved: Record<string, number> = {}
  for (const c of snapshot.worstCells) {
    resolved[`${c.companyCode}.${c.indicatorCode}`] = c.value
  }
  for (const m of snapshot.topMovers) {
    resolved[`${m.companyCode}.${m.indicatorCode}.deltaPct`] = m.deltaPct
  }

  const totalAlerts =
    snapshot.alertCounts.critical +
    snapshot.alertCounts.warning +
    snapshot.alertCounts.info

  const aggregates: Record<string, unknown> = {
    alertCounts: {
      critical: snapshot.alertCounts.critical,
      warning: snapshot.alertCounts.warning,
      info: snapshot.alertCounts.info,
    },
    counts: {
      worstCells: snapshot.worstCells.length,
      topMovers: snapshot.topMovers.length,
      newsBullets: snapshot.newsBulletCount,
      activeAlerts: totalAlerts,
    },
    // Same denominator-constant pre-seed as the batch variant so «50%»
    // / «top 10» phrasing isn't false-flagged as fabricated.
    _scaleConstants: { pct100: 100, halfPct: 50, quartile: 25, topN: 10 },
  }

  // Representative headline value — the count of red worst-cells is the
  // most-cited single number; it also enters the known set via `counts`.
  return verifyNarrative(narrative, {
    result: {
      value: snapshot.worstCells.length,
      status: "amber",
      period: snapshot.period,
    },
    resolved,
    aggregates,
  })
}
