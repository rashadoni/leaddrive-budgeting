import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(async () => ({ orgId: 'org1', userId: 'u1' })),
  isAuthError: () => false,
}))
const fxFindMany = vi.fn()
const intelFindMany = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    currencyRateHistory: { findMany: (...a: unknown[]) => fxFindMany(...a) },
    intelDataPoint: { findMany: (...a: unknown[]) => intelFindMany(...a) },
  },
}))

import { GET } from './route'

const req = () => new Request('http://x/api/scenarios/signals') as never

describe('GET /api/scenarios/signals', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads the feed → returns the firing signals (rainfall MIN across regions)', async () => {
    fxFindMany.mockResolvedValue([{ currencyCode: 'USD', rate: 1.7, rateDate: new Date('2026-05-28') }])
    intelFindMany.mockResolvedValue([
      { metric: 'FX_FORWARD_USD_AZN_12M', value: 1.7527, datetime: new Date('2026-05-24') },
      { metric: 'BRENT_USD_BBL', value: 110.53, datetime: new Date('2026-05-14') },
      { metric: 'FAO_SUGAR_INDEX', value: 88.5, datetime: new Date('2026-03-31') },
      { metric: 'BEYLAQAN_RAINFALL_MM_14D_FCST', value: 11.5, datetime: new Date('2026-05-28') },
      { metric: 'FUZULI_RAINFALL_MM_14D_FCST', value: 25.1, datetime: new Date('2026-05-28') },
    ])
    const res = await GET(req())
    const body = await res.json()
    expect(res.status).toBe(200)
    const ids = body.signals.map((s: { id: string }) => s.id).sort()
    expect(ids).toEqual(['drought', 'fx-depreciation', 'oil-elevated', 'sugar-pressure'])
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
})
