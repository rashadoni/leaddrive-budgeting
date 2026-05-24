/**
 * Phase 7.A.0 — pure matrix helpers for the HeatMap visual.
 *
 * API returns a flat list of `{ companyId, indicatorId, status, value }`
 * cells; the component renders `companies.map(row => indicators.map(col))`
 * and looks up each cell by composite key. This keeps the payload compact
 * (no 2D array of nulls) and the lookup O(1). Extracted from the component
 * so it can be unit-tested without React.
 */

import type { IndicatorStatus } from './formula-engine';

export interface HeatMapCell {
  /** IndicatorValue.id — primary key of the persisted row. Drives the
   *  Variance Explainer endpoint (`/api/indicators/values/[id]/explain`).
   *  Optional for back-compat with cells that pre-date Phase 7.D. */
  indicatorValueId?: string;
  companyId: string;
  indicatorId: string;
  value: number;
  status: IndicatorStatus;
  /**
   * Phase 7.N C5 v2 — per-indicator composite weight.
   * Carried from `IndicatorDefinition.weight` via the matrix API.
   * Optional for back-compat — cells without a weight are treated as 1.0
   * in `computeCompositeScore`.
   * Scale: 0.7 (ESG/sentiment) → 1.0 (default) → 1.5 (profitability/liquidity).
   */
  weight?: number;
  /** Present only when the recompute pipeline stored an `error` in
   *  `IndicatorValue.inputs`. Gray cells on HeatMap use this to explain
   *  WHY to finance users (formula failure, missing data, out-of-range
   *  plausibility clamp). Passed through verbatim from the matrix API. */
  error?: { code: string; reason: string };
  /** Phase B2/B3 — 12-slot trailing-month sparkline series. `null` slots
   *  signal evaluation gaps (Bloomberg "no-tick" semantic). Optional —
   *  IVs predating B2 batch run have no sparkline; UI renders neutral
   *  baseline in that case. */
  sparkline?: (number | null)[];
  /**
   * Sub-44 cont'd architect 💡 closure — discriminated-union tag for the
   * cell's origin. Distinguishes operational cells from sub-group
   * aggregate variants. Adding a new variant = adding a literal here;
   * the type system + `isAggregateRollup` helper enforce every consumer
   * keeps up.
   *
   * Variants:
   *  - `'op'` (default when `kind` absent): Direct IV for an
   *    operational (level=2) company. Counted in composite + alerts +
   *    UI badge counts.
   *  - `'synthetic-rollup'` (Phase 7.B / Turn 33.5): synthetic sub-group
   *    rollup cell — value is AVERAGE of children's cell values +
   *    status is worst-of-children. Composite score (Phase C5) excludes
   *    these to avoid double-aggregation: rollup cells already encode
   *    children's worst-status, so averaging them again would
   *    underestimate sub-group health (e.g. 4 green + 1 red children →
   *    all-red rollup → composite ≈ 0, but true signal is 80% green).
   *  - `'real-rollup'` (sub-44 cont'd render-path): REAL parent-co
   *    rollup IV from `rollup()` resolver (e.g. `IND_HOLDING_REVENUE`
   *    summed across direct children). Has a persisted
   *    `indicatorValueId` (drill-downable) and value is the rollup()
   *    formula's true output, not a children-cell average. Emitted only
   *    for level=1 sub-group cos. Composite + alerts + UI badges MUST
   *    skip these (sub-group level is a navigation rollup, not a
   *    measurable entity).
   *
   * Use the `isAggregateRollup(c)` helper to gate uniformly across the
   * non-`'op'` variants — never check `kind` directly in consumer code,
   * keep all gating funneled through the helper.
   *
   * Backward-compat: cells emitted before sub-44 cont'd may omit `kind`;
   * absent = `'op'`. The helper handles undefined cleanly.
   */
  kind?: 'op' | 'synthetic-rollup' | 'real-rollup';
  /**
   * Phase 7.G Turn VI — count of operational child cells contributing to a
   * `kind: 'synthetic-rollup'` aggregate. Populated only on synthetic-rollup
   * cells (others omit). Drives the IndicatorDetail "Sub-group rollup —
   * averaged from N children" hint so a click on a sub-group cell explains
   * the absence of a single canonical IV row instead of looking like a
   * stale "no data" state. Optional + back-compat: cells emitted before
   * Turn VI omit it; consumers fall back to "averaged from children".
   */
  contributingChildCount?: number;
  /**
   * Phase 7.H F4.v2.1 — provenance stamp from `IndicatorValue.valueSource`.
   * Drives the modeled-marker on HeatMap cells (lowercase `e` overlay
   * for `modeled_generic` / `modeled_industry`) and the badge in Panel 3.
   *  - `disclosed`        : company-reported fact (manual / import)
   *  - `modeled_industry` : industry-specific intensity factor (v2.2+)
   *  - `modeled_generic`  : v1 placeholder formula (revenue × constant)
   *  - `macro`            : single-value macro context
   *  - `computed`         : real BudgetLine / OperationalFact / Booking
   * Optional + back-compat: cells emitted before v2.1 omit it; consumers
   * default to no marker (treats absence as `computed`).
   */
  valueSource?:
    | 'disclosed'
    | 'modeled_industry'
    | 'modeled_generic'
    | 'macro'
    | 'computed';
  /**
   * Phase 7.H F4.v2.4 — SASB-style materiality rating for this
   * (company.industry × indicator) pair. Only set on the 5 ESG
   * indicators (rest are universally material). HeatMap dims
   * `low_materiality` cells to ~30% opacity, `not_material` to ~12%
   * + strips status color so they don't compete with material reds.
   * Absent = `material` (default, full visual presence).
   */
  materiality?: 'material' | 'low_materiality' | 'not_material';
  /**
   * Financial-truth-infra Phase B.2 — sanity-band classification from
   * the last audit-company.cjs run for this IV. Drives the CompanyTree
   * trust badge (suspicious vs partial/verified) and the Panel-3
   * sanity-band chip. Null/missing when audit hasn't run yet.
   *   - 'normal'        : value within expected industry sanity band
   *   - 'low_extreme'   : below the low threshold (e.g. 0% gross margin
   *                       on services-industry → investigate)
   *   - 'high_extreme'  : above the high threshold (e.g. 100% gross
   *                       margin on food-processing → likely COGS
   *                       classification gap)
   *   - 'missing_input' : audit script couldn't compute (e.g. zero rev)
   *   - 'no_band'       : audited but no band defined for this combo
   */
  sanityBand?:
    | 'normal'
    | 'low_extreme'
    | 'high_extreme'
    | 'missing_input'
    | 'no_band';
  /**
   * Phase L6 — timestamp of the last audit-company.cjs verify pass on
   * this IV. Drives the trust-status staleness fallback (verified
   * degrades to partial when all material cells were last audited
   * more than 30 days ago). ISO-8601 string on the wire; consumers
   * parse with `Date.parse()` or `new Date()`.
   */
  lastReconciledAt?: string;
  /**
   * Phase 7.M Step 2 (2026-05-18) — signal-quality confidence tier
   * surfaced to finance users. Derived (not stored): the matrix endpoint
   * computes this from `valueSource` + presence of `error` so the UI
   * can visually distinguish gold-standard cells from proxy / modeled
   * cells, and demote cells that fired the zombie-row guard.
   *
   *  - `high`   : disclosed by finance OR computed from real budget /
   *               operational / booking data; no recompute error.
   *  - `medium` : computed but from industry-modeled or macro-broadcast
   *               inputs (not entity-specific facts). Treat as
   *               "indicative, not authoritative".
   *  - `low`    : zombie guard fired (no_budget_lines / rollup_no_children
   *               / out_of_range plausibility clamp). Numeric value is
   *               unreliable; consumers should hide or grey-out.
   *
   * Optional + back-compat — old clients ignore the field.
   */
  signalConfidence?: 'high' | 'medium' | 'low';
}

/**
 * Phase 7.M Step 2 — pure derive function for `signalConfidence`.
 *
 * Called by the matrix endpoint per-cell to stamp a finance-friendly
 * confidence tier on the wire. Pure / synchronous so it can be unit-
 * tested without React, Prisma or HTTP.
 *
 * Decision table (first match wins, top to bottom):
 *
 *   error present ............................. → 'low'
 *   valueSource = 'modeled_industry|generic'    → 'medium'
 *   valueSource = 'macro' ...................... → 'medium'
 *   valueSource = 'disclosed' .................. → 'high'
 *   valueSource = 'computed' (default) ......... → 'high'
 *
 * The dimension this measures is *signal quality* — "how much can I,
 * the finance user, trust this number as a real measurement of the
 * entity's reality". It's deliberately distinct from the existing
 * `IndicatorValue.confidence` (A/B/C/D industry-model tier) which is
 * an internal model-strength rating, not a user-facing data-trust
 * rating.
 */
export function deriveSignalConfidence(args: {
  valueSource?:
    | 'disclosed'
    | 'modeled_industry'
    | 'modeled_generic'
    | 'macro'
    | 'computed';
  error?: { code: string; reason: string };
}): 'high' | 'medium' | 'low' {
  if (args.error) return 'low';
  switch (args.valueSource) {
    case 'modeled_industry':
    case 'modeled_generic':
    case 'macro':
      return 'medium';
    case 'disclosed':
    case 'computed':
    default:
      return 'high';
  }
}

/**
 * Gate predicate: `true` for any sub-group/parent-co aggregate cell
 * (`kind === 'synthetic-rollup'` Turn 33.5 average OR
 * `kind === 'real-rollup'` sub-44 rollup IV). Centralizes the "is this
 * an aggregate row?" check so downstream consumers (composite-score,
 * alert-rules, UI badge counts) can't silently miss one of the variants
 * when a new aggregate kind is added.
 *
 * Sub-44 architect ⚠️ + 💡 closure: previously every consumer hand-checked
 * `isSubgroupRollup`. The render-path's `isRealParentRollup` boolean
 * would have leaked through 6 sites silently. The discriminated-union
 * `kind` field is now the canonical representation; this helper is the
 * canonical gate.
 *
 * Returns `false` when `kind` is undefined (back-compat default = `'op'`).
 */
export function isAggregateRollup(c: {
  kind?: 'op' | 'synthetic-rollup' | 'real-rollup';
}): boolean {
  return c.kind === 'synthetic-rollup' || c.kind === 'real-rollup';
}

/** `${companyId}:${indicatorId}` — deterministic, safe for Map keys. */
export function cellKey(companyId: string, indicatorId: string): string {
  return `${companyId}:${indicatorId}`;
}

/**
 * Build a lookup map from the flat cells payload. Missing `(company,
 * indicator)` pairs are simply absent from the map; callers render those
 * as `status='unknown'` without fabricating a cell.
 */
export function buildCellMap(
  cells: readonly HeatMapCell[],
): Map<string, HeatMapCell> {
  const map = new Map<string, HeatMapCell>();
  for (const c of cells) {
    map.set(cellKey(c.companyId, c.indicatorId), c);
  }
  return map;
}

export interface HeatMapStatusCounts {
  green: number;
  amber: number;
  red: number;
  unknown: number;
  /** (company, indicator) pairs with no computed row yet (not in the payload). */
  missing: number;
  /** total cells in the grid = companies × indicators. */
  total: number;
}

/**
 * Summary statistics used by the panel header ("12G / 5A / 2R / 8·").
 * `missing` counts grid positions where no cell exists; `unknown` counts
 * cells explicitly computed as status='unknown' (engine/eval failure).
 */
export function summarizeMatrix(
  companyIds: readonly string[],
  indicatorIds: readonly string[],
  cells: readonly HeatMapCell[],
): HeatMapStatusCounts {
  const map = buildCellMap(cells);
  const counts: HeatMapStatusCounts = {
    green: 0,
    amber: 0,
    red: 0,
    unknown: 0,
    missing: 0,
    total: companyIds.length * indicatorIds.length,
  };
  for (const cid of companyIds) {
    for (const iid of indicatorIds) {
      const cell = map.get(cellKey(cid, iid));
      if (!cell) {
        counts.missing += 1;
        continue;
      }
      counts[cell.status] += 1;
    }
  }
  return counts;
}

/** Map a status to the hex accent used in the terminal theme. */
export function statusColor(status: IndicatorStatus | 'missing'): string {
  switch (status) {
    case 'green':
      return '#00D4AA';
    case 'amber':
      return '#FFB020';
    case 'red':
      return '#FF4757';
    case 'unknown':
      return '#6B7280'; // slate-500 — computed but inconclusive
    case 'missing':
      return '#1F2937'; // slate-800 — no row at all
  }
}

/**
 * Tier-3 sub-29 M7 — color-blind safe palette companion. Returns a
 * single-glyph shape paired with each status so users with deuteranopia
 * / protanopia (≈8% of males) can still distinguish red from amber from
 * green without relying on color alone. Shapes chosen for positional /
 * stroke-density distinctness:
 *
 *   green   → ● (filled circle, low visual weight — "all good")
 *   amber   → ▲ (triangle — caution sign association)
 *   red     → ■ (square — heaviest visual weight — "stop")
 *   unknown → ◇ (open diamond — outline-only, "no signal")
 *   missing → · (mid-dot — barely visible, "not present")
 *
 * Pure, deterministic; safe to call in render loops without memoization.
 */
export function statusShape(status: IndicatorStatus | 'missing'): string {
  switch (status) {
    case 'green':
      return '●';
    case 'amber':
      return '▲';
    case 'red':
      return '■';
    case 'unknown':
      return '◇';
    case 'missing':
      return '·';
  }
}
