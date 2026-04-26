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
