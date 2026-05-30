import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(async () => ({ orgId: 'org1', userId: 'u1' })),
  isAuthError: () => false,
}))
const findFirst = vi.fn()
const companyFindMany = vi.fn()
const indicatorFindMany = vi.fn()
const ivFindMany = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    scenario: { findFirst: (...a: unknown[]) => findFirst(...a) },
    company: { findMany: (...a: unknown[]) => companyFindMany(...a) },
    indicatorDefinition: { findMany: (...a: unknown[]) => indicatorFindMany(...a) },
    indicatorValue: { findMany: (...a: unknown[]) => ivFindMany(...a) },
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
  beforeEach(() => vi.clearAllMocks())

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
      byCompany: [{ companyId: 'c1', companyCode: 'CPC', baselineScore: 49, scenarioScore: 28 }],
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

  it('422 when ?mode=drivers but scenario has no shock', async () => {
    findFirst.mockResolvedValue({ id: 's1', code: 'X', nameEn: 'x', overrides: { adjustments: [] } })
    const res = await GET(req('http://x/api/scenarios/s1/simulate?mode=drivers'), { params: Promise.resolve({ id: 's1' }) } as never)
    expect(res.status).toBe(422)
  })
})
