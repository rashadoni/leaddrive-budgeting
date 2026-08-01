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
 * `IndicatorValue` rows, **0 carried lineage at that checkpoint** — Stage B5
 * added `revisionId` as a nullable column with no backfill. Import writers may
 * now create revisions, but legacy and dependency-mixed recomputes remain
 * honestly untraced. (Reconciliation was equally absent at the checkpoint: 0
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
 * **Update, 11.86 (2026-08-01) — the lineage half now has a real writer, and
 * the reconciliation half still does not.** The live AI import records a
 * `DataRevision` and stamps it on the observations it can prove it produced —
 * every declared input in `requiredInputs` being workbook data that run wrote
 * clean-slate (`lineage-coverage.ts`). Measured on production 2026-08-01: 252
 * of the 1,428 coloured values, and 10 of the 56 coloured cells on the
 * terminal's default 2025 matrix. The rest read a market feed, a rollup, a
 * manual fact or a constant and remain untraced by construction. So `no_lineage` stops being
 * universal, which is what makes the per-cell question answerable at all: at
 * partial coverage, demotion is no longer a cutover that greys the whole matrix
 * — it becomes the only mechanism that answers "which ones?".
 *
 * `no_reconciliation` did NOT move and was not made to. The import's post-write
 * verdict (`evidence: "db-readback"`) proves the `budget_line` ROWS it wrote
 * match what it parsed; `lastReconciledAt` is a claim about a DERIVED value,
 * and most coloured cells read at least one input that verdict never examined.
 * Recording it would be the false green this module exists to prevent.
 *
 * Two things outside this module still gate the banner, and neither is a data
 * fact: `summarizeSurfaceGrade` counts synthetic rollup cells that have no
 * `IndicatorValue` and therefore no reachable state in which they clear, and
 * `/api/indicators/matrix` selects `computedAt` but never copies it onto the
 * emitted cell — so `isStale` fails closed on every coloured cell on arrival.
 *
 * The direction is always safe: this function can only ever *withhold*
 * decision-grade, never grant it.
 */

import { isAggregateRollup, type HeatMapCell } from './heatmap-matrix';

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
   * is mandatory), but because legacy and mixed-source rows are not guaranteed
   * to carry a trustworthy `revisionId`. Defaulting to `true` would silently
   * demote the current matrix. Flipping this default belongs to a reviewed
   * cutover after lineage and reconciliation coverage are measured.
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
  // A future observation timestamp is evidence of clock/data corruption, not
  // evidence of freshness. Exact `now` remains valid.
  if (t > now) return true;
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
    // 11.87 — an aggregate is not an observation, and counting it here made
    // the badge unreachable by construction.
    //
    // A synthetic rollup is computed on the client from its children's worst
    // status: `indicatorValueId: null`, and therefore no `revisionId`, no
    // `lastReconciledAt` and no `computedAt` — not "untraced yet" but
    // untraceable, with no state of the world in which it clears. Nineteen of
    // them sit on the terminal's default 2025 matrix, so `decisionGrade === 0`
    // held no matter how much lineage the import wrote, and the banner could
    // never move off `provisionalBadgeAll`.
    //
    // Its trustworthiness is exactly its children's, and its children are
    // counted here already; grading the derivation separately double-counts
    // the same doubt. Every other consumer of these cells — the composite
    // score, the alert engine — already drops aggregates via
    // `isAggregateRollup`. This is that rule, applied where it was missing,
    // not a relaxation: no cell gains decision-grade from this change, the
    // denominator simply stops containing rows that cannot answer.
    if (isAggregateRollup(cell)) continue;
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
