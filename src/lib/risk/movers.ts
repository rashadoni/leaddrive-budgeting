/**
 * Phase 7.H Feature 2 — Sector Movers helper.
 *
 * Pure helper: given the matrix snapshot, returns the top-N indicator
 * cells with the largest 12-month sparkline delta (positive or negative
 * magnitude), bucketed by company industry.
 *
 * Used by TodayBrief (top-5 list) and HeatMap (highlight overlay v2).
 */

import { isAggregateRollup } from "./heatmap-matrix";

export interface MoverRow {
  companyCode: string;
  companyId: string;
  indicatorCode: string;
  indicatorName: string;
  indicatorId: string;
  ivId?: string;
  /** Industry of the company; "—" when unknown. */
  sector: string;
  /** Absolute change in last 12 months (last - first). */
  delta: number;
  /** Percent change (delta / |first| × 100). Always finite. */
  deltaPct: number;
  /** Last value in the series, kept for tooltip. */
  current: number;
  /** First non-null value in the series. Used when deltaPct ≈ −100%
   *  (only one meaningful data point) to show an absolute value instead
   *  of a meaningless "−100%" change. */
  firstValue: number;
  /** Status of the underlying cell (green/amber/red/unknown). */
  status: "green" | "amber" | "red" | "unknown";
  /** Compact 12-point series, for inline sparkline rendering. */
  sparkline: (number | null)[];
}

interface MatrixCellLike {
  companyId: string;
  indicatorId: string;
  status: "green" | "amber" | "red" | "unknown" | "missing";
  value: number;
  sparkline?: (number | null)[];
  indicatorValueId?: string;
  /** Aggregate-rollup discriminator — see isAggregateRollup. Absent = leaf. */
  kind?: "op" | "synthetic-rollup" | "real-rollup";
}

interface CompanyLike {
  id: string;
  code: string;
  industry: string | null;
}

interface IndicatorLike {
  id: string;
  code: string;
  nameEn?: string | null;
  nameAz?: string | null;
  nameRu?: string | null;
}

export interface ComputeMoversOpts {
  /** Default 5. */
  topN?: number;
  /** Default 0.5% — drop noise around zero. */
  minPctMagnitude?: number;
  /** Locale for indicator name selection. Defaults to "ru". */
  locale?: "en" | "ru" | "az";
}

export function computeTopMovers(
  cells: MatrixCellLike[],
  companies: CompanyLike[],
  indicators: IndicatorLike[],
  opts: ComputeMoversOpts = {},
): MoverRow[] {
  const topN = opts.topN ?? 5;
  const minMag = opts.minPctMagnitude ?? 0.5;
  const locale = opts.locale ?? "ru";

  const coById = new Map(companies.map((c) => [c.id, c]));
  const indById = new Map(indicators.map((i) => [i.id, i]));

  const candidates: MoverRow[] = [];
  for (const cell of cells) {
    // Skip aggregate rollup cells — a sub-group / holding parent's sparkline is
    // a rollup of its children, so including it surfaces the same movement twice
    // (parent + child) in the top-movers list.
    if (isAggregateRollup(cell)) continue;
    if (!cell.sparkline || cell.sparkline.length < 2) continue;
    const co = coById.get(cell.companyId);
    const ind = indById.get(cell.indicatorId);
    if (!co || !ind) continue;
    const vals = cell.sparkline.filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v),
    );
    if (vals.length < 2) continue;
    const first = vals[0];
    const last = vals[vals.length - 1];
    if (Math.abs(first) < 0.0001) continue;
    const delta = last - first;
    const deltaPct = (delta / Math.abs(first)) * 100;
    if (!Number.isFinite(deltaPct)) continue;
    if (Math.abs(deltaPct) < minMag) continue;
    // 'missing' is a UI-only status; collapse to 'unknown'.
    const status =
      cell.status === "missing" ? "unknown" : cell.status;
    candidates.push({
      companyCode: co.code,
      companyId: co.id,
      indicatorCode: ind.code,
      indicatorName:
        locale === "en"
          ? (ind.nameEn ?? ind.nameRu ?? ind.code)
          : locale === "az"
            ? (ind.nameAz ?? ind.nameEn ?? ind.code)
            : (ind.nameRu ?? ind.nameEn ?? ind.code),
      indicatorId: ind.id,
      ivId: cell.indicatorValueId,
      sector: co.industry ?? "—",
      delta,
      deltaPct,
      current: last,
      firstValue: first,
      status,
      sparkline: cell.sparkline,
    });
  }

  // Sort by absolute delta% desc, take topN.
  candidates.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
  return candidates.slice(0, topN);
}

/** Group movers by sector for sectioned display. Preserves rank
 *  order within each group. */
export function groupBySector(movers: MoverRow[]): Map<string, MoverRow[]> {
  const groups = new Map<string, MoverRow[]>();
  for (const m of movers) {
    const arr = groups.get(m.sector) ?? [];
    arr.push(m);
    groups.set(m.sector, arr);
  }
  return groups;
}
