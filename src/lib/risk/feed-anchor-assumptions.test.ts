import { describe, it, expect } from 'vitest'
import {
  applyAssumptionAnchors,
  resolveFeedShock,
  resolveFeedContext,
  FEED_ANCHOR_ASSUMPTIONS,
  type FeedSnapshot,
} from './scenario-feed-context'
import { hasShock } from './scenario-shock'

/**
 * Phase 16.8 — a stated planning rate can anchor a target scenario when the
 * live feed is silent.
 *
 * This is NOT a new lever. `resolveFeedShock` already needs a current level to
 * turn "AZN/USD → 2.04" into a fraction; without one it drops the target,
 * `hasShock` then sees nothing to simulate, and the flagship AZN_DEVAL_20
 * answers 422. Supplying the missing input is different in kind from inventing
 * a model, which is why this key is here and `tax_rate` is not.
 */

const AS_OF = '2026-08-06'
const TARGET_SHOCK = {
  target: { metric: 'AZN_USD', value: 2.04, drives: 'fxShock' as const },
}

describe('applyAssumptionAnchors', () => {
  it('fills a metric the live feed is missing', () => {
    const out = applyAssumptionAnchors({}, (k) => (k === 'fx_usd' ? 1.7 : null), AS_OF)
    expect(out.AZN_USD).toEqual({ value: 1.7, asOf: AS_OF, stale: false, source: 'assumption' })
  })

  it('never overwrites a live observation', () => {
    const live: FeedSnapshot = { AZN_USD: { value: 1.7, asOf: '2026-08-01', stale: false } }
    const out = applyAssumptionAnchors(live, () => 9.99, AS_OF)
    expect(out.AZN_USD.value).toBe(1.7)
    expect(out.AZN_USD.source).toBeUndefined()
  })

  it('does not overwrite even a STALE live observation', () => {
    // A real quote from six weeks ago is still a market fact, and `stale`
    // already says so. A planning rate is a decision. Swapping one for the
    // other by recency would quietly change what the number means.
    const stale: FeedSnapshot = { AZN_USD: { value: 1.7, asOf: '2026-06-01', stale: true } }
    const out = applyAssumptionAnchors(stale, () => 2.5, AS_OF)
    expect(out.AZN_USD.value).toBe(1.7)
    expect(out.AZN_USD.stale).toBe(true)
  })

  it('ignores a missing, non-finite or non-positive assumption', () => {
    for (const bad of [null, Number.NaN, 0, -1.7]) {
      const out = applyAssumptionAnchors({}, () => bad as number | null, AS_OF)
      expect(out.AZN_USD).toBeUndefined()
    }
  })

  it('does not mutate the snapshot it was given', () => {
    const original: FeedSnapshot = {}
    applyAssumptionAnchors(original, () => 1.7, AS_OF)
    expect(original.AZN_USD).toBeUndefined()
  })

  it('covers every registered anchor key', () => {
    const out = applyAssumptionAnchors({}, () => 1.7, AS_OF)
    for (const { metric } of FEED_ANCHOR_ASSUMPTIONS) {
      expect(out[metric]?.source).toBe('assumption')
    }
  })

  it('registers only rate anchors — never a scenario lever', () => {
    // `tax_rate` and friends have no lever and must not sneak in here either:
    // an anchor supplies a baseline for an existing computation, it does not
    // create one.
    const keys = FEED_ANCHOR_ASSUMPTIONS.map((a) => a.assumptionKey)
    for (const k of ['tax_rate', 'inflation', 'import_share', 'cost_rigidity']) {
      expect(keys).not.toContain(k)
    }
  })
})

describe('the scenario it rescues', () => {
  it('without an anchor, a target-only FX scenario has nothing to simulate', () => {
    const resolved = resolveFeedShock(TARGET_SHOCK, {})
    expect(hasShock({ shock: resolved })).toBe(false)
  })

  it('with a stated planning rate, the same scenario resolves its fraction', () => {
    const anchored = applyAssumptionAnchors({}, (k) => (k === 'fx_usd' ? 1.7 : null), AS_OF)
    const resolved = resolveFeedShock(TARGET_SHOCK, anchored)
    expect(hasShock({ shock: resolved })).toBe(true)
    expect(resolved.fxShock).toBeCloseTo(2.04 / 1.7 - 1, 6)
  })

  it('the anchor a planning rate produces is marked as one, not as a quote', () => {
    const anchored = applyAssumptionAnchors({}, () => 1.7, AS_OF)
    const [anchor] = resolveFeedContext(TARGET_SHOCK, anchored)
    expect(anchor.source).toBe('assumption')
    expect(anchor.currentValue).toBe(1.7)
  })

  it('a live-feed anchor still reports as a feed', () => {
    const live: FeedSnapshot = { AZN_USD: { value: 1.7, asOf: '2026-08-01', stale: false } }
    const [anchor] = resolveFeedContext(TARGET_SHOCK, live)
    expect(anchor.source).toBe('feed')
  })

  it('a planning rate and a market rate give materially different fractions', () => {
    // The reason the distinction has to survive to the UI: the two anchors do
    // not merely differ in provenance, they produce different numbers.
    const market = resolveFeedShock(TARGET_SHOCK, {
      AZN_USD: { value: 1.7, asOf: AS_OF, stale: false },
    })
    const planned = resolveFeedShock(
      TARGET_SHOCK,
      applyAssumptionAnchors({}, () => 1.9, AS_OF),
    )
    expect(market.fxShock).toBeCloseTo(0.2, 2)
    expect(planned.fxShock).toBeCloseTo(0.0737, 3)
  })
})
