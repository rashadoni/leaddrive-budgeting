/**
 * Phase C5 (Bloomberg uplift plan) — composite risk score.
 *
 * Reduces a company's HeatMap cells (one per indicator) into a single
 * 0-100 health score. Bloomberg-style "one-glance" summary that makes
 * the matrix scannable without inspecting every cell.
 *
 * Scoring contract:
 *   - green  → 100 pts
 *   - amber  → 50 pts
 *   - red    → 0 pts
 *   - unknown / missing → ignored (no penalty for "data gap")
 *
 * Final score = average of contributing pts. If a company has zero
 * scoreable cells (all unknown/missing), `score = null` — UI should
 * render a neutral "—" rather than fabricating a 0 (which would mean
 * "all red" — the worst possible signal, the opposite of "no data").
 *
 * Band classifier:
 *   - score ≥ 67 → 'green'  (healthy)
 *   - score ≥ 34 → 'amber'  (watch)
 *   - score <  34 → 'red'   (urgent)
 *
 * v1 is unweighted (simple average). Phase 7.E may introduce per-
 * indicator weights (e.g. liquidity > efficiency > growth) — kept as
 * a 🔄 in CARRYOVER if needed.
 */

import { isAggregateRollup, type HeatMapCell } from './heatmap-matrix';
import type { IndicatorStatus } from './formula-engine';

export type CompositeBand = 'green' | 'amber' | 'red' | 'unknown';

export interface CompositeScore {
  /** 0-100, or null if no scoreable cells. */
  score: number | null;
  /** Band classifier; 'unknown' when score is null. */
  band: CompositeBand;
  /** Count of cells that contributed to the average (excludes unknown/missing). */
  contributingCount: number;
  /** Total cells inspected (for "X of Y indicators" UX). */
  totalCount: number;
}

// 'missing' isn't a real DB-emitted status — `HeatMapCell.status` is
// always one of the 4 IndicatorStatus values (matrix endpoint at
// `/api/indicators/matrix/route.ts:184` casts to IndicatorStatus before
// emitting). 'missing' only appears as a UI fallback in HeatMap.tsx
// when the cell itself is undefined; this helper sees real cells only.
const STATUS_PTS: Record<IndicatorStatus, number | null> = {
  green: 100,
  amber: 50,
  red: 0,
  unknown: null,
};

/**
 * Compute a company's composite score from a list of cells (typically
 * filtered to one company already, but the helper itself is agnostic
 * — it just averages whatever it's given).
 */
export function computeCompositeScore(
  cells: readonly HeatMapCell[],
): CompositeScore {
  let sum = 0;
  let contributingCount = 0;
  for (const c of cells) {
    const pts = STATUS_PTS[c.status];
    if (pts !== null) {
      sum += pts;
      contributingCount++;
    }
  }
  if (contributingCount === 0) {
    return {
      score: null,
      band: 'unknown',
      contributingCount: 0,
      totalCount: cells.length,
    };
  }
  const score = Math.round(sum / contributingCount);
  return {
    score,
    band: scoreToBand(score),
    contributingCount,
    totalCount: cells.length,
  };
}

export function scoreToBand(score: number): CompositeBand {
  if (score >= 67) return 'green';
  if (score >= 34) return 'amber';
  return 'red';
}

/**
 * Phase C5 (architect Round-1 sub-12 closure) — shared aggregator for
 * HeatMap.tsx + board-deck/page.tsx.
 *

 * Groups cells by `companyId` (skipping aggregate-rollup rows via the
 * shared `isAggregateRollup(c)` helper — covers both Turn 33.5 synthetic
 * averages AND sub-44 cont'd real parent-co rollup IVs) and computes the
 * composite per company. Two modes via the `companyIds` arg:
 *   - omitted: result includes only companies that have at least one
 *     non-rollup cell (HeatMap pattern — sparse map)
 *   - provided: result includes EVERY listed id, with empty-cell
 *     companies getting a `score: null` "no data" composite (board-deck
 *     pattern — table renders one row per operational sub-co even
 *     when missing IndicatorValues)
 *
 * Locks the rollup-skip invariant in one place — divergent skip logic
 * across call-sites would silently shift sub-group composites between
 * the Terminal and Board Deck (architect Round-1 sub-12 ⚠️ closure).
 * Sub-44 cont'd architect closure: gate switched from raw
 * `isSubgroupRollup` field-check to the `isAggregateRollup` helper so
 * adding a new aggregate variant doesn't require touching every site.
 */
export function computeCompositeByCompany(
  cells: readonly HeatMapCell[],
  companyIds?: readonly string[],
): Map<string, CompositeScore> {
  const byCo = new Map<string, HeatMapCell[]>();
  for (const c of cells) {
    if (isAggregateRollup(c)) continue;
    const list = byCo.get(c.companyId);
    if (list) list.push(c);
    else byCo.set(c.companyId, [c]);
  }
  const out = new Map<string, CompositeScore>();
  if (companyIds) {
    for (const id of companyIds) {
      out.set(id, computeCompositeScore(byCo.get(id) ?? []));
    }
  } else {
    for (const [id, list] of byCo) {
      out.set(id, computeCompositeScore(list));
    }
  }
  return out;
}
