/**
 * Phase 7.G Turn LXXXXVII (Phase 7.E #3 v2 E.2a) — predictive breach forecaster.
 *
 * Pure module: scans every IndicatorValue's sparkline, runs `forecastHorizon`
 * to project N future periods, classifies each forecasted value via
 * `classifyValue` against the same thresholds the live IV uses, and emits
 * `ForecastedBreach[]` ONLY for transitions worth surfacing (green → amber,
 * green → red, amber → red — i.e. status _worsening_).
 *
 * **Why purity matters:** caller (E.2b persistence wire) does the DB work;
 * this module just does the math. Keeps it deterministic, easy to test
 * with hand-shaped inputs, and trivially callable from cron / route /
 * test harness.
 *
 * **No LLM:** this module exists explicitly because the LLM is overkill
 * for trend-line classification — pure linear regression catches obvious
 * approaching-breach signals + leaves the LLM (E.2e digest) to narrate
 * what's already been classified.
 *
 * **Status worsening rules:**
 *   - green → amber, green → red, green → unknown: WORSENING
 *   - amber → red, amber → unknown: WORSENING
 *   - red → unknown: NOT WORSENING (already at floor)
 *   - amber → green, red → green, red → amber: IMPROVING (not surfaced)
 *   - same → same: NO CHANGE (not surfaced)
 *
 * **Confidence band derivation:**
 *   - forecast.confidence = 'high'   → "high"   (r²≥0.7 AND n≥6)
 *   - forecast.confidence = 'medium' → "medium" (r²≥0.4 OR n≥5)
 *   - forecast.confidence = 'low'    → "low"
 *   - degraded by horizon step: step≥3 capped at 'medium'; step≥6 capped at 'low'
 */

import { forecastHorizon, type ForecastConfidence } from "./forecast"
import { classifyValue, type IndicatorStatus, type Thresholds } from "./formula-engine"
import {
  fitMultivariateOLS,
  forecastMultivariate,
  type RegressorSeries,
} from "./multivariate-ols"

/** Default horizon (number of future periods to project). 3 covers a quarter
 *  for monthly indicators, 3 years for annual — balanced for both cadences. */
export const DEFAULT_BREACH_HORIZON_STEPS = 3

/** Maximum horizon (linear extrapolation degrades — beyond 6 the predicted
 *  value becomes meaningless on most series). */
export const MAX_BREACH_HORIZON_STEPS = 6

/** Worsening transition matrix: { from: { to: true } } means surface this
 *  breach. All others are suppressed. */
const WORSENING_TRANSITIONS: Record<IndicatorStatus, Partial<Record<IndicatorStatus, true>>> = {
  green: { amber: true, red: true, unknown: true },
  amber: { red: true, unknown: true },
  red: {}, // already at floor — no further degrade worth flagging
  unknown: {}, // can't worsen from unknown (ambiguous baseline)
}

export type BreachConfidenceBand = "high" | "medium" | "low"

/**
 * Phase 7.G Turn CVII (E.2c slice 3) — optional macro-overlay context.
 *
 * When supplied to `forecastBreach`, switches the underlying fit from
 * univariate `forecastHorizon` to multivariate `fitMultivariateOLS`,
 * incorporating FX/CPI/commodity series as additional regressors alongside
 * the time index. Caller pre-aligns the macro series via
 * `alignMacroSeriesByIndex` (macro-drivers.ts).
 *
 * Falls back to univariate when:
 *   - macro fit returns null (under-determined / singular / multicollinear)
 *   - any step's `futureValues` is missing or non-finite
 *
 * v1 simplification: caller responsible for projecting macro futures (e.g.
 * via `projectMacroFuturesAsConstant`). Real macro forecasting is a separate
 * problem (recursive forecastNextPeriod on each macro series, or external
 * forecasts).
 */
export interface BreachMacroContext {
  /** Macro regressor series, pre-aligned to sparkline index by caller (via
   *  `alignMacroSeriesByIndex` from macro-drivers.ts). Length of each
   *  series MUST equal `sparkline.length`. */
  regressors: RegressorSeries[]
  /** Future macro values at each horizon step. Outer length must be ≥ horizon
   *  steps; inner length must equal `regressors.length`. Index `step-1`
   *  carries the values for horizon step `step`. */
  futureValues: number[][]
}

export interface BreachForecasterInput {
  /** Identity of the IV being forecasted. */
  indicatorCode: string
  companyId: string
  /** Current period of the live IV (the "now" anchor for horizon offsets). */
  period: string
  /** Sparkline series (oldest → newest, may contain nulls). */
  sparkline: ReadonlyArray<number | null>
  /** Threshold bands the IV is currently classified against. */
  thresholds: Thresholds
  /** Current status of the live IV — used to detect transitions. */
  currentStatus: IndicatorStatus
  /** Optional: per-step driver attribution (free-form; surfaced in digest). */
  drivers?: Record<string, unknown>
  /** Phase 7.G Turn CVII (E.2c slice 3) — optional macro overlay. When
   *  supplied AND the multivariate fit succeeds, replaces the univariate
   *  forecastHorizon path. */
  macroContext?: BreachMacroContext
}

export interface ForecastedBreach {
  indicatorCode: string
  companyId: string
  period: string
  /** 1-indexed step ahead (1 = next period, 2 = +1, ...). */
  horizonStep: number
  currentStatus: IndicatorStatus
  predictedStatus: IndicatorStatus
  /** Numerical confidence (0-1) from the underlying linear fit. */
  forecastConfidence: number
  /** Categorical confidence after horizon-step degrade. */
  confidenceBand: BreachConfidenceBand
  predictedValue: number
  /** 95% prediction interval (when computable). */
  predictedLower?: number
  predictedUpper?: number
  /** Pass-through from input.drivers (caller decides shape). */
  drivers?: Record<string, unknown>
  /** Phase 7.G Turn CVII (E.2c slice 3) — true when multivariate macro
   *  overlay produced this forecast; false/absent when univariate fallback. */
  usedMacroOverlay?: boolean
}

/** Convert categorical forecast.confidence + horizon step → BreachConfidenceBand.
 *  Step≥3 caps at 'medium'; step≥6 caps at 'low'. */
export function deriveConfidenceBand(
  fitConfidence: ForecastConfidence,
  horizonStep: number,
): BreachConfidenceBand {
  let band: BreachConfidenceBand = fitConfidence
  if (horizonStep >= 6) band = "low"
  else if (horizonStep >= 3 && band === "high") band = "medium"
  return band
}

/** Convert categorical forecast.confidence → numeric (for sorting / threshold). */
function fitConfidenceToNumeric(c: ForecastConfidence): number {
  switch (c) {
    case "high":
      return 0.85
    case "medium":
      return 0.6
    case "low":
      return 0.3
  }
}

/** Decide if a transition from `from` → `to` is worth surfacing as a breach. */
export function isWorsening(from: IndicatorStatus, to: IndicatorStatus): boolean {
  return WORSENING_TRANSITIONS[from][to] === true
}

export interface BreachForecasterOptions {
  /** Number of future steps to project. Default 3, max 6. */
  horizonSteps?: number
}

/** Confidence-band derivation from raw r² + n (multivariate path). Mirrors
 *  univariate `forecast.ts` thresholds: r²≥0.7 AND n≥6 → high; r²≥0.4 OR n≥5
 *  → medium; else low. NaN r² (flat y) → low. */
function r2ToConfidence(r2: number, n: number): ForecastConfidence {
  if (!Number.isFinite(r2)) return "low"
  if (r2 >= 0.7 && n >= 6) return "high"
  if (r2 >= 0.4 || n >= 5) return "medium"
  return "low"
}

/** Forecast breaches for a single IV. Returns 0..N rows (one per worsening
 *  transition step in the horizon).
 *
 *  Phase 7.G Turn CVII (E.2c slice 3): when `input.macroContext` is supplied
 *  AND the multivariate fit succeeds, uses macro-overlay forecast (per-step
 *  CI from `forecastMultivariate`). Falls back to univariate `forecastHorizon`
 *  otherwise — same code path as before for callers without macro context.
 */
export function forecastBreach(
  input: BreachForecasterInput,
  opts: BreachForecasterOptions = {},
): ForecastedBreach[] {
  const steps = opts.horizonSteps ?? DEFAULT_BREACH_HORIZON_STEPS
  if (steps < 1 || steps > MAX_BREACH_HORIZON_STEPS) {
    throw new Error(
      `forecastBreach: horizonSteps must be in [1, ${MAX_BREACH_HORIZON_STEPS}] (got ${steps})`,
    )
  }

  // Try macro-overlay path first when context provided. Falls through to
  // univariate when fit fails (insufficient data / multicollinearity / bad
  // future values).
  const macro = input.macroContext
  if (macro && macro.regressors.length > 0) {
    // Validate: each regressor series length == sparkline length
    const allLengthsMatch = macro.regressors.every(
      (r) => r.series.length === input.sparkline.length,
    )
    if (allLengthsMatch && macro.futureValues.length >= steps) {
      // Build combined regressor list: time index + macro series
      const timeRegressor: RegressorSeries = {
        name: "_t",
        series: input.sparkline.map((_, i) => i),
      }
      const fit = fitMultivariateOLS(input.sparkline, [timeRegressor, ...macro.regressors])
      if (fit) {
        const breaches: ForecastedBreach[] = []
        for (let step = 1; step <= steps; step++) {
          const futureMacro = macro.futureValues[step - 1]
          if (
            !Array.isArray(futureMacro) ||
            futureMacro.length !== macro.regressors.length ||
            !futureMacro.every(Number.isFinite)
          ) {
            continue // skip step (caller didn't supply usable future macro values)
          }
          const tStar = input.sparkline.length + step - 1
          const fc = forecastMultivariate(fit, [tStar, ...futureMacro])
          if (!fc) continue
          const predictedStatus = classifyValue(fc.predicted, input.thresholds)
          if (!isWorsening(input.currentStatus, predictedStatus)) continue
          const baseConf = r2ToConfidence(fit.r2, fit.n)
          breaches.push({
            indicatorCode: input.indicatorCode,
            companyId: input.companyId,
            period: input.period,
            horizonStep: step,
            currentStatus: input.currentStatus,
            predictedStatus,
            forecastConfidence: Number.isFinite(fit.r2) ? Math.max(0, Math.min(1, fit.r2)) : 0,
            confidenceBand: deriveConfidenceBand(baseConf, step),
            predictedValue: fc.predicted,
            predictedLower: fc.predictionInterval.lower,
            predictedUpper: fc.predictionInterval.upper,
            drivers: input.drivers,
            usedMacroOverlay: true,
          })
        }
        return breaches
      }
      // Fit failed → fall through to univariate path
    }
    // Length-mismatch / not enough future steps → fall through
  }

  const horizon = forecastHorizon(input.sparkline, steps)
  if (!horizon) return []

  const breaches: ForecastedBreach[] = []
  // Use forecast.predictionInterval for step=1 only (the helper provides it
  // as an OLS by-product); for step≥2 we don't have a per-step CI without
  // re-fitting — leave undefined for now.
  for (const stepResult of horizon.horizon) {
    const predictedStatus = classifyValue(stepResult.predicted, input.thresholds)
    if (!isWorsening(input.currentStatus, predictedStatus)) continue
    breaches.push({
      indicatorCode: input.indicatorCode,
      companyId: input.companyId,
      period: input.period,
      horizonStep: stepResult.step,
      currentStatus: input.currentStatus,
      predictedStatus,
      forecastConfidence: fitConfidenceToNumeric(horizon.confidence),
      confidenceBand: deriveConfidenceBand(horizon.confidence, stepResult.step),
      predictedValue: stepResult.predicted,
      drivers: input.drivers,
    })
  }
  return breaches
}

/**
 * v1 helper for slice-3 callers — projects each macro regressor's LATEST
 * non-null value as a constant for `steps` horizon periods. Use when no
 * better macro forecast is available.
 *
 * Returns `number[][]` where outer[i] is the future-value array for step i+1.
 * If a regressor has no non-null values, its entry will be `NaN` and that
 * step will be skipped by `forecastBreach`.
 */
export function projectMacroFuturesAsConstant(
  regressors: ReadonlyArray<RegressorSeries>,
  steps: number,
): number[][] {
  const latestPerRegressor: number[] = regressors.map((r) => {
    for (let i = r.series.length - 1; i >= 0; i--) {
      const v = r.series[i]
      if (v !== null && Number.isFinite(v)) return v
    }
    return Number.NaN
  })
  const out: number[][] = []
  for (let s = 0; s < steps; s++) out.push([...latestPerRegressor])
  return out
}

export interface BreachScanResult {
  breaches: ForecastedBreach[]
  /** Per-IV stats — count of inputs, count of breaches surfaced, errors. */
  stats: {
    ivsScanned: number
    ivsWithSufficientHistory: number
    breachCount: number
    errors: string[]
  }
}

/** Scan a list of IVs, return aggregated breaches + scan stats. Caller
 *  shapes the input list (typically from `prisma.indicatorValue.findMany`
 *  joined with thresholds + sparklines). */
export function scanForBreaches(
  inputs: BreachForecasterInput[],
  opts: BreachForecasterOptions = {},
): BreachScanResult {
  const breaches: ForecastedBreach[] = []
  const errors: string[] = []
  let ivsWithSufficientHistory = 0

  for (const input of inputs) {
    try {
      const result = forecastBreach(input, opts)
      // Counted as having sufficient history if forecastBreach ran (forecastHorizon returned
      // non-null); even when result is empty (no worsening transition).
      if (forecastHorizon(input.sparkline, 1) !== null) {
        ivsWithSufficientHistory++
      }
      breaches.push(...result)
    } catch (e) {
      errors.push(
        `${input.companyId}/${input.indicatorCode}@${input.period}: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  return {
    breaches,
    stats: {
      ivsScanned: inputs.length,
      ivsWithSufficientHistory,
      breachCount: breaches.length,
      errors,
    },
  }
}
