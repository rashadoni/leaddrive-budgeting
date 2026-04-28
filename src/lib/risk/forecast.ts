/**
 * Phase C2 v1 (Bloomberg uplift plan) — predictive analytics: next-period
 * forecast from a sparkline series.
 *
 * Operates on the existing 12-slot trailing-month sparkline already
 * computed by `scripts/compute-sparklines.ts` (Phase B2). Pure
 * function — no LLM, no external data. v2 may add LLM-based pattern
 * recognition for non-linear series (already 🔄 in CARRYOVER).
 *
 * Method:
 *   - Ordinary least-squares linear regression on the indexed series
 *     (x=0..n-1, y=values). Skips null slots ("no tick" — Bloomberg
 *     semantics from Phase B2 sparkline computation). Requires ≥3
 *     non-null points; below that, returns `null` (insufficient data).
 *   - `predicted` = slope·n + intercept (next slot, where n = series length).
 *   - `confidence`:
 *       - 'high'   — R² ≥ 0.7 AND ≥6 data points (model explains most variance + decent sample size)
 *       - 'medium' — R² ≥ 0.4 OR ≥5 data points (some signal)
 *       - 'low'    — anything else (noisy or sparse)
 *
 * Confidence thresholds chosen to match Bloomberg Terminal's color-coded
 * forecast UX (high=green-text, medium=amber, low=gray) and to err on
 * the conservative side: a CFO seeing "high confidence" should expect
 * the model to be capturing real signal, not just fitting noise.
 *
 * What this DOESN'T do (deferred to v2 in CARRYOVER):
 *   - Multi-step forecasts (only next period)
 *   - Confidence intervals (point estimate only)
 *   - Seasonality detection
 *   - Cross-indicator regression
 *   - LLM narrative explanation
 */

export type ForecastConfidence = 'high' | 'medium' | 'low';

export interface ForecastResult {
  /** Predicted value for the next period (slope·n + intercept). */
  predicted: number;
  /** Confidence band — see jsdoc for thresholds. */
  confidence: ForecastConfidence;
  /** Slope of the fitted line — direction + magnitude. */
  slope: number;
  /** Y-intercept of the fitted line. */
  intercept: number;
  /** R² (coefficient of determination), 0–1. */
  r2: number;
  /** Number of non-null points used in the fit. */
  contributingCount: number;
  /** Method tag for UX ("linear-regression-v1"). */
  method: 'linear-regression-v1';
}

const MIN_POINTS = 3;

/**
 * Forecast the next slot for a given sparkline series. Returns `null`
 * if the series has fewer than 3 non-null points, OR if the series is
 * perfectly flat (no slope to project — semantically "no change
 * expected", but caller should render that branch differently from
 * "real prediction with high confidence").
 *
 * `flat` outcomes (all-identical y values) return predicted = mean,
 * slope = 0, r2 = 0, confidence = 'low' regardless of n. Without this
 * override the n≥5 medium-fallback would label a no-signal flat series
 * as "medium confidence", contradicting the semantic ("we have no
 * directional information"). Caller should still detect slope ≈ 0 and
 * render "no change expected" copy rather than treating the predicted
 * mean as a low-confidence directional signal.
 */
export function forecastNextPeriod(
  series: ReadonlyArray<number | null>,
): ForecastResult | null {
  // Collect (x, y) pairs from non-null slots, preserving the original
  // index as x so a series like [10, null, 12, null, 14] still gets a
  // slope estimate that respects the actual time spacing.
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      points.push({ x: i, y: v });
    }
  }
  if (points.length < MIN_POINTS) return null;

  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const denom = sumXX - n * meanX * meanX;
  // For n≥3 with distinct integer x indices, denom > 0 always
  // (denom = Σ(xᵢ − meanX)² and the points filter at line 87 enforces
  // n≥3 from a non-empty set of distinct indices). Architect sub-13
  // closure: dead guard removed; the math is safe.

  const slope = (sumXY - n * meanX * meanY) / denom;
  const intercept = meanY - slope * meanX;

  // R² = 1 - SS_res / SS_tot
  let ssRes = 0;
  let ssTot = 0;
  for (const p of points) {
    const yHat = slope * p.x + intercept;
    ssRes += (p.y - yHat) ** 2;
    ssTot += (p.y - meanY) ** 2;
  }
  // Perfectly flat series → ssTot = 0; division would NaN. Treat as
  // r2 = 0 + slope = 0 (already 0 from the formula since sumXY -
  // n·meanX·meanY = 0 when all y's identical). Predicted = mean.
  const r2 = ssTot === 0 ? 0 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));

  // Predicted = next index after the LAST observed slot. We use
  // series.length (not points.length) so a [10, null, 12, null, 14]
  // series with last index 4 forecasts index 5, not index 5 (5 = 5
  // here but matters when series ends with nulls).
  const nextX = series.length;
  const predicted = slope * nextX + intercept;

  // Flat-series override: when ssTot=0 (all y values identical), the
  // helper has no directional signal regardless of n. Force 'low' so
  // callers don't treat n≥5 medium-OR-fallback as meaningful for a
  // line that says "no change". (Architect Round-1 sub-13 closure.)
  let confidence: ForecastConfidence;
  if (ssTot === 0) confidence = 'low';
  else if (r2 >= 0.7 && n >= 6) confidence = 'high';
  else if (r2 >= 0.4 || n >= 5) confidence = 'medium';
  else confidence = 'low';

  return {
    predicted,
    confidence,
    slope,
    intercept,
    r2,
    contributingCount: n,
    method: 'linear-regression-v1',
  };
}
