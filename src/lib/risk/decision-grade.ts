/**
 * Phase 10 / Stage A5 — the decision-grade gate.
 *
 * One rule, stated once: **a value that cannot be traced or is stale must not
 * read as decision-grade.** ADR Trust Core — "no lineage/reconciliation means
 * no decision-grade colour"; 03-DATA-KPI-TRUST-SPEC §6 — "a failed calculation
 * never silently preserves the old decision-grade status".
 *
 * This module only *classifies*. It changes no value, no formula, no threshold
 * and no KPI. `value` is never read here — a provisional cell shows the same
 * number it always showed; what changes is whether the surface is allowed to
 * present it as certified.
 *
 * **Why the gate is not applied per-cell to the legacy Expert matrix (yet).**
 * Measured against the local dev database on 2026-07-16: of 1,269
 * `IndicatorValue` rows, **0 carry lineage** — Stage B5 added `revisionId` as a
 * nullable column with no backfill, and no production path stamps one yet, so
 * every legacy row is honestly `null`. (Reconciliation is equally absent: 0
 * rows have `lastReconciledAt`, written only by `scripts/audit-company.cjs`,
 * which has never run over this data.) All 498 coloured cells are therefore
 * untraced, and 294 of them are also >30 days old. Applying `no lineage → no colour` per cell today would demote 100% of
 * the coloured matrix. That is a cutover, not the "smallest protective
 * presentation" the handoff asks for (§11), and it collides with "keep the
 * current Expert Matrix available" (§4). So: the gate is defined and tested
 * here, and the *surface* states the legacy/provisional posture once. Per-cell
 * demotion is an owner decision recorded in IMPLEMENTATION-STATUS.md — the
 * evidence is the 0/1269, not a preference.
 *
 * The direction is always safe: this function can only ever *withhold*
 * decision-grade, never grant it.
 */

import type { HeatMapCell } from './heatmap-matrix';

/**
 * Why an observation is not decision-grade. Ordered by how much it should
 * worry a reader; `worstReason` returns the first that applies.
 */
export type ProvisionalReason =
  /** Recompute stored an error — the number is a formula/gap artifact. */
  | 'calculation_error'
  /** Zombie guard fired (no_budget_lines / rollup_no_children / out_of_range). */
  | 'unreliable_signal'
  /** No `revisionId`: the value cannot name the source state it came from. */
  | 'no_lineage'
  /** No `lastReconciledAt`: the value was never checked against its source. */
  | 'no_reconciliation'
  /** Computed too long ago to speak for the current period. */
  | 'stale'
  /** No value ingested, or not applicable — never decision-grade to begin with. */
  | 'no_observation';

export type ObservationGrade = 'decision-grade' | 'provisional';

export interface GradeVerdict {
  grade: ObservationGrade;
  /** Every rule that failed — the explainability requirement of spec §10.7. */
  reasons: ProvisionalReason[];
}

/**
 * Freshness window after which an observation stops speaking for its period.
 *
 * **Not invented here, and not a financial threshold.** This is the window
 * already shipped and in use: `trust-status.ts` (Phase L6) degrades a company
 * badge verified→partial on the same 30 days. Reusing it keeps one number in
 * the product instead of two.
 *
 * Still an open owner question (recorded in IMPLEMENTATION-STATUS.md): 30 days
 * is a sensible default for a monthly close, not an approved control. It is a
 * parameter, not a constant, so approving a different window is a call-site
 * change and not a rewrite.
 */
export const DEFAULT_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export interface GradeOptions {
  /** Freshness window. Defaults to the shipped 30 days. */
  staleAfterMs?: number;
  /**
   * Require lineage (a `revisionId`) for decision-grade.
   *
   * Defaults to **false** — not because lineage is optional (the ADR says it
   * is mandatory), but because no row in this database carries a `revisionId`
   * yet, so defaulting to `true` would silently demote every cell in the
   * product the moment this module gained a caller. Stage B5 added the column
   * and a writer that can stamp it; flipping this default belongs to the stage
   * that actually populates it, under review.
   */
  requireLineage?: boolean;
  /**
   * Require reconciliation (a `lastReconciledAt`) for decision-grade.
   *
   * Defaults to **false** for the same reason `requireLineage` does — 0 of
   * 1,269 rows carry the stamp — but it exists, and callers that require
   * lineage must require this too. Here is why that pairing is not optional:
   *
   * Before Stage B5, `requireLineage: true` was load-bearing all by itself,
   * because nothing could ever satisfy it. B5 gave imports a writer, so a
   * freshly imported cell now HAS a `revisionId` — and if lineage were the
   * only gate, that cell would be certified decision-grade the moment it
   * landed, having never been reconciled to its source, coverage-checked or
   * methodology-approved. Lineage answers "where did this come from?"; it
   * cannot answer "is it right?". Presence of a revision is necessary for
   * decision-grade and nowhere near sufficient, which is exactly what the
   * §5.1/§7 split says.
   */
  requireReconciliation?: boolean;
}

/** Statuses that carry a confident green/amber/red read. */
const COLOURED_STATUSES = new Set(['green', 'amber', 'red']);

/**
 * Classify one matrix cell.
 *
 * @param cell Cell, or undefined when the company/indicator pair has no value.
 * @param now  Injected clock — staleness must be deterministic in tests.
 */
export function classifyObservationGrade(
  cell: HeatMapCell | undefined,
  now: number,
  opts: GradeOptions = {},
): GradeVerdict {
  const {
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
    requireLineage = false,
    requireReconciliation = false,
  } = opts;
  const reasons: ProvisionalReason[] = [];

  // No cell, or a status that already reads neutral. `unknown` is a data gap
  // the UI already neutralises; it must never be mistaken for a real signal.
  if (!cell || !COLOURED_STATUSES.has(cell.status)) {
    return { grade: 'provisional', reasons: ['no_observation'] };
  }

  if (cell.error) reasons.push('calculation_error');
  if (cell.signalConfidence === 'low') reasons.push('unreliable_signal');
  // Lineage is `revisionId` — "can this value name the source state it came
  // from?" (Stage B5). It is deliberately NOT `lastReconciledAt`: that field
  // answers a different question ("was it checked against the source?"), and
  // conflating the two would let a reconciliation stamp masquerade as
  // provenance, or vice versa. Both are required for decision-grade; they fail
  // for different reasons and are recorded separately.
  if (requireLineage && !cell.revisionId) reasons.push('no_lineage');
  // The other half of the sentence above, and the one B5 makes load-bearing:
  // an imported cell can now name its source, and naming a source is not being
  // checked against it. Without this rule, stamping a revisionId would silently
  // certify a never-reconciled number.
  if (requireReconciliation && !cell.lastReconciledAt) {
    reasons.push('no_reconciliation');
  }

  if (isStale(cell.computedAt, now, staleAfterMs)) reasons.push('stale');

  return {
    grade: reasons.length === 0 ? 'decision-grade' : 'provisional',
    reasons,
  };
}

/**
 * A cell with no `computedAt` is treated as stale rather than fresh: absence of
 * evidence is not evidence of freshness, and the fail-closed direction is the
 * only safe one for a trust gate.
 */
function isStale(
  computedAt: string | null | undefined,
  now: number,
  staleAfterMs: number,
): boolean {
  if (!computedAt) return true;
  const t = Date.parse(computedAt);
  if (Number.isNaN(t)) return true;
  return now - t > staleAfterMs;
}

/** Reasons worst-first — the order of `ProvisionalReason`'s declaration. */
const REASON_SEVERITY: ProvisionalReason[] = [
  'calculation_error',
  'unreliable_signal',
  'no_lineage',
  'no_reconciliation',
  'stale',
  'no_observation',
];

/** The single reason worth showing when there is room for exactly one. */
export function worstReason(reasons: readonly ProvisionalReason[]): ProvisionalReason | null {
  for (const candidate of REASON_SEVERITY) {
    if (reasons.includes(candidate)) return candidate;
  }
  return null;
}

export interface SurfaceGradeSummary {
  /** Cells that would otherwise read as a confident green/amber/red. */
  coloured: number;
  /** Of those, how many clear every gate. */
  decisionGrade: number;
  /** Of those, how many do not. */
  provisional: number;
  /** True when at least one coloured cell is not decision-grade. */
  hasProvisional: boolean;
  /** True when *no* coloured cell is decision-grade — today's real state. */
  allProvisional: boolean;
}

/**
 * Summarise a whole matrix so the surface can state its posture once instead of
 * marking hundreds of cells. This is what makes the A5 presentation minimal:
 * with 0/1269 rows carrying lineage, the honest message is one badge, not 498.
 */
export function summarizeSurfaceGrade(
  cells: readonly HeatMapCell[],
  now: number,
  opts: GradeOptions = {},
): SurfaceGradeSummary {
  let coloured = 0;
  let decisionGrade = 0;

  for (const cell of cells) {
    if (!COLOURED_STATUSES.has(cell.status)) continue;
    coloured += 1;
    if (classifyObservationGrade(cell, now, opts).grade === 'decision-grade') {
      decisionGrade += 1;
    }
  }

  const provisional = coloured - decisionGrade;
  return {
    coloured,
    decisionGrade,
    provisional,
    hasProvisional: provisional > 0,
    // An empty matrix is not "all provisional" — there is nothing to qualify,
    // and a badge over an empty grid would be noise.
    allProvisional: coloured > 0 && decisionGrade === 0,
  };
}
