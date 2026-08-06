import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(async () => ({ orgId: 'org1', userId: 'u1', role: 'manager' })),
  isAuthError: () => false,
}))
const findFirst = vi.fn()
const companyFindMany = vi.fn()
const indicatorFindMany = vi.fn()
const ivFindMany = vi.fn()
const companyIndicatorFindMany = vi.fn()
const fxFindMany = vi.fn()
const intelFindMany = vi.fn()
// Phase 16.6 — per-company imported-input share is read from BudgetAssumption.
const assumptionFindMany = vi.fn()
const getCompanyScopeMock = vi.fn()
const createPrismaDataSource = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    scenario: { findFirst: (...a: unknown[]) => findFirst(...a) },
    company: { findMany: (...a: unknown[]) => companyFindMany(...a) },
    indicatorDefinition: { findMany: (...a: unknown[]) => indicatorFindMany(...a) },
    indicatorValue: { findMany: (...a: unknown[]) => ivFindMany(...a) },
    companyIndicator: { findMany: (...a: unknown[]) => companyIndicatorFindMany(...a) },
    currencyRateHistory: { findMany: (...a: unknown[]) => fxFindMany(...a) },
    intelDataPoint: { findMany: (...a: unknown[]) => intelFindMany(...a) },
    budgetAssumption: { findMany: (...a: unknown[]) => assumptionFindMany(...a) },
  },
}))
vi.mock('@/lib/rbac/company-scope', () => ({
  getCompanyScope: (...a: unknown[]) => getCompanyScopeMock(...a),
}))
vi.mock('@/lib/risk/recompute', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/risk/recompute')>()),
  createPrismaDataSource: (...a: unknown[]) => createPrismaDataSource(...a),
}))
const simulateByDrivers = vi.fn()
vi.mock('@/lib/risk/scenario-rederive', () => ({ simulateByDrivers: (...a: unknown[]) => simulateByDrivers(...a) }))
const runCrisisBrief = vi.fn()
vi.mock('@/lib/risk/scenario-narrative', () => ({ runCrisisBrief: (...a: unknown[]) => runCrisisBrief(...a) }))
vi.mock('@/lib/ai/client', () => ({ hasAnthropicKey: () => true }))

import { GET } from './route'

const req = (url: string) => new Request(url) as never
const operationalCompany = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  code: 'CPC',
  name: 'CPC',
  parentCompanyId: null,
  industry: 'food_processing',
  level: 2,
  isActive: true,
  role: 'operational',
  status: 'active',
  ...overrides,
})

describe('GET simulate ?mode=drivers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    companyIndicatorFindMany.mockResolvedValue([])
    indicatorFindMany.mockResolvedValue([])
    getCompanyScopeMock.mockResolvedValue({ ids: null, bypassed: false })
    createPrismaDataSource.mockReturnValue({})
    fxFindMany.mockResolvedValue([])
    intelFindMany.mockResolvedValue([])
    assumptionFindMany.mockResolvedValue([])
  })

  it('derives revenue from inputs.resolved.revenue + runs sim + narrative', async () => {
    findFirst.mockResolvedValue({ id: 's1', code: 'INPUT_COST_30', nameEn: 'Input +30%', nameRu: 'Стоимость +30%', overrides: { shock: { inputCostShock: 0.3 } } })
    companyFindMany.mockResolvedValue([
      operationalCompany({ parentCompanyId: 'p1' }),
      operationalCompany({ id: 'p1', code: 'AZSEKER', name: 'Holding', industry: null, level: 1 }),
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
      driftSummary: { pairsAttempted: 1, pairsErrored: 0, lastError: null }, driverReports: [],
    })
    runCrisisBrief.mockResolvedValue({ narrative: '⚠ 45→31', mitigations: ['hedge'], confidence: 0.7, modelName: 'sonnet', promptVersion: 'v1' })

    const res = await GET(req('http://x/api/scenarios/s1/simulate?mode=drivers&period=2026&narrative=1'), { params: Promise.resolve({ id: 's1' }) } as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.holdingScenarioScore).toBe(31)
    expect(body.narrative).toContain('45→31')
    const passedCompanies = (simulateByDrivers.mock.calls[0][1] as { companies: Array<{ id: string; revenue: number | null }> }).companies
    expect(passedCompanies.find((c) => c.id === 'c1')!.revenue).toBe(6475882)
    expect(createPrismaDataSource).toHaveBeenCalledWith(
      expect.anything(),
      { mode: 'preview' },
    )
  })

  it('graceful degrade: AI throws → 200 with narrative=null + narrativeError', async () => {
    findFirst.mockResolvedValue({ id: 's1', code: 'INPUT_COST_30', nameEn: 'x', overrides: { shock: { inputCostShock: 0.3 } } })
    companyFindMany.mockResolvedValue([operationalCompany()])
    indicatorFindMany.mockResolvedValue([{ id: 'i1', code: 'X', formula: 'x', thresholds: {}, requiredInputs: [], weight: 1 }])
    ivFindMany.mockResolvedValue([{ companyId: 'c1', indicatorId: 'i1', value: 1, status: 'green', inputs: { resolved: { revenue: 1 } } }])
    simulateByDrivers.mockResolvedValue({ scenarioCode: 'X', period: '2026', deltas: [], byCompany: [], holdingBaselineScore: 45, holdingScenarioScore: 31, changed: 0, worsened: 0, improved: 0, driftSummary: { pairsAttempted: 1, pairsErrored: 0, lastError: null }, driverReports: [] })
    runCrisisBrief.mockRejectedValue(new Error('LLM down'))

    const res = await GET(req('http://x/api/scenarios/s1/simulate?mode=drivers&narrative=1'), { params: Promise.resolve({ id: 's1' }) } as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.holdingScenarioScore).toBe(31)
    expect(body.narrative).toBeNull()
    expect(body.narrativeError).toBeTruthy()
  })

  it('a GET with no narrative param spends nothing', async () => {
    // 2026-08-04 audit. The gate read `!== '0'`, so ANY GET on this route —
    // including one typed into a browser, replayed from a log, or hit by a
    // crawler — fired a paid Anthropic call. Auth is requireAuth with no role
    // floor and there was no rate limit, so a viewer could bill the org in a
    // loop. The terminal states the opposite contract on screen: "LLM calls
    // are user-triggered — never auto-fired." Opt-in is now the default, and
    // ScenarioPanel asks for it explicitly.
    findFirst.mockResolvedValue({ id: 's1', code: 'INPUT_COST_30', nameEn: 'x', overrides: { shock: { inputCostShock: 0.3 } } })
    companyFindMany.mockResolvedValue([operationalCompany()])
    indicatorFindMany.mockResolvedValue([{ id: 'i1', code: 'X', formula: 'x', thresholds: {}, requiredInputs: [], weight: 1 }])
    ivFindMany.mockResolvedValue([{ companyId: 'c1', indicatorId: 'i1', value: 1, status: 'green', inputs: { resolved: { revenue: 1 } } }])
    simulateByDrivers.mockResolvedValue({ scenarioCode: 'X', period: '2026', deltas: [], byCompany: [], holdingBaselineScore: 45, holdingScenarioScore: 31, changed: 0, worsened: 0, improved: 0, driftSummary: { pairsAttempted: 1, pairsErrored: 0, lastError: null }, driverReports: [] })
    runCrisisBrief.mockResolvedValue({ narrative: 'should never be requested', mitigations: [], confidence: 0.5, modelName: 'x', promptVersion: 'v1' })

    const res = await GET(req('http://x/api/scenarios/s1/simulate?mode=drivers&period=2026'), { params: Promise.resolve({ id: 's1' }) } as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    // The simulation still runs — only the billed part is withheld.
    expect(body.holdingScenarioScore).toBe(31)
    expect(runCrisisBrief).not.toHaveBeenCalled()
    expect(body.narrative).toBeNull()
  })

  it('?narrative=0 skips the AI call (fast cascade) + still returns worstHit', async () => {
    findFirst.mockResolvedValue({ id: 's1', code: 'INPUT_COST_30', nameEn: 'x', overrides: { shock: { inputCostShock: 0.3 } } })
    companyFindMany.mockResolvedValue([operationalCompany()])
    indicatorFindMany.mockResolvedValue([{ id: 'i1', code: 'IND_EBITDA_MARGIN', formula: 'x', thresholds: {}, requiredInputs: [], weight: 1 }])
    ivFindMany.mockResolvedValue([{ companyId: 'c1', indicatorId: 'i1', value: 4.5, status: 'red', inputs: { resolved: { revenue: 1 } } }])
    simulateByDrivers.mockResolvedValue({
      scenarioCode: 'INPUT_COST_30', period: '2026',
      deltas: [{ companyId: 'c1', companyCode: 'CPC', companyName: 'CPC', indicatorId: 'i1', code: 'IND_EBITDA_MARGIN', baselineValue: 4.5, baselineStatus: 'amber', scenarioValue: -7, scenarioStatus: 'red', changed: true, deltaPct: -255 }],
      byCompany: [{ companyId: 'c1', companyCode: 'CPC', baselineScore: 64, scenarioScore: 40 }],
      holdingBaselineScore: 61, holdingScenarioScore: 55, financialHoldingBaselineScore: 62, financialHoldingScenarioScore: 50, changed: 1, worsened: 1, improved: 0, driftSummary: { pairsAttempted: 1, pairsErrored: 0, lastError: null }, driverReports: [],
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
    const res = await GET(req('http://x/api/scenarios/s1/simulate?mode=drivers&narrative=1'), { params: Promise.resolve({ id: 's1' }) } as never)
    expect(res.status).toBe(422)
  })

  it('Phase 2: an absolute target resolves to a fraction from the live feed + returns anchors', async () => {
    findFirst.mockResolvedValue({ id: 's1', code: 'AZN_DEVAL_20', nameEn: 'AZN -20%', overrides: { shock: { target: { metric: 'AZN_USD', value: 2.04, drives: 'fxShock' } } } })
    fxFindMany.mockResolvedValue([{ currencyCode: 'USD', rate: 1.7, rateDate: new Date('2026-05-28') }])
    companyFindMany.mockResolvedValue([operationalCompany()])
    indicatorFindMany.mockResolvedValue([{ id: 'i1', code: 'FX_IMPORTED_INPUT', formula: 'imported_input_cost/total_input_cost*100', thresholds: {}, requiredInputs: [], weight: 1 }])
    ivFindMany.mockResolvedValue([{ companyId: 'c1', indicatorId: 'i1', value: 0, status: 'green', inputs: { resolved: { revenue: 6475882 } } }])
    simulateByDrivers.mockResolvedValue({ scenarioCode: 'AZN_DEVAL_20', period: '2026', deltas: [], byCompany: [], holdingBaselineScore: 61, holdingScenarioScore: 58, financialHoldingBaselineScore: 62, financialHoldingScenarioScore: 55, changed: 0, worsened: 0, improved: 0, driftSummary: { pairsAttempted: 1, pairsErrored: 0, lastError: null }, driverReports: [] })
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

  it('passes only applicable baseline pairs: explicit enabled beats mismatch and disabled beats taxonomy', async () => {
    findFirst.mockResolvedValue({
      id: 's1',
      code: 'INPUT_COST_30',
      nameEn: 'Input +30%',
      overrides: { shock: { inputCostShock: 0.3 } },
    })
    companyFindMany.mockResolvedValue([
      operationalCompany({ code: 'AGRO', name: 'Agro', industry: 'agro_crops' }),
      operationalCompany({
        id: 'admin',
        code: 'HQ',
        name: 'Admin shell',
        industry: null,
        role: 'admin',
      }),
    ])
    indicatorFindMany.mockResolvedValue([
      {
        id: 'i-retail',
        organizationId: null,
        code: 'RETAIL_OVERRIDE',
        formula: 'input_cost',
        thresholds: {},
        requiredInputs: [],
        industries: ['retail'],
        weight: 1,
      },
      {
        id: 'i-agro',
        organizationId: null,
        code: 'AGRO_DISABLED',
        formula: 'input_cost',
        thresholds: {},
        requiredInputs: [],
        industries: ['agro_crops'],
        weight: 1,
      },
    ])
    ivFindMany.mockResolvedValue([
      { companyId: 'c1', indicatorId: 'i-retail', value: 10, status: 'green', inputs: null },
      { companyId: 'c1', indicatorId: 'i-agro', value: 20, status: 'green', inputs: null },
      { companyId: 'admin', indicatorId: 'i-retail', value: 99, status: 'red', inputs: null },
    ])
    companyIndicatorFindMany.mockResolvedValue([
      { companyId: 'c1', indicatorId: 'i-retail', enabled: true },
      { companyId: 'c1', indicatorId: 'i-agro', enabled: false },
    ])
    simulateByDrivers.mockResolvedValue({
      scenarioCode: 'INPUT_COST_30',
      period: '2026',
      deltas: [],
      byCompany: [],
      holdingBaselineScore: null,
      holdingScenarioScore: null,
      changed: 0,
      worsened: 0,
      improved: 0,
      driftSummary: { pairsAttempted: 1, pairsErrored: 0, lastError: null }, driverReports: [],
    })

    const res = await GET(
      req('http://x/api/scenarios/s1/simulate?mode=drivers&narrative=0&period=2026'),
      { params: Promise.resolve({ id: 's1' }) } as never,
    )

    expect(res.status).toBe(200)
    const input = simulateByDrivers.mock.calls[0][1] as {
      companies: Array<{ id: string }>
      baselineIVs: Array<{ companyId: string; indicatorId: string }>
    }
    expect(input.companies.map((company) => company.id)).toEqual(['c1'])
    expect(input.baselineIVs).toEqual([
      expect.objectContaining({ companyId: 'c1', indicatorId: 'i-retail' }),
    ])
  })

  it('applies subgroup RBAC to both driver companies and baseline rows', async () => {
    getCompanyScopeMock.mockResolvedValue({
      ids: new Set(['c1']),
      bypassed: false,
    })
    findFirst.mockResolvedValue({
      id: 's1',
      code: 'INPUT_COST_30',
      nameEn: 'Input +30%',
      overrides: { shock: { inputCostShock: 0.3 } },
    })
    companyFindMany.mockResolvedValue([
      operationalCompany({ id: 'c1', code: 'ALLOWED' }),
      operationalCompany({ id: 'c2', code: 'DENIED' }),
    ])
    indicatorFindMany.mockResolvedValue([
      {
        id: 'i1',
        organizationId: null,
        code: 'VISIBLE',
        formula: 'input_cost',
        thresholds: {},
        requiredInputs: [],
        industries: [],
        isActive: true,
        category: 'operational',
        weight: 1,
      },
    ])
    ivFindMany.mockResolvedValue([
      { companyId: 'c1', indicatorId: 'i1', value: 10, status: 'green', inputs: null },
      { companyId: 'c2', indicatorId: 'i1', value: 20, status: 'red', inputs: null },
    ])
    simulateByDrivers.mockResolvedValue({
      scenarioCode: 'INPUT_COST_30',
      period: '2026',
      deltas: [],
      byCompany: [],
      holdingBaselineScore: null,
      holdingScenarioScore: null,
      changed: 0,
      worsened: 0,
      improved: 0,
      driftSummary: { pairsAttempted: 1, pairsErrored: 0, lastError: null }, driverReports: [],
    })

    const res = await GET(
      req('http://x/api/scenarios/s1/simulate?mode=drivers&narrative=0&period=2026'),
      { params: Promise.resolve({ id: 's1' }) } as never,
    )

    expect(res.status).toBe(200)
    expect(getCompanyScopeMock).toHaveBeenCalledWith('org1', 'u1', 'manager')
    expect(companyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['c1'] } }),
      }),
    )
    expect(ivFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: { in: ['c1'] } }),
      }),
    )
    const input = simulateByDrivers.mock.calls[0][1] as {
      companies: Array<{ id: string }>
      baselineIVs: Array<{ companyId: string }>
    }
    expect(input.companies.map((company) => company.id)).toEqual(['c1'])
    expect(input.baselineIVs.map((value) => value.companyId)).toEqual(['c1'])
  })

  it('prefers the org-scoped definition and its baseline when a global code is overridden', async () => {
    findFirst.mockResolvedValue({
      id: 's1',
      code: 'INPUT_COST_30',
      nameEn: 'Input +30%',
      overrides: { shock: { inputCostShock: 0.3 } },
    })
    companyFindMany.mockResolvedValue([operationalCompany()])
    indicatorFindMany.mockResolvedValue([
      {
        id: 'i-global',
        organizationId: null,
        code: 'SAME_CODE',
        formula: 'input_cost',
        thresholds: {},
        requiredInputs: [],
        industries: [],
        isActive: true,
        weight: 1,
      },
      {
        id: 'i-org',
        organizationId: 'org1',
        code: 'SAME_CODE',
        formula: 'input_cost',
        thresholds: {},
        requiredInputs: [],
        industries: [],
        isActive: true,
        weight: 1,
      },
    ])
    ivFindMany.mockResolvedValue([
      { companyId: 'c1', indicatorId: 'i-global', value: 10, status: 'green', inputs: null },
      { companyId: 'c1', indicatorId: 'i-org', value: 20, status: 'amber', inputs: null },
    ])
    simulateByDrivers.mockResolvedValue({
      scenarioCode: 'INPUT_COST_30',
      period: '2026',
      deltas: [],
      byCompany: [],
      holdingBaselineScore: null,
      holdingScenarioScore: null,
      changed: 0,
      worsened: 0,
      improved: 0,
      driftSummary: { pairsAttempted: 1, pairsErrored: 0, lastError: null }, driverReports: [],
    })

    const res = await GET(
      req('http://x/api/scenarios/s1/simulate?mode=drivers&narrative=0&period=2026'),
      { params: Promise.resolve({ id: 's1' }) } as never,
    )

    expect(res.status).toBe(200)
    const input = simulateByDrivers.mock.calls[0][1] as {
      indicators: Array<{ id: string }>
      baselineIVs: Array<{ indicatorId: string }>
    }
    expect(input.indicators.map((indicator) => indicator.id)).toEqual(['i-org'])
    expect(input.baselineIVs.map((value) => value.indicatorId)).toEqual(['i-org'])
  })

  it('excludes ordinary internal definitions and keeps rollup internals parent-only', async () => {
    findFirst.mockResolvedValue({
      id: 's1',
      code: 'INPUT_COST_30',
      nameEn: 'Input +30%',
      overrides: { shock: { inputCostShock: 0.3 } },
    })
    companyFindMany.mockResolvedValue([
      operationalCompany({ parentCompanyId: 'p1' }),
      operationalCompany({ id: 'p1', code: 'GROUP', industry: null, level: 1 }),
    ])
    indicatorFindMany.mockResolvedValue([
      {
        id: 'i-visible',
        organizationId: null,
        code: 'VISIBLE',
        formula: 'input_cost',
        thresholds: {},
        requiredInputs: [],
        industries: [],
        isActive: true,
        category: 'operational',
        weight: 1,
      },
      {
        id: 'i-hidden',
        organizationId: null,
        code: 'INTERNAL_HELPER',
        formula: 'input_cost',
        thresholds: {},
        requiredInputs: [],
        industries: [],
        isActive: true,
        category: 'internal',
        weight: 1,
      },
      {
        id: 'i-rollup',
        organizationId: null,
        code: 'INTERNAL_ROLLUP',
        formula: 'rollup("VISIBLE")',
        thresholds: {},
        requiredInputs: ['rollup:VISIBLE'],
        industries: [],
        isActive: true,
        category: 'internal',
        weight: 1,
      },
      {
        id: 'i-hosp-parent',
        organizationId: null,
        code: 'HOSP_PARENT_STALE',
        formula: 'input_cost',
        thresholds: {},
        requiredInputs: [],
        // Universal taxonomy would normally fail-open on a null-industry
        // parent. The scenario surface must still reject non-rollup parent IVs.
        industries: [],
        isActive: true,
        category: 'operational',
        weight: 1,
      },
    ])
    ivFindMany.mockResolvedValue([
      { companyId: 'c1', indicatorId: 'i-visible', value: 10, status: 'green', inputs: null },
      { companyId: 'c1', indicatorId: 'i-hidden', value: 20, status: 'green', inputs: null },
      { companyId: 'c1', indicatorId: 'i-rollup', value: 30, status: 'amber', inputs: null },
      { companyId: 'p1', indicatorId: 'i-rollup', value: 40, status: 'green', inputs: null },
      { companyId: 'p1', indicatorId: 'i-hosp-parent', value: 99, status: 'red', inputs: null },
    ])
    simulateByDrivers.mockResolvedValue({
      scenarioCode: 'INPUT_COST_30',
      period: '2026',
      deltas: [],
      byCompany: [],
      holdingBaselineScore: null,
      holdingScenarioScore: null,
      changed: 0,
      worsened: 0,
      improved: 0,
      driftSummary: { pairsAttempted: 2, pairsErrored: 0, lastError: null }, driverReports: [],
    })

    const res = await GET(
      req('http://x/api/scenarios/s1/simulate?mode=drivers&narrative=0&period=2026'),
      { params: Promise.resolve({ id: 's1' }) } as never,
    )

    expect(res.status).toBe(200)
    const input = simulateByDrivers.mock.calls[0][1] as {
      indicators: Array<{ id: string }>
      baselineIVs: Array<{ companyId: string; indicatorId: string }>
    }
    expect(input.indicators.map((indicator) => indicator.id)).toEqual([
      'i-visible',
      'i-rollup',
      'i-hosp-parent',
    ])
    expect(input.baselineIVs).toEqual([
      expect.objectContaining({ companyId: 'c1', indicatorId: 'i-visible' }),
      expect.objectContaining({ companyId: 'p1', indicatorId: 'i-rollup' }),
    ])
  })
})

describe('GET simulate default multiplier mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    companyIndicatorFindMany.mockResolvedValue([])
    indicatorFindMany.mockResolvedValue([])
    getCompanyScopeMock.mockResolvedValue({ ids: null, bypassed: false })
    createPrismaDataSource.mockReturnValue({})
  })

  it('simulates enabled cross-industry pairs and omits explicitly disabled pairs', async () => {
    getCompanyScopeMock.mockResolvedValue({
      ids: new Set(['c1', 'p1']),
      bypassed: false,
    })
    findFirst.mockResolvedValue({
      id: 's1',
      code: 'MIXED',
      nameEn: 'Mixed applicability',
      overrides: {
        adjustments: [
          { codes: ['HOSP_OCC'], multiply: 0.8 },
          { codes: ['IND_EBITDA_MARGIN'], multiply: 0.8 },
          { codes: ['AGRO_YIELD'], multiply: 0.8 },
        ],
      },
    })
    companyFindMany.mockResolvedValue([
      operationalCompany({ id: 'c1', code: 'ALLOWED', parentCompanyId: 'p1' }),
      operationalCompany({ id: 'p1', code: 'GROUP', industry: null, level: 1 }),
      operationalCompany({
        id: 'c2',
        code: 'DENIED',
        industry: 'hospitality',
      }),
    ])
    ivFindMany.mockResolvedValue([
      {
        companyId: 'c1',
        indicatorId: 'i-hosp',
        value: 80,
        status: 'green',
        company: operationalCompany({ code: 'AGRO', name: 'Agro', industry: 'agro_crops' }),
        indicator: {
          id: 'i-hosp',
          organizationId: null,
          code: 'HOSP_OCC',
          industries: ['hospitality'],
          isActive: true,
        },
      },
      {
        companyId: 'c2',
        indicatorId: 'i-hosp',
        value: 70,
        status: 'green',
        company: operationalCompany({
          id: 'c2',
          code: 'DENIED',
          name: 'Denied hotel',
          industry: 'hospitality',
        }),
        indicator: {
          id: 'i-hosp',
          organizationId: null,
          code: 'HOSP_OCC',
          industries: ['hospitality'],
          isActive: true,
        },
      },
      {
        companyId: 'p1',
        indicatorId: 'i-hosp',
        value: 99,
        status: 'red',
        company: operationalCompany({
          id: 'p1',
          code: 'GROUP',
          name: 'Group',
          industry: null,
          level: 1,
        }),
        indicator: {
          id: 'i-hosp',
          organizationId: null,
          code: 'HOSP_OCC',
          industries: ['hospitality'],
          isActive: true,
        },
      },
      {
        companyId: 'c1',
        indicatorId: 'i-ebitda',
        value: 20,
        status: 'green',
        company: operationalCompany({ code: 'AGRO', name: 'Agro', industry: 'agro_crops' }),
        indicator: {
          id: 'i-ebitda',
          organizationId: null,
          code: 'IND_EBITDA_MARGIN',
          industries: [],
          isActive: true,
        },
      },
      {
        companyId: 'c1',
        indicatorId: 'i-internal',
        value: 5,
        status: 'green',
        company: operationalCompany({ code: 'AGRO', name: 'Agro', industry: 'agro_crops' }),
        indicator: {
          id: 'i-internal',
          organizationId: null,
          code: 'AGRO_YIELD',
          industries: ['agro_crops'],
          isActive: true,
        },
      },
    ])
    indicatorFindMany.mockResolvedValue([
      {
        id: 'i-hosp',
        organizationId: null,
        code: 'HOSP_OCC',
        industries: ['hospitality'],
        isActive: true,
      },
      {
        id: 'i-ebitda',
        organizationId: null,
        code: 'IND_EBITDA_MARGIN',
        industries: [],
        isActive: true,
      },
      {
        id: 'i-internal',
        organizationId: null,
        code: 'AGRO_YIELD',
        industries: ['agro_crops'],
        isActive: true,
        category: 'internal',
        requiredInputs: ['operationalFact:yield_per_ha'],
      },
    ])
    companyIndicatorFindMany.mockResolvedValue([
      { companyId: 'c1', indicatorId: 'i-hosp', enabled: true },
      { companyId: 'c1', indicatorId: 'i-ebitda', enabled: false },
      { companyId: 'c1', indicatorId: 'i-internal', enabled: true },
    ])

    const res = await GET(
      req('http://x/api/scenarios/s1/simulate?period=2026'),
      { params: Promise.resolve({ id: 's1' }) } as never,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(ivFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: { in: ['c1', 'p1'] } }),
      }),
    )
    expect(body.deltas).toHaveLength(1)
    expect(body.deltas[0]).toMatchObject({ companyId: 'c1', code: 'HOSP_OCC' })
  })
})
