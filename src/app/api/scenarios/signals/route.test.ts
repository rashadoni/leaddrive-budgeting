import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(async () => ({ orgId: 'org1', userId: 'u1' })),
  isAuthError: () => false,
}))
const fxFindMany = vi.fn()
const intelFindMany = vi.fn()
const newsFindMany = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    currencyRateHistory: { findMany: (...a: unknown[]) => fxFindMany(...a) },
    intelDataPoint: { findMany: (...a: unknown[]) => intelFindMany(...a) },
    intelItem: { findMany: (...a: unknown[]) => newsFindMany(...a) },
  },
}))

import { GET } from './route'

const req = () => new Request('http://x/api/scenarios/signals') as never

describe('GET /api/scenarios/signals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    newsFindMany.mockResolvedValue([])
  })

  it('reads the feed → returns the firing signals (rainfall MIN across regions)', async () => {
    fxFindMany.mockResolvedValue([{ currencyCode: 'USD', rate: 1.7, rateDate: new Date('2026-05-28') }])
    intelFindMany.mockResolvedValue([
      { metric: 'BRENT_USD_BBL', value: 110.53, datetime: new Date('2026-05-14') },
      { metric: 'FAO_SUGAR_INDEX', value: 88.5, datetime: new Date('2026-03-31') },
      { metric: 'BEYLAQAN_RAINFALL_MM_14D_FCST', value: 11.5, datetime: new Date('2026-05-28') },
      { metric: 'FUZULI_RAINFALL_MM_14D_FCST', value: 25.1, datetime: new Date('2026-05-28') },
    ])
    const res = await GET(req())
    const body = await res.json()
    expect(res.status).toBe(200)
    const ids = body.signals.map((s: { id: string }) => s.id).sort()
    expect(ids).toEqual(['drought', 'oil-elevated', 'sugar-pressure'])
    // drought used the MIN rainfall (11.5), not the other region
    const drought = body.signals.find((s: { id: string }) => s.id === 'drought')
    expect(drought.detail).toContain('11.5')
  })

  it('empty feed → no signals', async () => {
    fxFindMany.mockResolvedValue([])
    intelFindMany.mockResolvedValue([])
    const res = await GET(req())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.signals).toEqual([])
  })

  it('merges news-derived signals (Phase 3b) — negative agro-weather headline → DROUGHT', async () => {
    fxFindMany.mockResolvedValue([])
    intelFindMany.mockResolvedValue([])
    newsFindMany.mockResolvedValue([
      {
        title: 'Adverse weather causes AZN 13M damage to Azerbaijan agriculture',
        sourceLabel: 'Report.az',
        sentimentScore: -0.6,
        industryTags: ['agro_crops', 'food_processing'],
        companyTags: ['AZSEKER-FARM'],
        publishedAt: new Date('2026-05-06'),
      },
    ])
    const res = await GET(req())
    const body = await res.json()
    expect(res.status).toBe(200)
    const news = body.signals.find((s: { kind: string }) => s.kind === 'news')
    expect(news.suggestedScenarioCode).toBe('DROUGHT_2026')
    expect(news.label).toContain('Adverse weather')
  })
})
