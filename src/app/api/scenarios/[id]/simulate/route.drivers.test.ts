import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(async () => ({ orgId: 'org1', userId: 'u1' })),
  isAuthError: () => false,
}))
const findFirst = vi.fn()
const companyFindMany = vi.fn()
const indicatorFindMany = vi.fn()
const ivFindMany = vi.fn()
const fxFindMany = vi.fn()
const intelFindMany = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    scenario: { findFirst: (...a: unknown[]) => findFirst(...a) },
    company: { findMany: (...a: unknown[]) => companyFindMany(...a) },
    indicatorDefinition: { findMany: (...a: unknown[]) => indicatorFindMany(...a) },
    indicatorValue: { findMany: (...a: unknown[]) => ivFindMany(...a) },
    currencyRateHistory: { findMany: (...a: unknown[]) => fxFindMany(...a) },
    intelDataPoint: { findMany: (...a: unknown[]) => intelFindMany(...a) },
  },
}))
vi.mock('@/lib/risk/recompute', () => ({ createPrismaDataSource: () => ({}) }))
const simulateByDrivers = vi.fn()
vi.mock('@/lib/risk/scenario-rederive', () => ({ simulateByDrivers: (...a: unknown[]) => simulateByDrivers(...a) }))
const runCrisisBrief = vi.fn()
vi.mock('@/lib/risk/scenario-narrative', () => ({ runCrisisBrief: (...a: unknown[]) => runCrisisBrief(...a) }))
vi.mock('@/lib/ai/client', () => ({ hasAnthropicKey: () => true }))

import { GET } from './route'

const req = (url: string) => new Request(url) as never

describe('GET simulate ?mode=drivers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fxFindMany.mockResolvedValue([])
    intelFindMany.mockResolvedValue([])
  })

  it('derives revenue from inputs.resolved.revenue + runs sim + narrative', async () => {
    findFirst.mockResolvedValue({ id: 's1', code: 'INPUT_COST_30', nameEn: 'Input +30%', nameRu: 'Стоимость +30%', overrides: { shock: { inputCostShock: 0.3 } } })
    companyFindMany.mockResolvedValue([
      { id: 'c1', code: 'CPC', name: 'CPC', parentCompanyId: 'p1', industry: 'food_processing' },
      { id: 'p1', code: 'AZSEKER', name: 'Holding', parentCompanyId: null, industry: null },
    ])
    indicatorFindMany.mockResolvedValue([{ id: 'i1', code: 'IND_EBITDA_MARGIN', formula: 'ebitda/revenue*100', thresholds: {}, requiredInputs: ['budgetLine'], weight: 1.5 }])
    ivFindMany.mockResolvedValue([{ companyId: 'c1', indicatorId: 'i1', value: 4.5, status: 'red', inputs: { resolved: { revenue: 6475882 } } }])
    simulateByDrivers.mockResolvedValue({
      scenarioCode: 'INPUT_COST_30', period: '2026',
      deltas: [{ companyId: 'c1', companyCode: 'CPC', companyName: 'CPC', indicatorId: 'i1', code: 'IND_EBITDA_MARGIN', baselineValue: 4.5, baselineStatus: 'red', scenarioValue: -7, scenarioStatus: 'red', changed: false, deltaPct: -255 }],
      // CPC is a leaf; HOLDING is a parent with a BIGGER drop (60→20) that must
      // be EXCLUDED from worst-hit (it's a rollup of the same children). The
      // worstHit length/content assertions below therefore prove the leaf filter.
      byCompany: [
        { companyId: 'c1', companyCode: 'CPC', baselineScore: 49, scenarioScore: 28, isLeaf: true },
        { companyId: 'h1', companyCode: 'HOLDING', baselineScore: 60, scenarioScore: 20, isLeaf: false },
      ],
      holdingBaselineScore: 45, holdingScenarioScore: 31, changed: 1, worsened: 1, improved: 0,
      driftSummary: { pairsAttempted: 1, pairsErrored: 0, lastError: null },
    })
    runCrisisBrief.mockResolvedValue({ narrative: '⚠ 45→31', mitigations: ['hedge'], confidence: 0.7, modelName: 'sonnet', promptVersion: 'v1' })

    const res = await GET(req('http://x/api/scenarios/s1/simulate?mode=drivers&period=2026'), { params: Promise.resolve({ id: 's1' }) } as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.holdingScenarioScore).toBe(31)
    expect(body.narrative).toContain('45→31')
    const passedCompanies = (simulateByDrivers.mock.calls[0][1] as { companies: Array<{ id: string; revenue: number | null }> }).companies
    expect(passedCompanies.find((c) => c.id === 'c1')!.revenue).toBe(6475882)
  })

  it('graceful degrade: AI throws → 200 with narrative=null + narrativeError', async () => {
    findFirst.mockResolvedValue({ id: 's1', code: 'INPUT_COST_30', nameEn: 'x', overrides: { shock: { inputCostShock: 0.3 } } })
    companyFindMany.mockResolvedValue([{ id: 'c1', code: 'CPC', name: 'CPC', parentCompanyId: null, industry: null }])
    indicatorFindMany.mockResolvedValue([{ id: 'i1', code: 'X', formula: 'x', thresholds: {}, requiredInputs: [], weight: 1 }])
    ivFindMany.mockResolvedValue([{ companyId: 'c1', indicatorId: 'i1', value: 1, status: 'green', inputs: { resolved: { revenue: 1 } } }])
    simulateByDrivers.mockResolvedValue({ scenarioCode: 'X', period: '2026', deltas: [], byCompany: [], holdingBaselineScore: 45, holdingScenarioScore: 31, changed: 0, worsened: 0, improved: 0, driftSummary: { pairsAttempted: 1, pairsErrored: 0, lastError: null } })
    runCrisisBrief.mockRejectedValue(new Error('LLM down'))

    const res = await GET(req('http://x/api/scenarios/s1/simulate?mode=drivers'), { params: Promise.resolve({ id: 's1' }) } as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.holdingScenarioScore).toBe(31)
    expect(body.narrative).toBeNull()
    expect(body.narrativeError).toBeTruthy()
  })

  it('?narrative=0 skips the AI call (fast cascade) + still returns worstHit', async () => {
    findFirst.mockResolvedValue({ id: 's1', code: 'INPUT_COST_30', nameEn: 'x', overrides: { shock: { inputCostShock: 0.3 } } })
    companyFindMany.mockResolvedValue([{ id: 'c1', code: 'CPC', name: 'CPC', parentCompanyId: null, industry: 'food_processing' }])
    indicatorFindMany.mockResolvedValue([{ id: 'i1', code: 'IND_EBITDA_MARGIN', formula: 'x', thresholds: {}, requiredInputs: [], weight: 1 }])
    ivFindMany.mockResolvedValue([{ companyId: 'c1', indicatorId: 'i1', value: 4.5, status: 'red', inputs: { resolved: { revenue: 1 } } }])
    simulateByDrivers.mockResolvedValue({
      scenarioCode: 'INPUT_COST_30', period: '2026',
      deltas: [{ companyId: 'c1', companyCode: 'CPC', companyName: 'CPC', indicatorId: 'i1', code: 'IND_EBITDA_MARGIN', baselineValue: 4.5, baselineStatus: 'amber', scenarioValue: -7, scenarioStatus: 'red', changed: true, deltaPct: -255 }],
      byCompany: [{ companyId: 'c1', companyCode: 'CPC', baselineScore: 64, scenarioScore: 40 }],
      holdingBaselineScore: 61, holdingScenarioScore: 55, financialHoldingBaselineScore: 62, financialHoldingScenarioScore: 50, changed: 1, worsened: 1, improved: 0, driftSummary: { pairsAttempted: 1, pairsErrored: 0, lastError: null },
    })
    const res = await GET(req('http://x/api/scenarios/s1/simulate?mode=drivers&narrative=0'), { params: Promise.resolve({ id: 's1' }) } as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(runCrisisBrief).not.toHaveBeenCalled()
    expect(body.narrative).toBeNull()
    expect(body.worstHit).toHaveLength(1)
    expect(body.worstHit[0]).toMatchObject({ companyCode: 'CPC', baselineScore: 64, scenarioScore: 40 })
  })

  it('422 when ?mode=drivers but scenario has no shock', async () => {
    findFirst.mockResolvedValue({ id: 's1', code: 'X', nameEn: 'x', overrides: { adjustments: [] } })
    const res = await GET(req('http://x/api/scenarios/s1/simulate?mode=drivers'), { params: Promise.resolve({ id: 's1' }) } as never)
    expect(res.status).toBe(422)
  })

  it('Phase 2: an absolute target resolves to a fraction from the live feed + returns anchors', async () => {
    findFirst.mockResolvedValue({ id: 's1', code: 'AZN_DEVAL_20', nameEn: 'AZN -20%', overrides: { shock: { target: { metric: 'AZN_USD', value: 2.04, drives: 'fxShock' } } } })
    fxFindMany.mockResolvedValue([{ currencyCode: 'USD', rate: 1.7, rateDate: new Date('2026-05-28') }])
    companyFindMany.mockResolvedValue([{ id: 'c1', code: 'CPC', name: 'CPC', parentCompanyId: null, industry: 'food_processing' }])
    indicatorFindMany.mockResolvedValue([{ id: 'i1', code: 'FX_IMPORTED_INPUT', formula: 'imported_input_cost/total_input_cost*100', thresholds: {}, requiredInputs: [], weight: 1 }])
    ivFindMany.mockResolvedValue([{ companyId: 'c1', indicatorId: 'i1', value: 0, status: 'green', inputs: { resolved: { revenue: 6475882 } } }])
    simulateByDrivers.mockResolvedValue({ scenarioCode: 'AZN_DEVAL_20', period: '2026', deltas: [], byCompany: [], holdingBaselineScore: 61, holdingScenarioScore: 58, financialHoldingBaselineScore: 62, financialHoldingScenarioScore: 55, changed: 0, worsened: 0, improved: 0, driftSummary: { pairsAttempted: 1, pairsErrored: 0, lastError: null } })
    runCrisisBrief.mockResolvedValue({ narrative: '⚠', mitigations: [], confidence: 0.6, modelName: 's', promptVersion: 'v1' })

    const res = await GET(req('http://x/api/scenarios/s1/simulate?mode=drivers&period=2026'), { params: Promise.resolve({ id: 's1' }) } as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    // engine received the DERIVED fraction (2.04/1.70−1 = 0.20), not a target
    const passedOverrides = (simulateByDrivers.mock.calls[0][1] as { scenario: { overrides: { shock: { fxShock?: number } } } }).scenario.overrides.shock
    expect(passedOverrides.fxShock).toBeCloseTo(0.2, 5)
    // anchors returned for the panel
    expect(body.feedAnchors).toHaveLength(1)
    expect(body.feedAnchors[0]).toMatchObject({ label: 'AZN/USD', currentValue: 1.7, scenarioValue: 2.04 })
  })
})
