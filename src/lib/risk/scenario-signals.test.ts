import { describe, it, expect } from 'vitest'
import { detectSignals, detectNewsSignals, type NewsItem } from './scenario-signals'
import type { FeedSnapshot } from './scenario-feed-context'

const fresh = (value: number) => ({ value, asOf: '2026-05-28', stale: false })

// Snapshot mirroring the current live feed (all 3 rules fire).
const LIVE: FeedSnapshot = {
  BRENT_USD_BBL: fresh(110.53),
  FAO_SUGAR_INDEX: { value: 88.5, asOf: '2026-03-31', stale: true },
  RAINFALL_14D_MIN: fresh(11.5),
}

describe('detectSignals', () => {
  it('fires all 3 signals on the live feed, each mapped to its scenario', () => {
    const sigs = detectSignals(LIVE)
    const byId = Object.fromEntries(sigs.map((s) => [s.id, s]))
    expect(byId['oil-elevated'].suggestedScenarioCode).toBe('BRENT_TO_140')
    expect(byId['drought'].suggestedScenarioCode).toBe('DROUGHT_2026')
    expect(byId['sugar-pressure'].suggestedScenarioCode).toBe('SUGAR_PRICE_TO_70')
    expect(sigs).toHaveLength(3)
  })

  it('carries freshness (FAO sugar stale flag propagates)', () => {
    const sugar = detectSignals(LIVE).find((s) => s.id === 'sugar-pressure')!
    expect(sugar.stale).toBe(true)
    expect(sugar.asOf).toBe('2026-03-31')
  })

  it('oil rule does NOT fire below $95', () => {
    expect(detectSignals({ BRENT_USD_BBL: fresh(80) }).some((s) => s.id === 'oil-elevated')).toBe(false)
  })

  it('drought rule does NOT fire when rainfall ≥ 15mm', () => {
    expect(detectSignals({ RAINFALL_14D_MIN: fresh(30) }).some((s) => s.id === 'drought')).toBe(false)
  })

  it('sugar rule does NOT fire at/above 90', () => {
    expect(detectSignals({ FAO_SUGAR_INDEX: fresh(95) }).some((s) => s.id === 'sugar-pressure')).toBe(false)
  })

  it('missing inputs → no signals (empty feed)', () => {
    expect(detectSignals({})).toEqual([])
  })

  it('market signals are tagged kind:market', () => {
    expect(detectSignals(LIVE).every((s) => s.kind === 'market')).toBe(true)
  })
})

const news = (over: Partial<NewsItem>): NewsItem => ({
  title: '', sourceLabel: 'X', sentimentScore: -0.6, industryTags: [], companyTags: [], publishedAt: '2026-05-06', ...over,
})

describe('detectNewsSignals', () => {
  it('negative weather/agro news → DROUGHT_2026 (the real Report.az item)', () => {
    const sigs = detectNewsSignals([
      news({ title: 'Adverse weather causes AZN 13M damage to Azerbaijan agriculture', sentimentScore: -0.6, industryTags: ['agro_crops', 'food_processing'], sourceLabel: 'Report.az', publishedAt: '2026-05-06' }),
    ])
    expect(sigs).toHaveLength(1)
    expect(sigs[0]).toMatchObject({ kind: 'news', suggestedScenarioCode: 'DROUGHT_2026', severity: 'high' })
    expect(sigs[0].label).toContain('Adverse weather')
    expect(sigs[0].asOf).toBe('2026-05-06')
  })
  it('negative FX/manat news → AZN_DEVAL_15', () => {
    const sigs = detectNewsSignals([news({ title: 'Manat expected to weaken / девальвация маната', sentimentScore: -0.5 })])
    expect(sigs[0]?.suggestedScenarioCode).toBe('AZN_DEVAL_15')
  })
  it('does NOT fire on positive/neutral sentiment', () => {
    expect(detectNewsSignals([news({ title: 'Adverse weather damage agriculture', sentimentScore: 0.4, industryTags: ['agro_crops'] })])).toEqual([])
  })
  it('does NOT fire on negative news with no keyword/tag match', () => {
    expect(detectNewsSignals([news({ title: 'Generic bad corporate governance story', sentimentScore: -0.7 })])).toEqual([])
  })
  it('dedupes to one signal per scenario (keeps the most negative)', () => {
    const sigs = detectNewsSignals([
      news({ title: 'weather damage agriculture mild', sentimentScore: -0.4, industryTags: ['agro_crops'] }),
      news({ title: 'severe drought destroys harvest', sentimentScore: -0.8, industryTags: ['agro_crops'] }),
    ])
    expect(sigs).toHaveLength(1)
    expect(sigs[0].label).toContain('severe drought')
  })
  it('empty input → no signals', () => {
    expect(detectNewsSignals([])).toEqual([])
  })
})
