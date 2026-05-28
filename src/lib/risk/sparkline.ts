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
import { parsePeriod, type Period } from './periods';
import type { RecomputeDataSource } from './recompute';
import { getLogger } from '@/lib/log';

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger('risk:sparkline');

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
    log.warn('evaluateAt failed', {
      indicatorId: args.definition.id,
      companyId: args.companyId,
      period: args.period,
      err: err instanceof Error ? err.message : String(err),
    });
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

/**
 * Phase 7.E phase 2 — sparkline pipeline takes a `buildContext` callback
 * with `period: string` so it can iterate the trailing-12-month period
 * strings without coupling sparkline.ts to the Period parser. Recompute's
 * own `buildContext` takes `period: Period`. Both call sites of
 * `computeSparkline` in this codebase (`recomputeIndicator` inside
 * `recompute.ts` + the offline `scripts/compute-sparklines.ts` worker)
 * carry an identical 8-line glue that calls `parsePeriod` then
 * delegates. This helper hoists that glue into ONE place — sub-39
 * architect ⚠️ closure (sub-43).
 *
 * Usage:
 * ```ts
 * import { computeSparkline, bridgeRecomputeBuildContext } from './sparkline';
 * const sparkline = await computeSparkline(ds, {
 *   organizationId, companyId, definition, anchorPeriod: period,
 *   buildContext: bridgeRecomputeBuildContext(ds, recomputeBuildContext),
 * });
 * ```
 *
 * Generic in the buildContext return shape because recompute's
 * `buildContext` returns `{context, inputs, functions}` (sub-41 phase 3
 * extension) but sparkline only needs `{context}`. The helper
 * structural-types the input to "anything with a `context` field" so
 * downstream callers (test stubs, future variations) don't have to
 * shadow the full RecomputeBuildContextResult shape.
 */
export function bridgeRecomputeBuildContext(
  ds: RecomputeDataSource,
  recomputeBuildContext: (
    ds: RecomputeDataSource,
    args: {
      organizationId: string;
      companyId: string;
      period: Period;
      requiredInputs: string[];
    },
  ) => Promise<{
    context: Record<string, unknown>;
    // Sub-43 architect Round-1 closure — declare the inputs/functions
    // strip in the type system. Real recompute returns
    // `{context, inputs, functions}` (phase 3 extension); the bridge
    // narrows to `{context}` only by destructuring at the
    // implementation site. Annotating these as optional `unknown` here
    // makes the type system aware that the wider shape is acceptable
    // input — covariant-return acceptance — while the helper's
    // declared return below explicitly excludes them via
    // `inputs?: never; functions?: never`. Future refactor to
    // pass-through would fail TS, not silently leak the wider shape.
    inputs?: unknown;
    functions?: unknown;
  }>,
): NonNullable<Parameters<typeof computeSparkline>[1]['buildContext']> {
  return async (a) => {
    const period = parsePeriod(a.period);
    const { context } = await recomputeBuildContext(ds, {
      organizationId: a.organizationId,
      companyId: a.companyId,
      period,
      requiredInputs: a.requiredInputs,
    });
    // Explicit destructure-and-rewrap. Sub-43 architect closure —
    // making the strip intentional in the type system: a future
    // refactor to `return result;` (pass-through) would surface the
    // wider `{context, inputs, functions}` shape into the sparkline
    // boundary, which the upstream `Parameters<typeof computeSparkline>`
    // type rejects. Belt-and-braces alongside the `inputs?: never;
    // functions?: never` declaration on the bridge's nominal return.
    return { context };
  };
}
