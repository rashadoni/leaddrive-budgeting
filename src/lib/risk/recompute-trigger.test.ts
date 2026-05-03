/**
 * Tests for `recompute-trigger.ts` — orchestration layer extracted from
 * three near-identical inline copies (budget endpoint, staging apply,
 * batch CLI script). Mocks `recompute.ts` to avoid spinning up the full
 * formula pipeline; passes a hand-rolled fake PrismaClient that returns
 * canned company + indicator-definition rows.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./recompute', () => ({
  createPrismaDataSource: vi.fn(() => ({ __mock: 'datasource' })),
  recomputeIndicator: vi.fn(),
}));

import { runRecomputeForCompanies } from './recompute-trigger';
import { recomputeIndicator } from './recompute';

const mockedRecompute = vi.mocked(recomputeIndicator);

type Company = {
  id: string;
  code: string;
  industry: string | null;
  level: number | null;
  isActive: boolean;
  role: 'operational' | 'admin' | 'holding';
};

type IndicatorDefRow = {
  id: string;
  organizationId: string | null;
  code: string;
  formula: string;
  thresholds: unknown;
  requiredInputs: string[];
  industries: string[];
  isActive: boolean;
  unit: string | null;
};

function makePrisma(
  companies: Company[],
  indicators: IndicatorDefRow[],
  parentCompanies: Company[] = [],
): {
  company: { findMany: ReturnType<typeof vi.fn> };
  indicatorDefinition: { findMany: ReturnType<typeof vi.fn> };
} {
  // Sub-42 prereq #1 closure (parent-co recompute): findMany may be called
  // TWICE — once for affected ops (where.id.in is set), once for parents
  // (where.level === 1). Route by inspecting the where clause; tests that
  // don't pass parentCompanies get the legacy single-array behavior.
  return {
    company: {
      findMany: vi.fn().mockImplementation(
        async (
          arg: { where?: { level?: number; id?: { in?: string[] } } } = {},
        ) => {
          if (arg.where?.level === 1) return parentCompanies;
          return companies;
        },
      ),
    },
    indicatorDefinition: { findMany: vi.fn().mockResolvedValue(indicators) },
  };
}

function ind(overrides: Partial<IndicatorDefRow> = {}): IndicatorDefRow {
  return {
    id: 'i1',
    organizationId: null,
    code: 'HOSP_OCC',
    formula: 'rooms_sold / rooms_available * 100',
    thresholds: { green: { op: '>=', value: 70 } },
    requiredInputs: ['booking', 'company.settings.totalRooms'],
    industries: ['hospitality'],
    isActive: true,
    unit: '%',
    ...overrides,
  };
}

function co(overrides: Partial<Company> = {}): Company {
  return {
    id: 'co_1',
    code: 'HLTN',
    industry: 'hospitality',
    level: 2,
    isActive: true,
    role: 'operational',
    ...overrides,
  };
}

beforeEach(() => {
  mockedRecompute.mockReset();
});

describe('runRecomputeForCompanies', () => {
  it('returns empty result for empty affected list (no DB hit)', async () => {
    const prisma = makePrisma([co()], [ind()]);
    const result = await runRecomputeForCompanies(
      prisma as never,
      'org_1',
      [],
    );
    expect(result).toEqual({ ok: 0, unknown: 0, failed: 0, targets: 0 });
    expect(prisma.company.findMany).not.toHaveBeenCalled();
    expect(prisma.indicatorDefinition.findMany).not.toHaveBeenCalled();
  });

  it('single-company single-year: degenerates batch loop to one pair', async () => {
    const prisma = makePrisma([co()], [ind()]);
    mockedRecompute.mockResolvedValue({ ok: true, status: 'green', value: 75 });

    const result = await runRecomputeForCompanies(prisma as never, 'org_1', [
      { companyId: 'co_1', year: 2026 },
    ]);

    expect(result).toEqual({ ok: 1, unknown: 0, failed: 0, targets: 1 });
    expect(mockedRecompute).toHaveBeenCalledTimes(1);
    expect(mockedRecompute).toHaveBeenCalledWith(
      { __mock: 'datasource' },
      expect.objectContaining({
        organizationId: 'org_1',
        companyId: 'co_1',
        period: '2026',
      }),
    );
  });

  it('skips admin / holding cost-centres before fetching indicators', async () => {
    const prisma = makePrisma(
      [
        co({ id: 'co_1', code: 'HQ', role: 'admin' }),
        co({ id: 'co_2', code: 'TOP', role: 'holding' }),
      ],
      [ind()],
    );
    const result = await runRecomputeForCompanies(prisma as never, 'org_1', [
      { companyId: 'co_1', year: 2026 },
      { companyId: 'co_2', year: 2026 },
    ]);
    expect(result).toEqual({ ok: 0, unknown: 0, failed: 0, targets: 0 });
    expect(prisma.indicatorDefinition.findMany).not.toHaveBeenCalled();
    expect(mockedRecompute).not.toHaveBeenCalled();
  });

  it('counts unknown vs ok separately', async () => {
    const prisma = makePrisma([co()], [
      ind({ id: 'i1', code: 'A' }),
      ind({ id: 'i2', code: 'B' }),
    ]);
    mockedRecompute
      .mockResolvedValueOnce({ ok: true, status: 'green', value: 75 })
      .mockResolvedValueOnce({ ok: true, status: 'unknown', value: 0 });
    const result = await runRecomputeForCompanies(prisma as never, 'org_1', [
      { companyId: 'co_1', year: 2026 },
    ]);
    expect(result).toEqual({ ok: 1, unknown: 1, failed: 0, targets: 2 });
  });

  it('catches per-pair errors and increments `failed` (does not throw)', async () => {
    const prisma = makePrisma([co()], [
      ind({ id: 'i1', code: 'OK' }),
      ind({ id: 'i2', code: 'BAD' }),
    ]);
    mockedRecompute
      .mockResolvedValueOnce({ ok: true, status: 'green', value: 75 })
      .mockRejectedValueOnce(new Error('boom'));
    const errors: Array<[string, unknown]> = [];
    const result = await runRecomputeForCompanies(
      prisma as never,
      'org_1',
      [{ companyId: 'co_1', year: 2026 }],
      { pairError: (label, err) => errors.push([label, err]) },
    );
    expect(result).toEqual({ ok: 1, unknown: 0, failed: 1, targets: 2 });
    expect(errors).toHaveLength(1);
    expect(errors[0][0]).toBe('HLTN/BAD [2026]');
  });

  it('multi-year batch: a 2025-only company is recomputed under period="2025", not 2026', async () => {
    const prisma = makePrisma(
      [co({ id: 'co_1', code: 'A' }), co({ id: 'co_2', code: 'B' })],
      [ind()],
    );
    mockedRecompute.mockResolvedValue({ ok: true, status: 'green', value: 75 });

    await runRecomputeForCompanies(prisma as never, 'org_1', [
      { companyId: 'co_1', year: 2025 },
      { companyId: 'co_2', year: 2026 },
    ]);

    const calls = mockedRecompute.mock.calls.map((c) => ({
      companyId: c[1].companyId,
      period: c[1].period,
    }));
    expect(calls).toEqual([
      { companyId: 'co_1', period: '2025' },
      { companyId: 'co_2', period: '2026' },
    ]);
  });

  it('sector-agnostic indicators (industries=[]) match every operational company', async () => {
    const prisma = makePrisma(
      [
        co({ id: 'co_1', code: 'A', industry: 'hospitality' }),
        co({ id: 'co_2', code: 'B', industry: 'agro_crops' }),
      ],
      [ind({ id: 'fx', code: 'FX_IMPORTED_INPUT', industries: [] })],
    );
    mockedRecompute.mockResolvedValue({ ok: true, status: 'green', value: 50 });

    const result = await runRecomputeForCompanies(prisma as never, 'org_1', [
      { companyId: 'co_1', year: 2026 },
      { companyId: 'co_2', year: 2026 },
    ]);
    expect(result.targets).toBe(2);
    expect(mockedRecompute).toHaveBeenCalledTimes(2);
  });

  it('prefers org-scoped indicator over global with same code (Phase 7.A.0 contract)', async () => {
    const prisma = makePrisma(
      [co()],
      [
        ind({ id: 'global', organizationId: null, code: 'DUP', formula: 'g' }),
        ind({ id: 'org', organizationId: 'org_1', code: 'DUP', formula: 'o' }),
      ],
    );
    mockedRecompute.mockResolvedValue({ ok: true, status: 'green', value: 1 });

    await runRecomputeForCompanies(prisma as never, 'org_1', [
      { companyId: 'co_1', year: 2026 },
    ]);

    expect(mockedRecompute).toHaveBeenCalledTimes(1);
    expect(mockedRecompute.mock.calls[0][1].definition.id).toBe('org');
  });

  it('logger callbacks fire on the expected paths', async () => {
    const prisma = makePrisma([co()], [ind()]);
    mockedRecompute.mockResolvedValue({ ok: true, status: 'green', value: 75 });
    const log: string[] = [];
    await runRecomputeForCompanies(
      prisma as never,
      'org_1',
      [{ companyId: 'co_1', year: 2026 }],
      {
        start: (m) => log.push(`start:${m}`),
        done: (m) => log.push(`done:${m}`),
        noop: (m) => log.push(`noop:${m}`),
      },
    );
    expect(log.some((l) => l.startsWith('start:'))).toBe(true);
    expect(log.some((l) => l.startsWith('done:'))).toBe(true);
    expect(log.some((l) => l.startsWith('noop:'))).toBe(false);
  });

  it('logger noop fires when no operational companies are in the affected set', async () => {
    const prisma = makePrisma(
      [co({ id: 'co_1', role: 'admin' })],
      [ind()],
    );
    const noops: string[] = [];
    await runRecomputeForCompanies(
      prisma as never,
      'org_1',
      [{ companyId: 'co_1', year: 2026 }],
      { noop: (m) => noops.push(m) },
    );
    expect(noops).toHaveLength(1);
    expect(noops[0]).toMatch(/no operational/i);
  });

  // ─── Sub-42 prereq #1 — parent-co recompute for rollup() indicators ──────
  // Without these tests, the seed `IND_HOLDING_REVENUE` (formula:
  // `rollup("IND_REVENUE_TOTAL")`) would silently no-op forever — parent
  // cos (level=1) were excluded by the operational-only filter, so their
  // rollup IV was never created. This block locks the new opt-in path:
  // when ANY in-scope indicator carries `requiredInputs: ["rollup:..."]`,
  // the trigger ALSO fetches parent cos + matches them to the rollup-
  // bearing indicators only.

  describe('parent-co recompute for rollup() indicators (sub-42 prereq #1)', () => {
    it('does NOT fetch parent cos when no rollup-bearing indicators are in scope (cost-shape lock)', async () => {
      // Vanilla operational-only path — orgs without rollup indicators
      // pay zero extra DB cost. Parent-cos query MUST NOT fire.
      const prisma = makePrisma([co()], [ind()]); // ind() has no rollup: prefix
      mockedRecompute.mockResolvedValue({
        ok: true,
        status: 'green',
        value: 75,
      });

      await runRecomputeForCompanies(prisma as never, 'org_1', [
        { companyId: 'co_1', year: 2026 },
      ]);

      // Exactly ONE company.findMany call — for the affected ops, not
      // for parents. Locks "rollup-detection precedes parent fetch".
      expect(prisma.company.findMany).toHaveBeenCalledTimes(1);
      const arg = prisma.company.findMany.mock.calls[0][0] as {
        where?: { level?: number };
      };
      expect(arg.where?.level).toBeUndefined();
    });

    it('fetches parent cos AND adds (parent × rollupDef) targets when a rollup indicator is in scope', async () => {
      const rollupInd = ind({
        id: 'i_holding_rev',
        code: 'IND_HOLDING_REVENUE',
        formula: 'rollup("IND_REVENUE_TOTAL")',
        requiredInputs: ['rollup:IND_REVENUE_TOTAL'],
        industries: [], // sector-agnostic, mirrors the seed
      });
      const opCo = co({ id: 'co_op', code: 'AAC-MAIN' });
      const parentCo: Company = {
        id: 'co_holding',
        code: 'AAC',
        industry: null, // parent cos typically have no industry
        level: 1,
        isActive: true,
        role: 'holding',
      };

      const prisma = makePrisma([opCo], [rollupInd], [parentCo]);
      mockedRecompute.mockResolvedValue({
        ok: true,
        status: 'green',
        value: 1_000_000,
      });

      const result = await runRecomputeForCompanies(prisma as never, 'org_1', [
        { companyId: 'co_op', year: 2026 },
      ]);

      // 2 pairs: (op-co × rollupInd) + (parent-co × rollupInd). Op-co
      // gets the rollup too because the indicator's industries=[] makes
      // it sector-agnostic — that's a sub-42 architect Round-1 design
      // decision (don't filter rollup defs out of operational pass; they
      // resolve to 0 on op-cos with no children, which is correct).
      expect(result.targets).toBe(2);
      expect(result).toEqual({ ok: 2, unknown: 0, failed: 0, targets: 2 });

      // Parent-co fetch fired exactly once with the right where clause.
      const findManyCalls = prisma.company.findMany.mock.calls;
      const parentCall = findManyCalls.find(
        (c) =>
          (c[0] as { where?: { level?: number } })?.where?.level === 1,
      );
      expect(parentCall).toBeTruthy();
      expect((parentCall![0] as { where: object }).where).toMatchObject({
        organizationId: 'org_1',
        level: 1,
        isActive: true,
      });

      // Recompute called for both companies — extract the companyIds
      // passed to the engine.
      const recomputeCompanyIds = mockedRecompute.mock.calls.map(
        (c) => c[1].companyId,
      );
      expect(new Set(recomputeCompanyIds)).toEqual(
        new Set(['co_op', 'co_holding']),
      );
    });

    it('parent-cos receive ONLY rollup-bearing indicators, not the wider catalog', async () => {
      // Mixed catalog: 1 normal indicator + 1 rollup indicator. Parent
      // co MUST get only the rollup one (no industry → no operational
      // match either way; explicit lock against future drift).
      const normalInd = ind({
        id: 'i_norm',
        code: 'IND_NET_MARGIN',
        formula: 'net_income / revenue * 100',
        requiredInputs: ['budgetLine'],
        industries: ['industrial'],
      });
      const rollupInd = ind({
        id: 'i_roll',
        code: 'IND_HOLDING_REVENUE',
        formula: 'rollup("IND_REVENUE_TOTAL")',
        requiredInputs: ['rollup:IND_REVENUE_TOTAL'],
        industries: [],
      });
      const opCo = co({ id: 'co_op', code: 'AAC-MAIN', industry: 'industrial' });
      const parentCo: Company = {
        id: 'co_holding',
        code: 'AAC',
        industry: null,
        level: 1,
        isActive: true,
        role: 'holding',
      };
      const prisma = makePrisma([opCo], [normalInd, rollupInd], [parentCo]);
      mockedRecompute.mockResolvedValue({
        ok: true,
        status: 'green',
        value: 1,
      });

      await runRecomputeForCompanies(prisma as never, 'org_1', [
        { companyId: 'co_op', year: 2026 },
      ]);

      // Catalog: op-co gets BOTH (industrial match for normal + sector-
      // agnostic match for rollup). Parent-co gets ONLY rollup (industry
      // is null so industrial-match gate excludes normal even if we
      // tried to feed it through matchCompaniesToIndicators).
      const calls = mockedRecompute.mock.calls.map((c) => ({
        companyId: c[1].companyId,
        defCode: c[1].definition.code,
      }));
      expect(calls.length).toBe(3);
      const parentCalls = calls.filter((c) => c.companyId === 'co_holding');
      expect(parentCalls.map((c) => c.defCode)).toEqual([
        'IND_HOLDING_REVENUE',
      ]);
      const opCalls = calls.filter((c) => c.companyId === 'co_op');
      expect(new Set(opCalls.map((c) => c.defCode))).toEqual(
        new Set(['IND_NET_MARGIN', 'IND_HOLDING_REVENUE']),
      );
    });

    it('parent-co rollup fires for every year a child touched (year-scoping aligns with affected set)', async () => {
      // Two affected years (2025 + 2026) → parent-co rollup runs twice
      // (once per year), independent of which sub-cos appeared in the
      // affected set for that year. Locks the year-scoping invariant.
      const rollupInd = ind({
        id: 'i_roll',
        code: 'IND_HOLDING_REVENUE',
        formula: 'rollup("IND_REVENUE_TOTAL")',
        requiredInputs: ['rollup:IND_REVENUE_TOTAL'],
        industries: [],
      });
      const opA = co({ id: 'co_a', code: 'A', industry: 'industrial' });
      const opB = co({ id: 'co_b', code: 'B', industry: 'industrial' });
      const parentCo: Company = {
        id: 'co_holding',
        code: 'TOP',
        industry: null,
        level: 1,
        isActive: true,
        role: 'holding',
      };
      const prisma = makePrisma([opA, opB], [rollupInd], [parentCo]);
      mockedRecompute.mockResolvedValue({
        ok: true,
        status: 'green',
        value: 1,
      });

      await runRecomputeForCompanies(prisma as never, 'org_1', [
        { companyId: 'co_a', year: 2025 },
        { companyId: 'co_b', year: 2026 },
      ]);

      const parentCallPeriods = mockedRecompute.mock.calls
        .filter((c) => c[1].companyId === 'co_holding')
        .map((c) => c[1].period)
        .sort();
      // Parent fires for BOTH years even though each was triggered by a
      // different child — the parent's rollup at 2025 is now stale because
      // co_a wrote 2025; the parent's 2026 is stale because co_b wrote 2026.
      expect(parentCallPeriods).toEqual(['2025', '2026']);
    });

    it('parent-co fetch is skipped when rollup indicator exists but parent-co list is empty (no parents in org)', async () => {
      const rollupInd = ind({
        id: 'i_roll',
        requiredInputs: ['rollup:IND_REVENUE_TOTAL'],
        industries: [],
      });
      // Empty parentCompanies — flat-org case (no level=1 cos).
      const prisma = makePrisma([co()], [rollupInd], []);
      mockedRecompute.mockResolvedValue({
        ok: true,
        status: 'green',
        value: 1,
      });

      const result = await runRecomputeForCompanies(prisma as never, 'org_1', [
        { companyId: 'co_1', year: 2026 },
      ]);

      // Only the op-co × rollupInd pair. No parent-targets added.
      expect(result.targets).toBe(1);
      // Parent-co fetch DID fire (we don't know in advance the org has no
      // parents) — proves the conditional gates on rollupDefs.length > 0,
      // not on parent-presence.
      expect(prisma.company.findMany).toHaveBeenCalledTimes(2);
    });

    it('logger.start message includes parent-co + rollup-indicator count when present', async () => {
      const rollupInd = ind({
        id: 'i_roll',
        requiredInputs: ['rollup:IND_REVENUE_TOTAL'],
        industries: [],
      });
      const parentCo: Company = {
        id: 'co_p',
        code: 'P',
        industry: null,
        level: 1,
        isActive: true,
        role: 'holding',
      };
      const prisma = makePrisma([co()], [rollupInd], [parentCo]);
      mockedRecompute.mockResolvedValue({
        ok: true,
        status: 'green',
        value: 1,
      });
      const log: string[] = [];

      await runRecomputeForCompanies(
        prisma as never,
        'org_1',
        [{ companyId: 'co_1', year: 2026 }],
        { start: (m) => log.push(m) },
      );

      // Message surfaces "incl. 1 parent × 1 rollup-bearing indicator"
      // — operators reading logs can see at a glance that parent-co
      // recompute fired without grepping for company codes.
      expect(log).toHaveLength(1);
      expect(log[0]).toMatch(/incl\. 1 parent × 1 rollup-bearing indicator/);
    });
  });
});
