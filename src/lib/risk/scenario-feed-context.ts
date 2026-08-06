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
  /**
   * Phase 16.8 (2026-08-06) — where this level came from.
   *
   * `feed` (the default) is a market observation. `assumption` is the holding's
   * own PLANNING rate, taken from a `fx_*` budget assumption because the live
   * feed had nothing for this metric.
   *
   * The distinction is load-bearing and must never be dropped on the way to the
   * UI. A target scenario anchors on `frac = value / current − 1`, so anchoring
   * on a planning rate produces a DIFFERENT fraction than anchoring on the
   * market — and a reader shown "AZN/USD 1.70 → 2.04" has every reason to
   * assume the 1.70 is today's quote unless told otherwise.
   */
  source?: 'feed' | 'assumption'
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
  /** Phase 16.8 — `assumption` means the baseline is a planning rate, not a market quote. */
  source: 'feed' | 'assumption'
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
      source: datum.source ?? 'feed',
    },
  ]
}

/**
 * Phase 16.8 — budget-assumption keys that can stand in for a missing feed level.
 *
 * These are NOT scenario levers and are deliberately absent from
 * `COMPANY_DRIVERS`: nothing in `ScenarioShock` reads an exchange rate. What
 * they supply is the BASELINE a target anchors against, which is an input the
 * computation already has — `resolveFeedShock` needs a current level and simply
 * has none when the CBAR feed is silent.
 *
 * The consequence of having none is not a degraded number, it is no scenario at
 * all: `resolveFeedShock` drops the target, `hasShock` then sees nothing to
 * simulate, and `AZN_DEVAL_20` — a flagship — answers 422. A holding that has
 * written down the rate it plans at should not be told its devaluation scenario
 * cannot run.
 *
 * Plan-level only (`companyId = null`): a target resolves to ONE fraction for
 * the whole holding, so a per-company exchange rate would have nowhere to go.
 */
export const FEED_ANCHOR_ASSUMPTIONS: ReadonlyArray<{ assumptionKey: string; metric: string }> = [
  { assumptionKey: 'fx_usd', metric: 'AZN_USD' },
  { assumptionKey: 'fx_eur', metric: 'AZN_EUR' },
]

/**
 * Fill gaps in a feed snapshot from the holding's stated planning rates.
 *
 * Only fills what is MISSING. A live observation always wins, including a stale
 * one: a real quote from six weeks ago is still a market fact, and the snapshot
 * already carries `stale` to say so, whereas a planning rate is a decision. The
 * two should not be silently swapped by recency.
 */
export function applyAssumptionAnchors(
  snapshot: FeedSnapshot,
  resolve: (assumptionKey: string) => number | null,
  /** Stamped by the caller — this module takes no clock. */
  asOf: string,
): FeedSnapshot {
  const out: FeedSnapshot = { ...snapshot }
  for (const { assumptionKey, metric } of FEED_ANCHOR_ASSUMPTIONS) {
    if (out[metric]) continue
    const value = resolve(assumptionKey)
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue
    out[metric] = { value, asOf, stale: false, source: 'assumption' }
  }
  return out
}
