/**
 * Phase 7.N — Scenario Simulator (live What-if engine)
 *
 * Pure function: takes current IndicatorValues + scenario overrides →
 * returns which indicators change status (the "delta" for HeatMap overlay).
 *
 * Design: post-hoc adjustment on stored values (no formula-engine re-run).
 * Each adjustment specifies indicator codes + a multiplier/delta to apply
 * to the stored `value` field. The adjusted value is reclassified using
 * the seed thresholds → gives honest green/amber/red change.
 *
 * Why not full formula re-run: the resolver graph touches DB tables that
 * can't be cheaply patched in-request (BudgetLine rows, OperationalFacts).
 * Post-hoc is sufficient for investor demo accuracy: if gross margin is 32%
 * and sugar price drops 20%, new margin ≈ 32% × 0.80 = 25.6% → reclassified.
 *
 * The overrides JSON stored in Scenario.overrides must include an
 * `adjustments` array to be simulatable; old-style override blobs
 * (IRAN_HIGH style) return a 422 from the simulate route.
 */

import { classifyValue, type Thresholds, type IndicatorStatus } from './formula-engine'
import { ALL_INDICATOR_SEEDS } from './indicator-seeds'

// ─── Seed index ─────────────────────────────────────────────────────────────

const SEED_BY_CODE = new Map(ALL_INDICATOR_SEEDS.map((s) => [s.code, s]))

// ─── Types ───────────────────────────────────────────────────────────────────

/** One adjustment entry inside `Scenario.overrides.adjustments`. */
export interface ScenarioAdjustment {
  /** Indicator codes this adjustment applies to. */
  codes: string[]
  /**
   * Multiply the stored value by this factor.
   * Use values < 1 to model a decline (e.g. 0.8 = −20%).
   * Use values > 1 to model a rise   (e.g. 1.2 = +20%).
   */
  multiply?: number
  /**
   * Add this absolute amount to the stored value.
   * Applied AFTER multiply (so: newValue = value * multiply + delta).
   */
  delta?: number
  /** Human-readable rationale shown in the delta panel. */
  note?: string
}

/** Shape of `Scenario.overrides` for simulatable scenarios. */
export interface SimulatableOverrides {
  adjustments: ScenarioAdjustment[]
}

/** One row returned by simulateScenario(). */
export interface IndicatorDelta {
  companyId: string
  companyCode: string
  companyName: string
  code: string
  baselineStatus: IndicatorStatus
  scenarioStatus: IndicatorStatus
  baselineValue: number
  scenarioValue: number
  /** true only when baselineStatus !== scenarioStatus */
  changed: boolean
  note?: string
}

/** Full result payload from simulateScenario(). */
export interface SimulationResult {
  scenarioCode: string
  period: string
  /** All indicators that were touched by at least one adjustment. */
  deltas: IndicatorDelta[]
  changed: number
  unchanged: number
  worsened: number
  improved: number
}

// ─── Status ordering (green > amber > red > unknown) ─────────────────────────

const STATUS_ORDER: Record<IndicatorStatus, number> = {
  green: 3,
  amber: 2,
  red: 1,
  unknown: 0,
}

// ─── Core simulation ─────────────────────────────────────────────────────────

/**
 * Run the scenario simulation.
 *
 * @param overrides  Parsed `SimulatableOverrides` from `Scenario.overrides`
 * @param values     Flat array of current IndicatorValue rows (with company info joined)
 * @param scenarioCode  For output labelling
 * @param period        For output labelling
 */
export function simulateScenario(
  overrides: SimulatableOverrides,
  values: Array<{
    companyId: string
    companyCode: string
    companyName: string
    code: string
    value: number
    status: string
  }>,
  scenarioCode: string,
  period: string,
): SimulationResult {
  // Build fast lookup: indicatorCode → ScenarioAdjustment
  const adjByCode = new Map<string, ScenarioAdjustment>()
  for (const adj of overrides.adjustments) {
    for (const code of adj.codes) {
      adjByCode.set(code, adj)
    }
  }

  const deltas: IndicatorDelta[] = []
  let unchanged = 0

  for (const iv of values) {
    const adj = adjByCode.get(iv.code)
    if (!adj) {
      unchanged++
      continue
    }

    const seed = SEED_BY_CODE.get(iv.code)
    if (!seed) {
      // Unknown indicator — skip rather than crash
      unchanged++
      continue
    }

    // Apply adjustments
    let scenarioValue = iv.value
    if (adj.multiply !== undefined) scenarioValue = scenarioValue * adj.multiply
    if (adj.delta !== undefined) scenarioValue = scenarioValue + adj.delta

    const baselineStatus = iv.status as IndicatorStatus
    const scenarioStatus = classifyValue(scenarioValue, seed.thresholds as Thresholds)
    // A status flip only counts when BOTH ends are real bands. An "unknown"
    // baseline (a no-data indicator persisted with value:0, status:"unknown")
    // ranks 0 in STATUS_ORDER, so without this guard every unknown→real
    // transition scores as an "improvement" — e.g. a crisis (multiply/delta)
    // applied to a no-data indicator is reported as a gain, inflating
    // `improved` and corrupting the worsened/improved summary shown to the
    // client. Mirrors the driver-path guard in scenario-rederive.ts. The same
    // flag also gates buildDeltaMap (HeatMap overlay), so an unknown row no
    // longer paints a fake status change on the grid.
    const bothReal = baselineStatus !== "unknown" && scenarioStatus !== "unknown"
    const changed = bothReal && scenarioStatus !== baselineStatus

    deltas.push({
      companyId: iv.companyId,
      companyCode: iv.companyCode,
      companyName: iv.companyName,
      code: iv.code,
      baselineStatus,
      scenarioStatus,
      baselineValue: iv.value,
      scenarioValue,
      changed,
      note: adj.note,
    })
  }

  const changedDeltas = deltas.filter((d) => d.changed)
  const worsened = changedDeltas.filter(
    (d) => STATUS_ORDER[d.scenarioStatus] < STATUS_ORDER[d.baselineStatus],
  )
  const improved = changedDeltas.filter(
    (d) => STATUS_ORDER[d.scenarioStatus] > STATUS_ORDER[d.baselineStatus],
  )

  return {
    scenarioCode,
    period,
    deltas,
    changed: changedDeltas.length,
    unchanged,
    worsened: worsened.length,
    improved: improved.length,
  }
}

/**
 * Build a fast-lookup map keyed by `${companyId}:${code}` for HeatMap overlay.
 * Only includes rows where status changed.
 */
export function buildDeltaMap(result: SimulationResult): Map<string, IndicatorStatus> {
  const map = new Map<string, IndicatorStatus>()
  for (const d of result.deltas) {
    if (d.changed) {
      map.set(`${d.companyId}:${d.code}`, d.scenarioStatus)
    }
  }
  return map
}
