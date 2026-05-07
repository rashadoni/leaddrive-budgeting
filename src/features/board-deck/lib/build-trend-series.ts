/**
 * Phase 7.G Turn XLIX (Board Deck v2 Turn 3) — 12-month composite
 * trend series.
 *
 * Pulls IndicatorValue rows for the trailing 12 months for an org,
 * computes per-month composite scores per company, then averages
 * across operational companies to a single score per month. Output
 * is an ordered array of `{period, score|null, band|null}` suitable
 * for SVG charting in `CompositeTrendChart.tsx`.
 *
 * **Period semantics**: input `currentPeriod` may be annual ("2026"),
 * monthly ("2026-04"), or quarterly ("2026-Q2"). We always emit a
 * MONTHLY series (12 entries, oldest → newest) regardless of input
 * period — the trend chart's value is showing month-over-month
 * progression. If the underlying DB only has annual data, missing
 * months render as null (chart shows gaps; honest visualization).
 *
 * **Pure module**: takes a Prisma client surface as input (test seam).
 * Caller (page.tsx) injects the real client.
 *
 * **Cost shape**: ONE `findMany` for all 12 months of all sub-cos
 * (single round-trip). Group-by-period in JS afterward. At ~60 cos ×
 * 60 indicators × 12 months = ~43K rows worst case — heavy but
 * acceptable for a server-rendered board page that loads <10×/day.
 * Phase D.5+ scale considerations are a separate follow-up.
 */

import type { PrismaClient } from "@prisma/client";
import {
  computeCompositeByCompany,
  scoreToBand,
  type CompositeBand,
} from "@/lib/risk/composite-score";
import type { HeatMapCell } from "@/lib/risk/heatmap-matrix";

export interface TrendPoint {
  /** YYYY-MM format. Always monthly granularity. */
  period: string;
  /** Holding-level composite score (0-100), or null if no scored
   *  sub-co data this month. */
  score: number | null;
  /** Derived band — `CompositeBand` (`green | amber | red | unknown`)
   *  when score is non-null; null when the month has no data
   *  (distinct from "unknown" which signals data-present-but-
   *  unscorable). The chart treats null as a gap. */
  band: CompositeBand | null;
}

/** Extract `YYYY-MM` from a flexible period input. Annual "2026"
 *  expands to its 12 months when iterated; monthly "2026-04" stays
 *  as-is; quarterly "2026-Q2" becomes the LAST month of the quarter
 *  (anchor for trailing-12-months walk). */
function periodAnchorYearMonth(
  rawPeriod: string,
): { year: number; month: number } {
  // Try monthly format first.
  const monthMatch = rawPeriod.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    return { year: Number(monthMatch[1]), month: Number(monthMatch[2]) };
  }
  // Quarterly form — anchor on the last month of the quarter.
  const quarterMatch = rawPeriod.match(/^(\d{4})-Q([1-4])$/);
  if (quarterMatch) {
    const q = Number(quarterMatch[2]);
    return { year: Number(quarterMatch[1]), month: q * 3 };
  }
  // Annual or unknown — anchor on December of that year.
  const yearMatch = rawPeriod.match(/^(\d{4})$/);
  if (yearMatch) {
    return { year: Number(yearMatch[1]), month: 12 };
  }
  // Fallback: treat as current calendar (defensive).
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

/** Walk back 12 months from anchor, oldest first. Anchor itself is
 *  the LAST element (most recent). */
export function trailingMonths(
  anchorYear: number,
  anchorMonth: number,
  count: number = 12,
): string[] {
  const out: string[] = [];
  let y = anchorYear;
  let m = anchorMonth;
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return out.reverse(); // oldest first
}

interface PrismaSurface {
  indicatorValue: {
    findMany: PrismaClient["indicatorValue"]["findMany"];
  };
}

export interface BuildTrendSeriesInput {
  organizationId: string;
  currentPeriod: string;
  /** Operational company ids to average across. Aligned with the
   *  existing snapshot's operational sub-cos. */
  operationalIds: readonly string[];
  /** Indicator ids to score. Mirrors snapshot.indicators. */
  indicatorIds: readonly string[];
}

export interface BuildTrendSeriesOptions {
  /** Inject Prisma (test seam). */
  prisma?: PrismaSurface;
  /** Override months back (default 12). */
  monthsBack?: number;
}

/** Build a 12-month trailing trend series.
 *
 *  Returns `monthsBack` entries oldest → newest. Months with no
 *  IndicatorValue rows for the org get `score: null`. */
export async function buildTrendSeries(
  input: BuildTrendSeriesInput,
  opts: BuildTrendSeriesOptions = {},
): Promise<TrendPoint[]> {
  const monthsBack = opts.monthsBack ?? 12;
  if (monthsBack < 1) return [];
  if (
    input.operationalIds.length === 0 ||
    input.indicatorIds.length === 0
  ) {
    // Nothing to score — return empty-shape series so the chart
    // still renders (12 null points = flat baseline).
    const { year, month } = periodAnchorYearMonth(input.currentPeriod);
    return trailingMonths(year, month, monthsBack).map((period) => ({
      period,
      score: null,
      band: null,
    }));
  }

  const { year, month } = periodAnchorYearMonth(input.currentPeriod);
  const periods = trailingMonths(year, month, monthsBack);

  if (!opts.prisma) {
    // No client injected and no real Prisma fallback in scope here
    // — caller MUST pass `prisma`. Pure-helper contract.
    throw new Error(
      "buildTrendSeries: opts.prisma is required (helper is pure; caller injects).",
    );
  }

  const rows = await opts.prisma.indicatorValue.findMany({
    where: {
      organizationId: input.organizationId,
      period: { in: periods },
      companyId: { in: input.operationalIds as string[] },
      indicatorId: { in: input.indicatorIds as string[] },
    },
    select: {
      companyId: true,
      indicatorId: true,
      value: true,
      status: true,
      period: true,
    },
  });

  // Group by period, then compute composite per company within each
  // month, then average across companies.
  type RowShape = {
    companyId: string;
    indicatorId: string;
    value: number | null;
    status: HeatMapCell["status"];
    period: string;
  };

  const byPeriod = new Map<string, RowShape[]>();
  for (const r of rows as RowShape[]) {
    const list = byPeriod.get(r.period) ?? [];
    list.push(r);
    byPeriod.set(r.period, list);
  }

  return periods.map((period): TrendPoint => {
    const monthRows = byPeriod.get(period);
    if (!monthRows || monthRows.length === 0) {
      return { period, score: null, band: null };
    }
    const cells: HeatMapCell[] = monthRows.map((r) => ({
      companyId: r.companyId,
      indicatorId: r.indicatorId,
      value: r.value as number,
      status: r.status,
    }));
    const composites = computeCompositeByCompany(
      cells,
      input.operationalIds as string[],
    );
    let sum = 0;
    let count = 0;
    for (const c of composites.values()) {
      if (typeof c.score === "number" && Number.isFinite(c.score)) {
        sum += c.score;
        count++;
      }
    }
    if (count === 0) return { period, score: null, band: null };
    const score = Math.round(sum / count);
    return { period, score, band: scoreToBand(score) };
  });
}
