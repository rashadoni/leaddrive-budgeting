/**
 * Phase 2 — live-feed anchoring for scenario shocks.
 *
 * A scenario may carry an absolute `target` (e.g. AZN/USD → 2.04). This module
 * resolves that target against the CURRENT live-feed level into the concrete
 * B2 fraction the engine consumes (`frac = value / current − 1`), and produces
 * the "current → scenario" display anchors (with freshness) for the panel +
 * narrative.
 *
 * Pure module — no DB, no Date.now(). The caller (route) builds the
 * `FeedSnapshot` (incl. staleness, stamped against its own clock) and passes it
 * in. The engine signature is unchanged: it always sees a resolved fraction.
 */
import type { ScenarioShock } from './scenario-shock'

export interface FeedDatum {
  value: number
  /** ISO date (YYYY-MM-DD) of the observation. */
  asOf: string
  /** Pre-computed by the caller (now − asOf > STALE_DAYS). */
  stale: boolean
}

export type FeedSnapshot = Record<string, FeedDatum>

export interface FeedAnchor {
  /** Display label, e.g. "AZN/USD". */
  label: string
  metric: string
  currentValue: number
  scenarioValue: number
  unit: string
  asOf: string
  stale: boolean
}

/** Days after which a feed observation is flagged stale (caller applies it). */
export const FEED_STALE_DAYS = 45

/** Display metadata per supported feed metric. */
const METRIC_META: Record<string, { label: string; unit: string }> = {
  AZN_USD: { label: 'AZN/USD', unit: 'AZN/USD' },
  AZN_EUR: { label: 'AZN/EUR', unit: 'AZN/EUR' },
  BRENT_USD_BBL: { label: 'Brent', unit: 'USD/bbl' },
  FAO_SUGAR_INDEX: { label: 'Сахар (FAO)', unit: 'index' },
  FAO_CEREAL_INDEX: { label: 'Зерно (FAO)', unit: 'index' },
}

/**
 * Resolve a shock's absolute `target` into its `drives` fraction using the live
 * feed. Returns a NEW shock with the derived fraction set and `target` removed.
 * If the metric is missing / current level ≤ 0, the target is dropped and any
 * plain fraction already on the shock is preserved (graceful fallback).
 */
export function resolveFeedShock(shock: ScenarioShock, snapshot: FeedSnapshot): ScenarioShock {
  if (!shock.target) return shock
  const { metric, value, drives } = shock.target
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { target: _dropped, ...rest } = shock
  const cur = snapshot[metric]?.value
  if (typeof cur !== 'number' || !Number.isFinite(cur) || cur <= 0 || !Number.isFinite(value)) {
    return rest // skip target; fall back to whatever plain fraction exists
  }
  const frac = value / cur - 1
  return { ...rest, [drives]: frac }
}

/**
 * Build the "current → scenario" display anchors for a shock's target. Empty
 * when there's no target or the metric is absent/unsupported.
 */
export function resolveFeedContext(shock: ScenarioShock, snapshot: FeedSnapshot): FeedAnchor[] {
  if (!shock.target) return []
  const { metric, value } = shock.target
  const datum = snapshot[metric]
  const meta = METRIC_META[metric]
  if (!datum || !meta || typeof datum.value !== 'number' || !Number.isFinite(datum.value) || datum.value <= 0) {
    return []
  }
  return [
    {
      label: meta.label,
      metric,
      currentValue: datum.value,
      scenarioValue: value,
      unit: meta.unit,
      asOf: datum.asOf,
      stale: datum.stale,
    },
  ]
}
