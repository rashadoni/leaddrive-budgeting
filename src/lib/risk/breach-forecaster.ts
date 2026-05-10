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

/** Forecast breaches for a single IV. Returns 0..N rows (one per worsening
 *  transition step in the horizon). */
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
      // Per-step CI deferred to E.2c (multi-variate refit); step=1 has the
      // shared CI from the linear fit but propagating it requires another
      // pass. v1 ships without; v1.1 follow-up.
      drivers: input.drivers,
    })
  }
  return breaches
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
