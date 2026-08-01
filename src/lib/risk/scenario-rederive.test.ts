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
// 11.81 — four P&L indicators, not one. The coverage floor withholds a score
// below MIN_SCORING_CELLS contributing cells, and a scenario simulator that
// prints "holding 83 → 0" needs both ends of that swing to exist. The
// arithmetic under test (revenue-weighted parent roll-up) is unchanged: every
// indicator here carries the same formula and weight, so a company's composite
// is still exactly its single band.
const indicators = [
  { id: 'i1', code: 'IND_EBITDA_MARGIN', formula: 'ebitda / revenue * 100', thresholds: {}, requiredInputs: ['budgetLine'], weight: 1.5 },
  { id: 'i2', code: 'IND_EBITDA_MARGIN_B', formula: 'ebitda / revenue * 100', thresholds: {}, requiredInputs: ['budgetLine'], weight: 1.5 },
  { id: 'i3', code: 'IND_EBITDA_MARGIN_C', formula: 'ebitda / revenue * 100', thresholds: {}, requiredInputs: ['budgetLine'], weight: 1.5 },
  { id: 'i4', code: 'IND_EBITDA_MARGIN_D', formula: 'ebitda / revenue * 100', thresholds: {}, requiredInputs: ['budgetLine'], weight: 1.5 },
]
const baselineIVs = [
  ...['i1', 'i2', 'i3', 'i4'].map((indicatorId) => ({
    companyId: 'c1', indicatorId, value: 20, status: 'green' as const,
  })),
  ...['i1', 'i2', 'i3', 'i4'].map((indicatorId) => ({
    companyId: 'c2', indicatorId, value: 10, status: 'amber' as const,
  })),
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
  // 11.81 — four of each, so BOTH the full composite and the financial
  // sub-composite clear the coverage floor. The 1:1 financial-to-operational
  // mix the test is about is preserved exactly.
  const FIN_IDS = ['i1', 'i2', 'i3', 'i4']
  const OPS_IDS = ['o1', 'o2', 'o3', 'o4']
  const indicators = [
    ...FIN_IDS.map((id, n) => ({
      id, code: `IND_EBITDA_MARGIN_${n}`, formula: 'ebitda / revenue * 100',
      thresholds: {}, requiredInputs: ['budgetLine'], weight: 1,
    })),
    ...OPS_IDS.map((id, n) => ({
      id, code: `AGRO_YIELD_${n}`, formula: 'yield_per_ha',
      thresholds: {}, requiredInputs: ['operationalFact:yield_per_ha'], weight: 1,
    })),
  ]
  const baselineIVs = [
    ...FIN_IDS.map((indicatorId) => ({
      companyId: 'c1', indicatorId, value: 20, status: 'green' as const,
    })),
    ...OPS_IDS.map((indicatorId) => ({
      companyId: 'c1', indicatorId, value: 5, status: 'green' as const,
    })),
  ]
  const scenario = { code: 'INPUT_COST_30', overrides: { shock: { inputCostShock: 0.3 } } }

  it('financial swing reflects ONLY P&L indicators (drops harder than the diluted full composite)', async () => {
    const fakeBuildContext = vi.fn(async () => ({ context: { revenue: 1000, cogs: 600, opex: 200, gross_profit: 400, ebitda: 200, net_income: 150, da_total: 50, total_input_cost: 600, imported_input_cost: 0, yield_per_ha: 5 }, inputs: {}, functions: {} }) as never)
    // financial i1 → red under the cost shock; non-financial i2 (yield) → unchanged green.
    const fakeRecompute = vi.fn(async (_ds, args: { definition: { code?: string } }) =>
      (args.definition.code?.startsWith('IND_EBITDA_MARGIN') ? { ok: true, value: -5, status: 'red' } : { ok: true, value: 5, status: 'green' }) as never,
    )
    const r = await simulateByDrivers(
      noWriteDs,
      { organizationId: 'org1', scenario, period: '2026', companies, indicators, baselineIVs },
      { buildContext: fakeBuildContext, recomputeIndicator: fakeRecompute },
    )
    // Full composite: 4 red + 4 green → 50. Financial composite: the four
    // P&L cells are all red → 0.
    expect(r.holdingScenarioScore).toBe(50)
    expect(r.financialHoldingBaselineScore).toBe(100) // P&L green baseline
    expect(r.financialHoldingScenarioScore).toBe(0) // P&L red scenario
    // Financial stress is more dramatic than the diluted full swing.
    expect(r.holdingBaselineScore! - r.holdingScenarioScore!).toBeLessThan(
      r.financialHoldingBaselineScore! - r.financialHoldingScenarioScore!,
    )
  })
})

describe('simulateByDrivers — skip indicators the shock does not touch (BRENT→wheat regression)', () => {
  // The user's bug: a BRENT oil-spike (inputCostShock) "improved" FP_WHEAT_PRICE_SIGNAL
  // (formula `wheat_price_latest`, a pure commodity-feed scalar the shock never
  // overrides). Root cause: the engine recomputed it anyway, re-reading the CURRENT
  // feed (237.5) and diffing it against the STORED STALE baseline (380) → spurious
  // red→green "improve" with no causal link to the oil shock. Fix: skip the recompute
  // when the formula touches none of the shocked scalars → keep the baseline →
  // changed=false. The genuinely-shocked margin indicator still recomputes.
  const cos = [
    { id: 'c1', code: 'EDEN', name: 'Eden', parentCompanyId: 'p1', industry: 'food_processing', revenue: 1000 },
    { id: 'p1', code: 'AZSEKER', name: 'Holding', parentCompanyId: null, industry: null, revenue: null },
  ]
  const inds = [
    { id: 'i1', code: 'IND_EBITDA_MARGIN', formula: 'ebitda / revenue * 100', thresholds: {}, requiredInputs: ['budgetLine'], weight: 1 },
    { id: 'i2', code: 'FP_WHEAT_PRICE_SIGNAL', formula: 'wheat_price_latest', thresholds: {}, requiredInputs: ['commodityPrice:wheat_price_latest'], weight: 1 },
  ]
  const bIVs = [
    { companyId: 'c1', indicatorId: 'i1', value: 20, status: 'green' as const },
    { companyId: 'c1', indicatorId: 'i2', value: 380, status: 'red' as const }, // STALE stored baseline (feed is now 237.5)
  ]
  const scenario = { code: 'BRENT_TO_140', overrides: { shock: { inputCostShock: 0.3 } } }

  it('a no-override indicator with a stale baseline keeps its baseline (no spurious flip); the margin indicator still moves', async () => {
    const buildContext = vi.fn(
      async () => ({ context: { ...fullScalars, wheat_price_latest: 237.5 }, inputs: {}, functions: {} }) as never,
    )
    const recompute = vi.fn(async (_ds, args: { definition: { code?: string } }) => {
      // The would-be FRESH wheat value (237.5/green). It must NOT be used — the
      // skip-guard should keep the stale baseline (380/red) instead.
      if (args.definition.code === 'FP_WHEAT_PRICE_SIGNAL') return { ok: true, value: 237.5, status: 'green' } as never
      return { ok: true, value: -5, status: 'red' } as never // margin crashes under the cost shock
    })
    const r = await simulateByDrivers(
      noWriteDs,
      { organizationId: 'org1', scenario, period: '2026', companies: cos, indicators: inds, baselineIVs: bIVs },
      { buildContext, recomputeIndicator: recompute },
    )
    const wheat = r.deltas.find((d) => d.code === 'FP_WHEAT_PRICE_SIGNAL')!
    const margin = r.deltas.find((d) => d.code === 'IND_EBITDA_MARGIN')!
    // Wheat: skipped → baseline preserved → NO spurious red→green "improve".
    expect(wheat.scenarioValue).toBe(380)
    expect(wheat.scenarioStatus).toBe('red')
    expect(wheat.changed).toBe(false)
    // Proven skip: recompute was NEVER called for the wheat indicator.
    expect(
      recompute.mock.calls.some(
        (c) => (c[1] as { definition: { code?: string } }).definition.code === 'FP_WHEAT_PRICE_SIGNAL',
      ),
    ).toBe(false)
    // Margin: genuinely shocked → recomputed → worsened.
    expect(margin.scenarioStatus).toBe('red')
    expect(margin.changed).toBe(true)
    expect(r.worsened).toBeGreaterThan(0)
    // No spurious improvements anywhere.
    expect(r.improved).toBe(0)
  })
})

describe('simulateByDrivers — unknown baseline is NOT improved/worsened (regression)', () => {
  // Bug: STATUS_ORDER ranked unknown=0 (worst), so an indicator with NO
  // baseline that the shock gives a value (e.g. via assumedImportShare) flips
  // unknown→status and was counted as "improved" — so a devaluation read as
  // "4 improved / 0 worsened". A transition involving unknown is NOT comparable.
  it('unknown → green (or red) is not changed, not improved, not worsened', async () => {
    const buildContext = vi.fn(
      async () => ({ context: { ...fullScalars }, inputs: {}, functions: {} }) as never,
    )
    const recompute = vi.fn(
      async (_ds, args: { companyId: string; scenarioOverrides?: Record<string, number> }) => {
        const scen = !!args.scenarioOverrides && Object.keys(args.scenarioOverrides).length > 0
        // c1: unknown → green under scenario; c2: unknown → red under scenario.
        const status = scen ? (args.companyId === 'c1' ? 'green' : 'red') : 'unknown'
        return { ok: true, value: scen ? 5 : 0, status } as never
      },
    )
    const r = await simulateByDrivers(
      noWriteDs,
      {
        organizationId: 'org1',
        scenario,
        period: '2026',
        companies,
        indicators,
        baselineIVs: [
          { companyId: 'c1', indicatorId: 'i1', value: 0, status: 'unknown' as const },
          { companyId: 'c2', indicatorId: 'i1', value: 0, status: 'unknown' as const },
        ],
      },
      { buildContext, recomputeIndicator: recompute },
    )
    const c1 = r.deltas.find((d) => d.companyId === 'c1')!
    const c2 = r.deltas.find((d) => d.companyId === 'c2')!
    expect(c1.baselineStatus).toBe('unknown')
    expect(c1.scenarioStatus).toBe('green')
    expect(c1.changed).toBe(false)
    expect(c2.scenarioStatus).toBe('red')
    expect(c2.changed).toBe(false)
    expect(r.changed).toBe(0)
    expect(r.improved).toBe(0)
    expect(r.worsened).toBe(0)
  })
})
