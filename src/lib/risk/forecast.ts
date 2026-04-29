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
  /**
   * Phase C2 v2 sub-24 — 95% prediction interval for the next-period
   * estimate. Optional because the helper falls back to null on
   * underlying-fit failures; when present, surfaces numeric ±range
   * alongside the categorical confidence band. UI may render as
   * `predicted ±marginOfError` text or as a translucent band.
   */
  predictionInterval?: ForecastConfidenceInterval;
}

const MIN_POINTS = 3;

/**
 * Internal: shared OLS linear-regression fit. All public helpers
 * (`forecastNextPeriod`, `forecastHorizon`, `forecastConfidenceInterval`)
 * consume this so the OLS pass runs ONCE per series, not 2-3× — closes
 * architect sub-23 💡 about redundant compute.
 *
 * Returns null when fewer than `MIN_POINTS` non-null finite slots OR
 * when `Sxx` collapses to 0 (degenerate; impossible for n≥3 distinct
 * integer x but kept as defensive guard).
 */
interface InternalFit {
  points: Array<{ x: number; y: number }>;
  n: number;
  slope: number;
  intercept: number;
  meanX: number;
  meanY: number;
  sxx: number; // Σ(xᵢ − meanX)²
  ssRes: number; // Σ(yᵢ − ŷᵢ)²
  ssTot: number; // Σ(yᵢ − meanY)²
  r2: number;
}

function fitLinearRegression(
  series: ReadonlyArray<number | null>,
): InternalFit | null {
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
  const sxx = sumXX - n * meanX * meanX;
  if (sxx === 0) return null;

  const slope = (sumXY - n * meanX * meanY) / sxx;
  const intercept = meanY - slope * meanX;

  let ssRes = 0;
  let ssTot = 0;
  for (const p of points) {
    const yHat = slope * p.x + intercept;
    ssRes += (p.y - yHat) ** 2;
    ssTot += (p.y - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));

  return {
    points,
    n,
    slope,
    intercept,
    meanX,
    meanY,
    sxx,
    ssRes,
    ssTot,
    r2,
  };
}

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
  // Sub-24 — share OLS fit with horizon + CI helpers (single pass).
  // Architect sub-23 💡 closure: 2× redundant compute eliminated.
  const fit = fitLinearRegression(series);
  if (!fit) return null;

  // Predicted = next index after the LAST observed slot. We use
  // series.length (not points.length) so a [10, null, 12, null, 14]
  // series with last index 4 forecasts index 5.
  const nextX = series.length;
  const predicted = fit.slope * nextX + fit.intercept;

  // Flat-series override: when ssTot=0 (all y values identical), the
  // helper has no directional signal regardless of n. Force 'low' so
  // callers don't treat n≥5 medium-OR-fallback as meaningful for a
  // line that says "no change". (Architect Round-1 sub-13 closure.)
  let confidence: ForecastConfidence;
  if (fit.ssTot === 0) confidence = 'low';
  else if (fit.r2 >= 0.7 && fit.n >= 6) confidence = 'high';
  else if (fit.r2 >= 0.4 || fit.n >= 5) confidence = 'medium';
  else confidence = 'low';

  // Sub-24 — also compute 95% prediction interval at x*. Reuses
  // already-computed sxx + ssRes from the shared fit (no double-pass).
  const predictionInterval = predictionIntervalFromFit(fit, nextX);

  return {
    predicted,
    confidence,
    slope: fit.slope,
    intercept: fit.intercept,
    r2: fit.r2,
    contributingCount: fit.n,
    method: 'linear-regression-v1',
    predictionInterval,
  };
}

/**
 * Internal — compute 95% prediction interval at a given x* using
 * already-computed fit residuals + Sxx. No additional OLS pass.
 */
function predictionIntervalFromFit(
  fit: InternalFit,
  xStar: number,
): ForecastConfidenceInterval {
  const df = fit.n - 2;
  const sigma = df > 0 ? Math.sqrt(fit.ssRes / df) : 0;
  const sePred =
    sigma * Math.sqrt(1 + 1 / fit.n + (xStar - fit.meanX) ** 2 / fit.sxx);
  const tCrit = tCritical95(df);
  const margin = tCrit * sePred;
  const predicted = fit.slope * xStar + fit.intercept;
  return {
    lower: predicted - margin,
    upper: predicted + margin,
    marginOfError: margin,
    level: 0.95,
    standardError: sePred,
    degreesOfFreedom: df,
  };
}

/**
 * Phase C2 v2 (sub-23) — multi-step forecast horizon. Projects `steps`
 * future periods along the SAME linear fit computed by
 * `forecastNextPeriod`. Returns one row per step (step=1..steps) with
 * the predicted value at each future index.
 *
 * **Why single-fit-multi-step (not re-fit per step):**
 * Re-fit-per-step requires new data points at each future index — we
 * don't have them. Pure extrapolation along the regression line is
 * the honest "this is what the line predicts" estimate; the LLM
 * narrator (forecast-explainer) is told to lead with limitation when
 * the horizon distance erodes the predictive signal.
 *
 * **Why not exponential smoothing or seasonal:** Both would require
 * a different model + more data. v2 ships the conservative linear
 * extrapolation; seasonality + exponential smoothing tracked as
 * separate v3 🔄 in CARRYOVER.
 *
 * Returns null with the same conditions as `forecastNextPeriod` (<3
 * non-null points). Confidence band is shared across the horizon
 * (single fit) — UI / LLM can degrade per-step if needed.
 */
export interface ForecastHorizonStep {
  /** 1-indexed step ahead (step=1 → next period, step=2 → +1, ...). */
  step: number;
  /** Predicted value at this step's x-index. */
  predicted: number;
}

export interface ForecastHorizonResult {
  /** Per-step predictions, ordered ascending step. */
  horizon: ForecastHorizonStep[];
  /** Slope of the underlying linear fit (shared across all steps). */
  slope: number;
  intercept: number;
  r2: number;
  contributingCount: number;
  /** Confidence band of the fit itself — same value for every step.
   *  Caller may degrade per-step (e.g. step≥3 → medium, step≥6 → low)
   *  but the underlying model confidence is invariant of horizon. */
  confidence: ForecastConfidence;
  method: 'linear-regression-v1';
}

const DEFAULT_HORIZON_STEPS = 3;
const MAX_HORIZON_STEPS = 12;

/**
 * Phase C2 v2 (sub-24) — confidence interval helper.
 *
 * For OLS linear regression, the prediction interval at a future x* is
 *   ŷ(x*) ± t_(α/2, n-2) · SE_pred(x*)
 * where:
 *   SE_pred(x*) = σ_residual · sqrt(1 + 1/n + (x* − x̄)² / Σ(xᵢ − x̄)²)
 *   σ_residual = sqrt(Σ(yᵢ − ŷᵢ)² / (n − 2))     ← residual std-error
 *
 * v1 ships **95% CI** by default (α=0.05). Approximation choices:
 *   - n − 2 degrees of freedom (n = contributing points). At n=3 → df=1
 *     → t_(.025,1) = 12.706; CI very wide, reflects huge uncertainty.
 *   - For n ≥ 30, t→z ≈ 1.96. We use a hardcoded table for df 1..30
 *     and clamp to 1.96 above 30 (sparkline rarely exceeds 30 points).
 *
 * Returns `null` only when the underlying fit fails (<3 non-null
 * points) — same gate as `forecastNextPeriod`. When the series is
 * perfectly linear (r²=1, ssRes=0) the CI collapses to ±0; UI should
 * detect this and either hide the band OR display "no model error".
 */
export interface ForecastConfidenceInterval {
  /** Lower bound of the prediction interval (level α). */
  lower: number;
  /** Upper bound. */
  upper: number;
  /** Half-width of the interval (predicted ± marginOfError). */
  marginOfError: number;
  /** Confidence level (0 < level < 1). v1 default 0.95 = 95% CI. */
  level: number;
  /** Standard error of the prediction at this x*. */
  standardError: number;
  /** Degrees of freedom used (n − 2). */
  degreesOfFreedom: number;
}

/**
 * Critical t-values for α=0.025 (95% two-sided CI). Indexed by df,
 * df=1..30. Above df=30 we clamp to 1.96 (z-distribution limit).
 * Source: standard t-distribution table; values pinned to 3 decimals.
 */
const T_CRIT_95: Record<number, number> = {
  1: 12.706,
  2: 4.303,
  3: 3.182,
  4: 2.776,
  5: 2.571,
  6: 2.447,
  7: 2.365,
  8: 2.306,
  9: 2.262,
  10: 2.228,
  11: 2.201,
  12: 2.179,
  13: 2.160,
  14: 2.145,
  15: 2.131,
  16: 2.120,
  17: 2.110,
  18: 2.101,
  19: 2.093,
  20: 2.086,
  21: 2.080,
  22: 2.074,
  23: 2.069,
  24: 2.064,
  25: 2.060,
  26: 2.056,
  27: 2.052,
  28: 2.048,
  29: 2.045,
  30: 2.042,
};

function tCritical95(df: number): number {
  if (df <= 0) return Number.POSITIVE_INFINITY;
  if (df <= 30) return T_CRIT_95[df];
  return 1.96;
}

/**
 * Compute prediction CI for `forecastNextPeriod`'s next-slot estimate
 * at `x* = series.length`. Returns null on insufficient data.
 *
 * Math: residual std-error from the same OLS fit, then prediction-
 * interval formula above. The "1 + 1/n + (x*−x̄)²/Sxx" factor is the
 * key piece — without the leading "1", we'd be giving a CONFIDENCE
 * interval (uncertainty about the line itself) instead of a PREDICTION
 * interval (uncertainty about a single future observation). For
 * forecasting we want the latter.
 */
export function forecastConfidenceInterval(
  series: ReadonlyArray<number | null>,
): ForecastConfidenceInterval | null {
  // Sub-24 — uses shared `fitLinearRegression` so caller gets identical
  // numbers as `forecastNextPeriod().predictionInterval`. Single OLS
  // pass per call.
  const fit = fitLinearRegression(series);
  if (!fit) return null;
  return predictionIntervalFromFit(fit, series.length);
}

export function forecastHorizon(
  series: ReadonlyArray<number | null>,
  steps: number = DEFAULT_HORIZON_STEPS,
): ForecastHorizonResult | null {
  if (steps < 1 || !Number.isInteger(steps)) {
    throw new Error(
      `forecastHorizon: steps must be a positive integer (got ${steps})`,
    );
  }
  if (steps > MAX_HORIZON_STEPS) {
    throw new Error(
      `forecastHorizon: steps capped at ${MAX_HORIZON_STEPS} (got ${steps}). Beyond that linear extrapolation produces meaningless numbers.`,
    );
  }
  // Sub-24 — use shared OLS fit directly (was: called forecastNextPeriod
  // which redundantly computed CI we don't need here). Single pass.
  const fit = fitLinearRegression(series);
  if (!fit) return null;

  // Compute confidence band using the same rules as forecastNextPeriod
  // — single-fit semantic means horizon shares this band across steps.
  let confidence: ForecastConfidence;
  if (fit.ssTot === 0) confidence = 'low';
  else if (fit.r2 >= 0.7 && fit.n >= 6) confidence = 'high';
  else if (fit.r2 >= 0.4 || fit.n >= 5) confidence = 'medium';
  else confidence = 'low';

  const startX = series.length;
  const horizon: ForecastHorizonStep[] = [];
  for (let k = 1; k <= steps; k++) {
    const xAtStep = startX + (k - 1);
    const predicted = fit.slope * xAtStep + fit.intercept;
    horizon.push({ step: k, predicted });
  }
  return {
    horizon,
    slope: fit.slope,
    intercept: fit.intercept,
    r2: fit.r2,
    contributingCount: fit.n,
    confidence,
    method: 'linear-regression-v1',
  };
}
