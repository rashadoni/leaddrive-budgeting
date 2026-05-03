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
