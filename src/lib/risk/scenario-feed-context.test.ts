import { describe, it, expect } from 'vitest'
import { resolveFeedShock, resolveFeedContext, type FeedSnapshot } from './scenario-feed-context'
import type { ScenarioShock } from './scenario-shock'

const SNAPSHOT: FeedSnapshot = {
  AZN_USD: { value: 1.7, asOf: '2026-05-28', stale: false },
  FAO_SUGAR_INDEX: { value: 88.5, asOf: '2026-03-31', stale: true },
  BRENT_USD_BBL: { value: 110.53, asOf: '2026-05-14', stale: false },
}

describe('resolveFeedShock', () => {
  it('FX target → fxShock derived from the live level (2.04/1.70−1 = 0.20)', () => {
    const shock: ScenarioShock = { target: { metric: 'AZN_USD', value: 2.04, drives: 'fxShock' } }
    const r = resolveFeedShock(shock, SNAPSHOT)
    expect(r.fxShock).toBeCloseTo(0.2, 5)
  })
  it('sugar target → priceShock (70/88.5−1 ≈ −0.209)', () => {
    const r = resolveFeedShock({ target: { metric: 'FAO_SUGAR_INDEX', value: 70, drives: 'priceShock' } }, SNAPSHOT)
    expect(r.priceShock).toBeCloseTo(70 / 88.5 - 1, 5)
  })
  it('missing metric → drops the target, falls back to any plain fraction', () => {
    const r = resolveFeedShock({ fxShock: 0.1, target: { metric: 'NOT_THERE', value: 9, drives: 'fxShock' } }, SNAPSHOT)
    expect(r.fxShock).toBe(0.1)
    expect(r.target).toBeUndefined()
  })
  it('zero/negative current level → skip the target (no divide-by-zero)', () => {
    const snap: FeedSnapshot = { AZN_USD: { value: 0, asOf: '2026-05-28', stale: false } }
    const r = resolveFeedShock({ target: { metric: 'AZN_USD', value: 2.04, drives: 'fxShock' } }, snap)
    expect(r.fxShock).toBeUndefined()
    expect(r.target).toBeUndefined()
  })
  it('no target → returned unchanged', () => {
    const shock: ScenarioShock = { inputCostShock: 0.3 }
    expect(resolveFeedShock(shock, SNAPSHOT)).toEqual(shock)
  })
})

describe('resolveFeedContext', () => {
  it('returns a from→to anchor with label/unit/freshness', () => {
    const anchors = resolveFeedContext({ target: { metric: 'AZN_USD', value: 2.04, drives: 'fxShock' } }, SNAPSHOT)
    expect(anchors).toHaveLength(1)
    expect(anchors[0]).toMatchObject({
      label: 'AZN/USD',
      currentValue: 1.7,
      scenarioValue: 2.04,
      asOf: '2026-05-28',
      stale: false,
    })
  })
  it('carries the stale flag (FAO sugar is 2 months old)', () => {
    const anchors = resolveFeedContext({ target: { metric: 'FAO_SUGAR_INDEX', value: 70, drives: 'priceShock' } }, SNAPSHOT)
    expect(anchors[0].stale).toBe(true)
  })
  it('no target → no anchors', () => {
    expect(resolveFeedContext({ inputCostShock: 0.3 }, SNAPSHOT)).toEqual([])
  })
  it('missing metric → no anchors', () => {
    expect(resolveFeedContext({ target: { metric: 'NOPE', value: 1, drives: 'fxShock' } }, SNAPSHOT)).toEqual([])
  })
})
