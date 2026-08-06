import { describe, it, expect, vi } from 'vitest'
import { simulateByDrivers } from './scenario-rederive'

/**
 * Phase 16.6 — `simulateByDrivers` resolves the imported-input share PER
 * COMPANY, and reports where each company's share came from.
 *
 * The behaviour that matters is that two companies under the SAME FX scenario
 * now receive different cost shocks when they state different shares. Before
 * this, one `assumedImportShare` literal from the scenario definition was
 * applied to every company in the holding.
 */

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

/** FX scenario carrying the catalogue literal, exactly as `crisis-catalog.ts` ships it. */
const FX_SCENARIO = {
  code: 'AZN_DEVAL_20',
  overrides: { shock: { fxShock: 0.2, assumedImportShare: 0.3 } },
}

const scalars = {
  revenue: 1000, cogs: 600, opex: 200, gross_profit: 400, ebitda: 200,
  net_income: 150, da_total: 50, total_input_cost: 600, imported_input_cost: 0,
}

function harness(overrides: { importedInputCostByCompany?: Record<string, number> } = {}) {
  const buildContext = vi.fn(async (_ds: unknown, args: { companyId: string }) => ({
    context: {
      ...scalars,
      imported_input_cost: overrides.importedInputCostByCompany?.[args.companyId] ?? 0,
    },
    inputs: {},
    functions: {},
  }) as never)
  // Captures what each company's shock actually resolved to.
  const seen = new Map<string, Record<string, number> | undefined>()
  const recomputeIndicator = vi.fn(async (_ds: unknown, args: { companyId: string; scenarioOverrides?: Record<string, number> }) => {
    if (args.scenarioOverrides && Object.keys(args.scenarioOverrides).length > 0) {
      seen.set(args.companyId, args.scenarioOverrides)
    }
    return { ok: true, value: 5, status: 'red' } as never
  })
  return { buildContext, recomputeIndicator, seen }
}

function run(
  assumptions: Array<Record<string, unknown>>,
  h = harness(),
  scenario: { code: string; overrides: unknown } = FX_SCENARIO,
) {
  return simulateByDrivers(
    noWriteDs,
    {
      organizationId: 'org1',
      scenario,
      period: '2026',
      companies,
      indicators,
      baselineIVs,
      assumptions: assumptions as never,
    },
    { buildContext: h.buildContext, recomputeIndicator: h.recomputeIndicator },
  )
}

const row = (o: Partial<{ id: string; key: string; value: number; companyId: string | null }>) => ({
  id: 'a1', key: 'import_share', value: 0.5, companyId: null, sortOrder: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'), ...o,
})

describe('simulateByDrivers — per-company import share', () => {
  it('two companies stating different shares receive different cost shocks', async () => {
    const h = harness()
    await run(
      [
        row({ id: 'a1', value: 0.7, companyId: 'c1' }),
        row({ id: 'a2', value: 0.05, companyId: 'c2' }),
      ],
      h,
    )
    // cogs 600 × share × fx 0.2 added to cost → ebitda 200 − that.
    expect(h.seen.get('c1')?.ebitda).toBeCloseTo(200 - 600 * 0.7 * 0.2, 6)
    expect(h.seen.get('c2')?.ebitda).toBeCloseTo(200 - 600 * 0.05 * 0.2, 6)
    expect(h.seen.get('c1')?.ebitda).not.toBeCloseTo(h.seen.get('c2')!.ebitda!, 6)
  })

  it('a plan-level default applies to every company that has no override', async () => {
    const h = harness()
    await run([row({ value: 0.6, companyId: null })], h)
    for (const id of ['c1', 'c2']) {
      expect(h.seen.get(id)?.ebitda).toBeCloseTo(200 - 600 * 0.6 * 0.2, 6)
    }
  })

  it("a company override shadows the plan default for that company only", async () => {
    const h = harness()
    await run(
      [row({ id: 'a1', value: 0.6, companyId: null }), row({ id: 'a2', value: 0.9, companyId: 'c1' })],
      h,
    )
    expect(h.seen.get('c1')?.ebitda).toBeCloseTo(200 - 600 * 0.9 * 0.2, 6)
    expect(h.seen.get('c2')?.ebitda).toBeCloseTo(200 - 600 * 0.6 * 0.2, 6)
  })

  it("falls back to the scenario's literal when nothing is stated — the pre-16.6 result", async () => {
    const h = harness()
    await run([], h)
    for (const id of ['c1', 'c2']) {
      expect(h.seen.get(id)?.ebitda).toBeCloseTo(200 - 600 * 0.3 * 0.2, 6)
    }
  })

  it('omitting `assumptions` entirely behaves exactly as before', async () => {
    const h = harness()
    await simulateByDrivers(
      noWriteDs,
      { organizationId: 'org1', scenario: FX_SCENARIO, period: '2026', companies, indicators, baselineIVs },
      { buildContext: h.buildContext, recomputeIndicator: h.recomputeIndicator },
    )
    expect(h.seen.get('c1')?.ebitda).toBeCloseTo(200 - 600 * 0.3 * 0.2, 6)
  })

  it('measured imported cost beats a stated share', async () => {
    const h = harness({ importedInputCostByCompany: { c1: 100 } })
    await run([row({ value: 0.7, companyId: 'c1' })], h)
    // 100 × 0.2 = 20, not 600 × 0.7 × 0.2 = 84.
    expect(h.seen.get('c1')?.ebitda).toBeCloseTo(200 - 20, 6)
  })
})

describe('simulateByDrivers — the import-share report', () => {
  it('classifies every company by where its share came from', async () => {
    const h = harness({ importedInputCostByCompany: { c2: 100 } })
    const r = await run([row({ value: 0.7, companyId: 'c1' })], h)
    expect(r.importShare).toMatchObject({
      measured: ['EDEN'],
      fromAssumption: [{ companyCode: 'CPC', share: 0.7 }],
      fromCatalogDefault: [],
      catalogDefault: 0.3,
    })
  })

  it('names the companies still standing on the literal', async () => {
    const r = await run([])
    expect(r.importShare?.fromCatalogDefault).toEqual(['CPC', 'EDEN'])
    expect(r.importShare?.fromAssumption).toEqual([])
  })

  it('reports a rejected out-of-range assumption and does NOT use it', async () => {
    const h = harness()
    const r = await run([row({ value: 70, companyId: 'c1' })], h)
    expect(r.importShare?.rejected).toMatchObject([{ companyCode: 'CPC', value: 70 }])
    expect(r.importShare?.fromCatalogDefault).toContain('CPC')
    // The shock used 0.3, not 70 — a seventy-fold cost increase never happened.
    expect(h.seen.get('c1')?.ebitda).toBeCloseTo(200 - 600 * 0.3 * 0.2, 6)
  })

  it('is null for a scenario with no FX lever — the share modulates FX only', async () => {
    const r = await run([row({ value: 0.7, companyId: 'c1' })], harness(), {
      code: 'INPUT_COST_30',
      overrides: { shock: { inputCostShock: 0.3 } },
    })
    expect(r.importShare).toBeNull()
  })

  it('sorts its lists so the same scenario yields the same narrative every run', async () => {
    const r1 = await run([])
    const r2 = await run([])
    expect(r1.importShare?.fromCatalogDefault).toEqual(r2.importShare?.fromCatalogDefault)
    expect(r1.importShare?.fromCatalogDefault).toEqual([...(r1.importShare?.fromCatalogDefault ?? [])].sort())
  })
})
