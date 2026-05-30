import { describe, it, expect, vi } from 'vitest'
import { simulateByDrivers, isFinancialIndicator } from './scenario-rederive'

describe('isFinancialIndicator', () => {
  it('true for P&L-scalar formulas', () => {
    expect(isFinancialIndicator('gross_profit / revenue * 100')).toBe(true)
    expect(isFinancialIndicator('ebitda / revenue * 100')).toBe(true)
    expect(isFinancialIndicator('imported_input_cost / total_input_cost * 100')).toBe(true)
    expect(isFinancialIndicator('revenue / hectares_planted')).toBe(true)
  })
  it('false for non-financial (operational/esg) formulas', () => {
    expect(isFinancialIndicator('yield_per_ha')).toBe(false)
    expect(isFinancialIndicator('industry_factor_scope_1')).toBe(false)
    expect(isFinancialIndicator('news_sentiment_30d')).toBe(false)
    expect(isFinancialIndicator('')).toBe(false)
  })
})

// DS whose every mutation throws — proves the engine never persists.
const noWriteDs = new Proxy(
  {},
  {
    get(_t, prop: string) {
      if (/^upsert|^create|^update|^delete|^persist/i.test(prop)) {
        return () => {
          throw new Error(`DB write attempted: ${prop}`)
        }
      }
      return () => undefined
    },
  },
) as never

const companies = [
  { id: 'c1', code: 'CPC', name: 'CPC', parentCompanyId: 'p1', industry: 'food_processing', revenue: 1000 },
  { id: 'c2', code: 'EDEN', name: 'Eden', parentCompanyId: 'p1', industry: 'agro_crops', revenue: 500 },
  { id: 'p1', code: 'AZSEKER', name: 'Holding', parentCompanyId: null, industry: null, revenue: null },
]
const indicators = [
  { id: 'i1', code: 'IND_EBITDA_MARGIN', formula: 'ebitda / revenue * 100', thresholds: {}, requiredInputs: ['budgetLine'], weight: 1.5 },
]
const baselineIVs = [
  { companyId: 'c1', indicatorId: 'i1', value: 20, status: 'green' as const },
  { companyId: 'c2', indicatorId: 'i1', value: 10, status: 'amber' as const },
]
const scenario = { code: 'INPUT_COST_30', overrides: { shock: { inputCostShock: 0.3 } } }

const fullScalars = {
  revenue: 1000, cogs: 600, opex: 200, gross_profit: 400, ebitda: 200,
  net_income: 150, da_total: 50, total_input_cost: 600, imported_input_cost: 0,
}

describe('simulateByDrivers (B2)', () => {
  it('recomputes scenario IVs via injected recompute, computes deltas + holding swing, NO writes', async () => {
    const fakeBuildContext = vi.fn(async () => ({ context: { ...fullScalars }, inputs: {}, functions: {} }) as never)
    const fakeRecompute = vi.fn(async (_ds, args: { companyId: string; scenarioOverrides?: Record<string, number> }) => {
      const scen = !!args.scenarioOverrides && Object.keys(args.scenarioOverrides).length > 0
      if (args.companyId === 'c1') return { ok: true, value: scen ? 2 : 20, status: scen ? 'red' : 'green' } as never
      return { ok: true, value: scen ? -5 : 10, status: scen ? 'red' : 'amber' } as never
    })
    const r = await simulateByDrivers(
      noWriteDs,
      { organizationId: 'org1', scenario, period: '2026', companies, indicators, baselineIVs },
      { buildContext: fakeBuildContext, recomputeIndicator: fakeRecompute },
    )

    const c1 = r.deltas.find((d) => d.companyId === 'c1')!
    expect(c1.baselineValue).toBe(20)
    expect(c1.scenarioValue).toBe(2)
    expect(c1.changed).toBe(true)
    expect(r.holdingScenarioScore! < r.holdingBaselineScore!).toBe(true)
    expect(r.worsened).toBeGreaterThan(0)

    // the override handed to recompute is the consistent scalar set (gross_profit < baseline)
    const scenCall = fakeRecompute.mock.calls.find(
      (c) =>
        (c[1] as { scenarioOverrides?: Record<string, number> }).scenarioOverrides &&
        Object.keys((c[1] as { scenarioOverrides: Record<string, number> }).scenarioOverrides).length,
    )
    expect(scenCall).toBeTruthy()
    expect((scenCall![1] as { scenarioOverrides: Record<string, number> }).scenarioOverrides.gross_profit).toBeCloseTo(
      1000 - (600 + 600 * 0.3),
    )
  })

  it('a per-company recompute throw falls back to baseline, never aborts', async () => {
    const fakeBuildContext = vi.fn(async () => ({ context: { ...fullScalars }, inputs: {}, functions: {} }) as never)
    const fakeRecompute = vi.fn(async (_ds, args: { companyId: string }) => {
      if (args.companyId === 'c2') throw new Error('resolver blew up')
      return { ok: true, value: 2, status: 'red' } as never
    })
    const r = await simulateByDrivers(
      noWriteDs,
      { organizationId: 'org1', scenario, period: '2026', companies, indicators, baselineIVs },
      { buildContext: fakeBuildContext, recomputeIndicator: fakeRecompute },
    )
    expect(r.driftSummary.pairsErrored).toBeGreaterThan(0)
    const c2 = r.deltas.find((d) => d.companyId === 'c2')!
    expect(c2.scenarioValue).toBe(c2.baselineValue)
    expect(c2.changed).toBe(false)
  })

  it('holding swing is revenue-weighted (hand-computed fixture)', async () => {
    // c1 rev 1000 stays green(100); c2 rev 500 stays amber(50) → parent = (100*1000+50*500)/1500 = 83
    const fakeBuildContext = vi.fn(async () => ({ context: { ...fullScalars }, inputs: {}, functions: {} }) as never)
    const fakeRecompute = vi.fn(async (_ds, args: { companyId: string }) =>
      (args.companyId === 'c1' ? { ok: true, value: 20, status: 'green' } : { ok: true, value: 10, status: 'amber' }) as never,
    )
    const r = await simulateByDrivers(
      noWriteDs,
      { organizationId: 'org1', scenario, period: '2026', companies, indicators, baselineIVs },
      { buildContext: fakeBuildContext, recomputeIndicator: fakeRecompute },
    )
    expect(r.holdingScenarioScore).toBe(83)
  })
})

describe('simulateByDrivers — financial-stress sub-composite', () => {
  const companies = [
    { id: 'c1', code: 'CPC', name: 'CPC', parentCompanyId: 'p1', industry: 'food_processing', revenue: 1000 },
    { id: 'p1', code: 'AZSEKER', name: 'Holding', parentCompanyId: null, industry: null, revenue: null },
  ]
  const indicators = [
    { id: 'i1', code: 'IND_EBITDA_MARGIN', formula: 'ebitda / revenue * 100', thresholds: {}, requiredInputs: ['budgetLine'], weight: 1 },
    { id: 'i2', code: 'AGRO_YIELD', formula: 'yield_per_ha', thresholds: {}, requiredInputs: ['operationalFact:yield_per_ha'], weight: 1 },
  ]
  const baselineIVs = [
    { companyId: 'c1', indicatorId: 'i1', value: 20, status: 'green' as const },
    { companyId: 'c1', indicatorId: 'i2', value: 5, status: 'green' as const },
  ]
  const scenario = { code: 'INPUT_COST_30', overrides: { shock: { inputCostShock: 0.3 } } }

  it('financial swing reflects ONLY P&L indicators (drops harder than the diluted full composite)', async () => {
    const fakeBuildContext = vi.fn(async () => ({ context: { revenue: 1000, cogs: 600, opex: 200, gross_profit: 400, ebitda: 200, net_income: 150, da_total: 50, total_input_cost: 600, imported_input_cost: 0, yield_per_ha: 5 }, inputs: {}, functions: {} }) as never)
    // financial i1 → red under the cost shock; non-financial i2 (yield) → unchanged green.
    const fakeRecompute = vi.fn(async (_ds, args: { definition: { code?: string } }) =>
      (args.definition.code === 'IND_EBITDA_MARGIN' ? { ok: true, value: -5, status: 'red' } : { ok: true, value: 5, status: 'green' }) as never,
    )
    const r = await simulateByDrivers(
      noWriteDs,
      { organizationId: 'org1', scenario, period: '2026', companies, indicators, baselineIVs },
      { buildContext: fakeBuildContext, recomputeIndicator: fakeRecompute },
    )
    // Full composite: 1 red + 1 green → 50. Financial composite: only i1 red → 0.
    expect(r.holdingScenarioScore).toBe(50)
    expect(r.financialHoldingBaselineScore).toBe(100) // i1 green baseline
    expect(r.financialHoldingScenarioScore).toBe(0) // i1 red scenario
    // Financial stress is more dramatic than the diluted full swing.
    expect(r.holdingBaselineScore! - r.holdingScenarioScore!).toBeLessThan(
      r.financialHoldingBaselineScore! - r.financialHoldingScenarioScore!,
    )
  })
})
