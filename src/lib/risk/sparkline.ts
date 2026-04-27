/**
 * Phase B2 (Bloomberg uplift plan) — sparkline computation.
 *
 * For a given (company, indicator, anchorPeriod), evaluates the
 * indicator's formula at each of the trailing 12 monthly periods
 * leading up to (and including) the anchor period. Returns a
 * `(number | null)[]` of length 12, ordered chronologically (oldest
 * first, newest last).
 *
 * Use `sparklineFormula` if the indicator declares one (variant tuned
 * for per-period evaluation, e.g. "rooms_sold_daily / rooms_available_daily * 100");
 * fall back to the regular `formula` otherwise. A `null` slot signals
 * a period whose formula evaluation failed (missing input, divide by
 * zero) — the chart layer should render that as a gap, not a zero.
 *
 * Computation is read-only — no DB writes here. The CLI worker
 * (scripts/compute-sparklines.ts) wraps this and persists the result
 * onto `IndicatorValue.sparkline`.
 *
 * Shape choice: `null` slots vs simply omitting them was chosen so the
 * UI can render a fixed 12-cell width with gaps where data is missing,
 * matching Bloomberg's "no-tick" gaps in price series.
 */

import { tryEvaluateFormula } from './formula-engine';
import { parsePeriod } from './periods';
import type { RecomputeDataSource } from './recompute';

export const SPARKLINE_LENGTH = 12;

export interface IndicatorForSparkline {
  id: string;
  formula: string;
  sparklineFormula?: string | null;
  requiredInputs: string[];
}

/**
 * Generate the trailing N monthly period strings ending at `anchor`
 * (inclusive). For anchor "2026-04" with N=12, returns ["2025-05",
 * "2025-06", ..., "2026-04"]. Anchor that's quarterly or yearly is
 * normalised to the LAST month of that period (e.g. "2026-Q2" → "2026-06"
 * → 12 months ending at June).
 */
export function trailingMonthPeriods(
  anchor: string,
  n: number = SPARKLINE_LENGTH,
): string[] {
  const period = parsePeriod(anchor);
  // Anchor is the LAST month covered by the period — for quarter/year,
  // walk backward from end-1.
  const end = new Date(period.end);
  end.setUTCMonth(end.getUTCMonth() - 1); // last full month inside the period
  const out: string[] = [];
  const cursor = new Date(end);
  for (let i = 0; i < n; i++) {
    const y = cursor.getUTCFullYear();
    const m = (cursor.getUTCMonth() + 1).toString().padStart(2, '0');
    out.unshift(`${y}-${m}`);
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return out;
}

/**
 * Evaluate `definition.formula` (or `sparklineFormula` when present)
 * for the (company, period) pair, returning a single number or null
 * if evaluation failed for any reason. Internally calls into the same
 * `RecomputeDataSource.buildContext` path that `recomputeIndicator`
 * uses — so resolver semantics are identical.
 */
export async function evaluateAt(
  ds: RecomputeDataSource,
  args: {
    organizationId: string;
    companyId: string;
    definition: IndicatorForSparkline;
    period: string;
    /**
     * Builder that mirrors `recomputeIndicator`'s context construction.
     * Caller-injected (rather than imported) to avoid a circular
     * dependency between `sparkline.ts` and `recompute.ts` AND to keep
     * `sparkline.ts` testable with a tiny stub.
     */
    buildContext: (a: {
      ds: RecomputeDataSource;
      organizationId: string;
      companyId: string;
      period: string;
      requiredInputs: string[];
    }) => Promise<{ context: Record<string, unknown> }>;
  },
): Promise<number | null> {
  try {
    const { context } = await args.buildContext({
      ds,
      organizationId: args.organizationId,
      companyId: args.companyId,
      period: args.period,
      requiredInputs: args.definition.requiredInputs,
    });
    const formula =
      args.definition.sparklineFormula && args.definition.sparklineFormula.length > 0
        ? args.definition.sparklineFormula
        : args.definition.formula;
    // `context` is built dynamically by injected resolvers; `tryEvaluateFormula`
    // expects `Record<string, number>` (FormulaContext). Cast at the boundary —
    // the engine itself coerces non-numeric values to NaN and short-circuits.
    const result = tryEvaluateFormula(
      formula,
      context as unknown as Record<string, number>,
    );
    if (!result.ok) return null;
    if (!Number.isFinite(result.value)) return null;
    return result.value;
  } catch (err) {
    // Log with indicator id for production debuggability — without this,
    // an "all-null sparkline" production case is impossible to root-cause.
    console.warn(
      `[sparkline] evaluateAt failed: indicator=${args.definition.id} ` +
        `company=${args.companyId} period=${args.period}: ${
          err instanceof Error ? err.message : String(err)
        }`,
    );
    return null;
  }
}

/**
 * Compute a 12-slot sparkline for (company, indicator) anchored at the
 * given period. Returned array is chronological (oldest first); `null`
 * slots indicate evaluation failures.
 */
export async function computeSparkline(
  ds: RecomputeDataSource,
  args: {
    organizationId: string;
    companyId: string;
    definition: IndicatorForSparkline;
    anchorPeriod: string;
    buildContext: Parameters<typeof evaluateAt>[1]['buildContext'];
    length?: number;
  },
): Promise<(number | null)[]> {
  const periods = trailingMonthPeriods(
    args.anchorPeriod,
    args.length ?? SPARKLINE_LENGTH,
  );
  return Promise.all(
    periods.map((period) =>
      evaluateAt(ds, {
        organizationId: args.organizationId,
        companyId: args.companyId,
        definition: args.definition,
        period,
        buildContext: args.buildContext,
      }),
    ),
  );
}
