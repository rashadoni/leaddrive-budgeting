/**
 * Phase 11.86 — the batch trigger stamps lineage per pair, or not at all.
 *
 * Before this change `runRecomputeForCompanies` refused lineage categorically:
 * it never passed `revisionId`, so the canonical writer cleared the column on
 * every write and production carried 6,460 observations with 0 lineage. The
 * refusal's stated blocker was a missing per-indicator dependency manifest.
 * `IndicatorDefinition.requiredInputs` is that manifest, and these tests pin
 * what it is now allowed to buy — and, mostly, what it still is not.
 *
 * Every case below fails against the pre-change trigger: without the
 * `options.lineage` parameter the first test cannot stamp anything, and the
 * rest assert the withholding is a RULE rather than the old blanket refusal
 * (they pass trivially before the change, and would fail the moment the rule
 * is loosened to "the import ran, so stamp everything").
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./recompute', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./recompute')>();
  return {
    ...actual,
    createPrismaDataSource: vi.fn(() => ({ __mock: 'datasource' })),
    recomputeIndicator: vi.fn(),
  };
});

import { runRecomputeForCompanies } from './recompute-trigger';
import { recomputeIndicator } from './recompute';
import type { ImportLineage } from './lineage-coverage';

const mockedRecompute = vi.mocked(recomputeIndicator);

type Company = {
  id: string;
  code: string;
  industry: string | null;
  level: number | null;
  isActive: boolean;
  role: 'operational' | 'admin' | 'holding';
};

function co(overrides: Partial<Company> = {}): Company {
  return {
    id: 'co_1',
    code: 'AZSEKER-CPC',
    industry: 'agriculture',
    level: 2,
    isActive: true,
    role: 'operational',
    ...overrides,
  };
}

function ind(code: string, requiredInputs: string[]) {
  return {
    id: `def_${code}`,
    organizationId: null,
    code,
    formula: 'revenue',
    sparklineFormula: null,
    thresholds: { green: { op: '>=', value: 0 } },
    requiredInputs,
    industries: [] as string[],
    isActive: true,
    unit: 'AZN',
    defaultValueSource: 'computed',
    aggregation: 'flow',
  };
}

function makePrisma(companies: Company[], indicators: ReturnType<typeof ind>[]) {
  return {
    company: {
      findMany: vi.fn(async (arg: { where?: { level?: number } } = {}) =>
        arg.where?.level === 1 ? [] : companies,
      ),
    },
    indicatorDefinition: { findMany: vi.fn(async () => indicators) },
    companyIndicator: { findMany: vi.fn(async () => []) },
  };
}

/** Revision ids the trigger passed, keyed `CODE@period`. */
function stampsByPair(): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  for (const call of mockedRecompute.mock.calls) {
    const args = call[1] as {
      definition: { code: string };
      period: string;
      revisionId?: string;
    };
    out.set(`${args.definition.code}@${args.period}`, args.revisionId);
  }
  return out;
}

const LINEAGE: ImportLineage = {
  revisionId: 'rev_import_1',
  periodFrom: '2026-01',
  periodTo: '2026-12',
  coverageByCompanyId: new Map([['co_1', new Set(['budgetLine'] as const)]]),
};

beforeEach(() => {
  mockedRecompute.mockReset();
  mockedRecompute.mockResolvedValue({ status: 'green', value: 1 } as never);
});

describe('runRecomputeForCompanies — import lineage', () => {
  it('stamps a workbook-only indicator and refuses everything else in the same run', async () => {
    const prisma = makePrisma(
      [co()],
      [
        ind('IND_REVENUE_TOTAL', ['budgetLine']),
        ind('AGRO_SUGAR_PRICE_TREND', ['commodityPrice:sugar_price_latest']),
        ind('FP_GRAIN_COST_BLEND', ['budgetLine', 'commodityPrice:wheat_price_latest']),
        ind('IND_GOV_CLIMATE_SCORE', []),
        ind('AGRO_YIELD', ['budgetLine', 'company.settings.hectaresPlanted']),
      ],
    );

    const result = await runRecomputeForCompanies(
      prisma as never,
      'org_1',
      [{ companyId: 'co_1', year: 2026 }],
      {},
      { lineage: LINEAGE },
    );

    const stamps = stampsByPair();
    // The one indicator whose ENTIRE declared input set is workbook data the
    // run wrote clean-slate.
    expect(stamps.get('IND_REVENUE_TOTAL@2026')).toBe('rev_import_1');
    // A pure feed — not the client's data at all.
    expect(stamps.get('AGRO_SUGAR_PRICE_TREND@2026')).toBeUndefined();
    // One foreign input is enough. "Mostly from the workbook" earns nothing.
    expect(stamps.get('FP_GRAIN_COST_BLEND@2026')).toBeUndefined();
    // A literal has no source state.
    expect(stamps.get('IND_GOV_CLIMATE_SCORE@2026')).toBeUndefined();
    // A manual Company.settings value the import never wrote.
    expect(stamps.get('AGRO_YIELD@2026')).toBeUndefined();

    expect(result.traced).toBe(1);
    expect(result.ok).toBe(5);
  });

  it('stamps every period the revision spans, including the FY key', async () => {
    // `'2026' < '2026-01'` lexically, so a string range check would drop the
    // exact period the HeatMap reads.
    const prisma = makePrisma([co()], [ind('IND_REVENUE_TOTAL', ['budgetLine'])]);

    const result = await runRecomputeForCompanies(
      prisma as never,
      'org_1',
      [{ companyId: 'co_1', year: 2026 }],
      {},
      { lineage: LINEAGE, granularity: 'year+quarter+month' },
    );

    const stamps = stampsByPair();
    expect(stamps.get('IND_REVENUE_TOTAL@2026')).toBe('rev_import_1');
    expect(stamps.get('IND_REVENUE_TOTAL@2026-Q2')).toBe('rev_import_1');
    expect(stamps.get('IND_REVENUE_TOTAL@2026-07')).toBe('rev_import_1');
    expect(result.traced).toBe(17);
  });

  it('refuses a year the revision does not cover, even for a covered company', async () => {
    const prisma = makePrisma([co()], [ind('IND_REVENUE_TOTAL', ['budgetLine'])]);

    const result = await runRecomputeForCompanies(
      prisma as never,
      'org_1',
      // A 2025 refresh riding along on a 2026 import's lineage.
      [{ companyId: 'co_1', year: 2025 }],
      {},
      { lineage: LINEAGE },
    );

    expect(stampsByPair().get('IND_REVENUE_TOTAL@2025')).toBeUndefined();
    expect(result.traced).toBe(0);
  });

  it('refuses a sibling company the import did not write', async () => {
    const prisma = makePrisma(
      [co(), co({ id: 'co_2', code: 'AZSEKER-SAF' })],
      [ind('IND_REVENUE_TOTAL', ['budgetLine'])],
    );

    const result = await runRecomputeForCompanies(
      prisma as never,
      'org_1',
      [
        { companyId: 'co_1', year: 2026 },
        { companyId: 'co_2', year: 2026 },
      ],
      {},
      { lineage: LINEAGE },
    );

    const perCompany = new Map(
      mockedRecompute.mock.calls.map((c) => {
        const a = c[1] as { companyId: string; revisionId?: string };
        return [a.companyId, a.revisionId];
      }),
    );
    expect(perCompany.get('co_1')).toBe('rev_import_1');
    expect(perCompany.get('co_2')).toBeUndefined();
    expect(result.traced).toBe(1);
  });

  it('refuses a balance-sheet indicator when the run only wrote that company a P&L', async () => {
    // Per-company coverage, not per-run: a sibling's balance sheet in the same
    // upload proves nothing about this company's.
    const prisma = makePrisma(
      [co()],
      [ind('IND_INVENTORY_TURNOVER', ['budgetLine.cogs', 'balanceSheetLine.inventory'])],
    );

    const result = await runRecomputeForCompanies(
      prisma as never,
      'org_1',
      [{ companyId: 'co_1', year: 2026 }],
      {},
      { lineage: LINEAGE },
    );

    expect(stampsByPair().get('IND_INVENTORY_TURNOVER@2026')).toBeUndefined();
    expect(result.traced).toBe(0);
  });

  it('stamps that same indicator once the run also wrote the balance sheet', async () => {
    const prisma = makePrisma(
      [co()],
      [ind('IND_INVENTORY_TURNOVER', ['budgetLine.cogs', 'balanceSheetLine.inventory'])],
    );

    const result = await runRecomputeForCompanies(
      prisma as never,
      'org_1',
      [{ companyId: 'co_1', year: 2026 }],
      {},
      {
        lineage: {
          ...LINEAGE,
          coverageByCompanyId: new Map([
            ['co_1', new Set(['budgetLine', 'balanceSheetLine'] as const)],
          ]),
        },
      },
    );

    expect(stampsByPair().get('IND_INVENTORY_TURNOVER@2026')).toBe('rev_import_1');
    expect(result.traced).toBe(1);
  });

  it('passes no revision at all when the caller supplies no lineage', async () => {
    // The pre-existing behaviour, preserved byte-for-byte: every legacy caller
    // (cron feeds refresh, UI drill-down, backfill scripts) stays untraced, and
    // the canonical writer therefore CLEARS any stale pointer rather than
    // carrying it onto a value it cannot vouch for.
    const prisma = makePrisma([co()], [ind('IND_REVENUE_TOTAL', ['budgetLine'])]);

    const result = await runRecomputeForCompanies(
      prisma as never,
      'org_1',
      [{ companyId: 'co_1', year: 2026 }],
    );

    const args = mockedRecompute.mock.calls[0][1] as { revisionId?: string };
    expect(args.revisionId).toBeUndefined();
    expect(result.traced).toBe(0);
  });
});
