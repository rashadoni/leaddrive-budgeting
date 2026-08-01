/**
 * Tests for `recompute-trigger.ts` — orchestration layer extracted from
 * three near-identical inline copies (budget endpoint, staging apply,
 * batch CLI script). Mocks `recompute.ts` to avoid spinning up the full
 * formula pipeline; passes a hand-rolled fake PrismaClient that returns
 * canned company + indicator-definition rows.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Sub-44 prereq #2 — partial mock with importOriginal: targets.ts now
// imports `ROLLUP_INPUT_PREFIX` from ./recompute (sub-44 prereq #1
// architect closure). A fully-stubbed module would drop the constant
// and crash isRollupIndicator at runtime. Spread the real exports +
// override only the two we want to stub.
vi.mock('./recompute', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./recompute')>();
  return {
    ...actual,
    createPrismaDataSource: vi.fn(() => ({ __mock: 'datasource' })),
    recomputeIndicator: vi.fn(),
  };
});

import { runRecomputeForCompanies, expandYearPeriods } from './recompute-trigger';
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
  assignments: Array<{
    companyId: string;
    indicatorId: string;
    enabled: boolean;
  }> = [],
): {
  company: { findMany: ReturnType<typeof vi.fn> };
  indicatorDefinition: { findMany: ReturnType<typeof vi.fn> };
  companyIndicator: { findMany: ReturnType<typeof vi.fn> };
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
    companyIndicator: { findMany: vi.fn().mockResolvedValue(assignments) },
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
    // Phase 7.G Turn IX (v3.4) — alertEvents required not optional;
    // EMPTY_RESULT short-circuit returns zero-shape via spread.
    expect(result).toEqual({
      ok: 0,
      unknown: 0,
      failed: 0,
      targets: 0,
      traced: 0,
      alertEvents: {
        periodsPersisted: 0,
        totalCreated: 0,
        totalDeleted: 0,
        failed: 0,
      },
    });
    expect(prisma.company.findMany).not.toHaveBeenCalled();
    expect(prisma.indicatorDefinition.findMany).not.toHaveBeenCalled();
  });

  it('single-company single-year: degenerates batch loop to one pair', async () => {
    const prisma = makePrisma([co()], [ind()]);
    mockedRecompute.mockResolvedValue({ ok: true, status: 'green', value: 75 });

    const result = await runRecomputeForCompanies(prisma as never, 'org_1', [
      { companyId: 'co_1', year: 2026 },
    ]);

    // Phase 7.E C6 v3.1 — `alertEvents` field on the result. v3.4 made it
    // required (Turn IX); this test still uses `toMatchObject` because the
    // success path computes a non-trivial `alertEvents` shape that this
    // test isn't asserting. Dedicated alertEvents-shape coverage lives in
    // the `alert-event persistence wire-in` describe block below.
    expect(result).toMatchObject({ ok: 1, unknown: 0, failed: 0, targets: 1 });
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
    // Phase 7.G Turn IX (v3.4) — alertEvents required not optional;
    // EMPTY_RESULT short-circuit returns zero-shape via spread.
    expect(result).toEqual({
      ok: 0,
      unknown: 0,
      failed: 0,
      targets: 0,
      traced: 0,
      alertEvents: {
        periodsPersisted: 0,
        totalCreated: 0,
        totalDeleted: 0,
        failed: 0,
      },
    });
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
    expect(result).toMatchObject({ ok: 1, unknown: 1, failed: 0, targets: 2 });
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
    expect(result).toMatchObject({ ok: 1, unknown: 0, failed: 1, targets: 2 });
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

  it('recomputes an explicitly enabled cross-industry CompanyIndicator pair', async () => {
    const crossIndustry = ind({
      id: 'retail_only',
      code: 'RET_FOOD_CPI',
      industries: ['retail'],
    });
    const prisma = makePrisma(
      [co({ id: 'co_1', industry: 'hospitality' })],
      [crossIndustry],
      [],
      [
        {
          companyId: 'co_1',
          indicatorId: crossIndustry.id,
          enabled: true,
        },
      ],
    );
    mockedRecompute.mockResolvedValue({ ok: true, status: 'green', value: 1 });

    const result = await runRecomputeForCompanies(prisma as never, 'org_1', [
      { companyId: 'co_1', year: 2026 },
    ]);

    expect(result.targets).toBe(1);
    expect(mockedRecompute).toHaveBeenCalledTimes(1);
    // The definition query must not discard cross-industry definitions before
    // CompanyIndicator gets a chance to enable the pair.
    expect(
      prisma.indicatorDefinition.findMany.mock.calls[0]?.[0]?.where,
    ).not.toHaveProperty('AND');
  });

  it('does not recompute an explicitly disabled taxonomy-matching pair', async () => {
    const matching = ind({ id: 'hosp', industries: ['hospitality'] });
    const prisma = makePrisma(
      [co({ id: 'co_1', industry: 'hospitality' })],
      [matching],
      [],
      [{ companyId: 'co_1', indicatorId: matching.id, enabled: false }],
    );

    const result = await runRecomputeForCompanies(prisma as never, 'org_1', [
      { companyId: 'co_1', year: 2026 },
    ]);

    expect(result.targets).toBe(0);
    expect(mockedRecompute).not.toHaveBeenCalled();
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

      // rollup() is structurally parent-only. The op-co supplies source IVs
      // to the formula but must not receive its own zero-child rollup IV.
      expect(result.targets).toBe(1);
      expect(result).toMatchObject({ ok: 1, unknown: 0, failed: 0, targets: 1 });

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

      // Recompute is called only for the parent target.
      const recomputeCompanyIds = mockedRecompute.mock.calls.map(
        (c) => c[1].companyId,
      );
      expect(recomputeCompanyIds).toEqual(['co_holding']);
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

      // Catalog is level-partitioned: op-co gets the normal definition;
      // parent-co gets only the rollup definition.
      const calls = mockedRecompute.mock.calls.map((c) => ({
        companyId: c[1].companyId,
        defCode: c[1].definition.code,
      }));
      expect(calls.length).toBe(2);
      const parentCalls = calls.filter((c) => c.companyId === 'co_holding');
      expect(parentCalls.map((c) => c.defCode)).toEqual([
        'IND_HOLDING_REVENUE',
      ]);
      const opCalls = calls.filter((c) => c.companyId === 'co_op');
      expect(opCalls.map((c) => c.defCode)).toEqual(['IND_NET_MARGIN']);
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

    it('returns no targets when a rollup indicator exists but the org has no parent company', async () => {
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

      // No parent exists, and a leaf cannot receive a rollup definition.
      expect(result.targets).toBe(0);
      // Parent-co fetch DID fire (we don't know in advance the org has no
      // parents) — proves the conditional gates on rollupDefs.length > 0,
      // not on parent-presence.
      expect(prisma.company.findMany).toHaveBeenCalledTimes(2);
    });

    it("sub-44 cont'd: rollup-bearing def with non-empty industries dropped from parent pass + warns (industries-empty guard)", async () => {
      // Sub-44 architect 💡 closure runtime layer: rollup-bearing seeds
      // MUST be sector-agnostic (industries: []). Seed-author validation
      // (validateRollupSeed) is the strict layer-up; this test locks the
      // belt-and-braces runtime defense — if a sector-restricted rollup
      // ever slips past the seed loader, the trigger drops it from the
      // parent pass + emits a warning so ops can fix the seed.
      const goodRollup = ind({
        id: 'i_good',
        code: 'IND_HOLDING_REVENUE',
        formula: 'rollup("IND_REVENUE_TOTAL")',
        requiredInputs: ['rollup:IND_REVENUE_TOTAL'],
        industries: [], // canonical shape
      });
      const badRollup = ind({
        id: 'i_bad',
        code: 'IND_BAD_SECTOR_ROLLUP',
        formula: 'rollup("IND_X")',
        requiredInputs: ['rollup:IND_X'],
        industries: ['hospitality'], // ⚠️ sector-restricted rollup
      });
      const parentCo: Company = {
        id: 'co_p',
        code: 'P',
        industry: null,
        level: 1,
        isActive: true,
        role: 'holding',
      };
      const prisma = makePrisma([co()], [goodRollup, badRollup], [parentCo]);
      mockedRecompute.mockResolvedValue({
        ok: true,
        status: 'green',
        value: 1,
      });
      const errors: Array<[string, unknown]> = [];

      await runRecomputeForCompanies(
        prisma as never,
        'org_1',
        [{ companyId: 'co_1', year: 2026 }],
        { pairError: (label, err) => errors.push([label, err]) },
      );

      // Bad rollup dropped from parent pass — only good one fires for
      // the parent.
      const parentRecomputeCodes = mockedRecompute.mock.calls
        .filter((c) => c[1].companyId === 'co_p')
        .map((c) => c[1].definition.code);
      expect(parentRecomputeCodes).toEqual(['IND_HOLDING_REVENUE']);
      expect(parentRecomputeCodes).not.toContain('IND_BAD_SECTOR_ROLLUP');

      // Warning surfaced via pairError logger (defensive ops visibility).
      const warnLabels = errors.map(([label]) => label);
      expect(warnLabels.some((l) => l.startsWith('rollup-skip/'))).toBe(true);
      const warnLabel = warnLabels.find((l) => l.startsWith('rollup-skip/'));
      expect(warnLabel).toContain('IND_BAD_SECTOR_ROLLUP');
      const warnErr = errors.find(([label]) =>
        label.startsWith('rollup-skip/'),
      )?.[1];
      expect(warnErr).toBeInstanceOf(Error);
      expect((warnErr as Error).message).toContain('hospitality');
      expect((warnErr as Error).message).toContain('sector-restricted');
    });

    it('parent-co rollup respects options.codeFilter narrowing (ind catalog filter applies to both branches)', async () => {
      // Sub-44 prereq #2 cont'd — the codeFilter option should apply
      // EQUALLY to operational + parent-co recompute paths. If the
      // filter were applied AFTER rollup-detection, the parent fetch
      // would silently include codes the user explicitly excluded.
      const rollupIndA = ind({
        id: 'i_roll_a',
        code: 'IND_HOLDING_REVENUE',
        formula: 'rollup("IND_REVENUE_TOTAL")',
        requiredInputs: ['rollup:IND_REVENUE_TOTAL'],
        industries: [],
      });
      const rollupIndB = ind({
        id: 'i_roll_b',
        code: 'IND_HOLDING_OPEX',
        formula: 'rollup("IND_OPEX_TOTAL")',
        requiredInputs: ['rollup:IND_OPEX_TOTAL'],
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
      const prisma = makePrisma([co()], [rollupIndA, rollupIndB], [parentCo]);
      // ⚠️ Override the indicatorDefinition mock to honor the where
      // clause (the default mockResolvedValue ignores it). We need the
      // filter to actually narrow.
      prisma.indicatorDefinition.findMany.mockImplementation(
        async (arg: { where?: { code?: { in?: string[] } } } = {}) => {
          const codeFilter = arg.where?.code?.in;
          if (codeFilter && codeFilter.length > 0) {
            return [rollupIndA, rollupIndB].filter((d) =>
              codeFilter.includes(d.code),
            );
          }
          return [rollupIndA, rollupIndB];
        },
      );
      mockedRecompute.mockResolvedValue({
        ok: true,
        status: 'green',
        value: 1,
      });

      // Scope only IND_HOLDING_REVENUE — IND_HOLDING_OPEX must NOT fire.
      await runRecomputeForCompanies(
        prisma as never,
        'org_1',
        [{ companyId: 'co_1', year: 2026 }],
        {},
        { codeFilter: ['IND_HOLDING_REVENUE'] },
      );

      const recomputedCodes = mockedRecompute.mock.calls.map(
        (c) => c[1].definition.code,
      );
      expect(new Set(recomputedCodes)).toEqual(
        new Set(['IND_HOLDING_REVENUE']),
      );
      expect(recomputedCodes).not.toContain('IND_HOLDING_OPEX');
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

  // ─── Sub-44 prereq #2 cont'd — options.codeFilter ───────────────────────
  // Plumbs the script's --codes filter into prisma.indicatorDefinition.
  // findMany.where.code.in. Empty/undefined = no filter (back-compat).
  // Validated through the prisma findMany mock to assert the where shape.

  describe('options.codeFilter (sub-44 prereq #2 cont\'d)', () => {
    it('omitting options.codeFilter does NOT add code filter (back-compat)', async () => {
      const prisma = makePrisma([co()], [ind()]);
      mockedRecompute.mockResolvedValue({
        ok: true,
        status: 'green',
        value: 75,
      });

      await runRecomputeForCompanies(prisma as never, 'org_1', [
        { companyId: 'co_1', year: 2026 },
      ]);

      const arg = prisma.indicatorDefinition.findMany.mock.calls[0][0] as {
        where?: { code?: unknown };
      };
      expect(arg.where?.code).toBeUndefined();
    });

    it('empty codeFilter array does NOT add code filter (treat as no-filter)', async () => {
      const prisma = makePrisma([co()], [ind()]);
      mockedRecompute.mockResolvedValue({
        ok: true,
        status: 'green',
        value: 75,
      });

      await runRecomputeForCompanies(
        prisma as never,
        'org_1',
        [{ companyId: 'co_1', year: 2026 }],
        {},
        { codeFilter: [] },
      );

      const arg = prisma.indicatorDefinition.findMany.mock.calls[0][0] as {
        where?: { code?: unknown };
      };
      expect(arg.where?.code).toBeUndefined();
    });

    it('non-empty codeFilter adds where.code.in with deduped values', async () => {
      const prisma = makePrisma([co()], [ind()]);
      mockedRecompute.mockResolvedValue({
        ok: true,
        status: 'green',
        value: 75,
      });

      await runRecomputeForCompanies(
        prisma as never,
        'org_1',
        [{ companyId: 'co_1', year: 2026 }],
        {},
        // Duplicate IND_NET_MARGIN entry should be deduped — Postgres
        // accepts duplicates in `IN (...)` but it's silly + harmless to
        // send. Lock the dedupe semantic.
        { codeFilter: ['IND_NET_MARGIN', 'IND_GROSS_MARGIN', 'IND_NET_MARGIN'] },
      );

      const arg = prisma.indicatorDefinition.findMany.mock.calls[0][0] as {
        where?: { code?: { in?: string[] } };
      };
      expect(arg.where?.code).toBeDefined();
      expect(arg.where!.code!.in).toBeDefined();
      // Sort for deterministic comparison — Set→Array order isn't
      // guaranteed across Node versions but the filter content is.
      expect([...arg.where!.code!.in!].sort()).toEqual([
        'IND_GROSS_MARGIN',
        'IND_NET_MARGIN',
      ]);
    });

    it('codeFilter narrows fetched defs (end-to-end via mock honoring where.code.in)', async () => {
      const indA = ind({ id: 'a', code: 'IND_A' });
      const indB = ind({ id: 'b', code: 'IND_B' });
      const prisma = makePrisma([co()], [indA, indB]);
      // Override findMany to honor the filter so the test can assert
      // recompute fires on the narrowed set only.
      prisma.indicatorDefinition.findMany.mockImplementation(
        async (arg: { where?: { code?: { in?: string[] } } } = {}) => {
          const filter = arg.where?.code?.in;
          if (filter && filter.length > 0) {
            return [indA, indB].filter((d) => filter.includes(d.code));
          }
          return [indA, indB];
        },
      );
      mockedRecompute.mockResolvedValue({
        ok: true,
        status: 'green',
        value: 1,
      });

      await runRecomputeForCompanies(
        prisma as never,
        'org_1',
        [{ companyId: 'co_1', year: 2026 }],
        {},
        { codeFilter: ['IND_A'] },
      );

      const recomputedCodes = mockedRecompute.mock.calls.map(
        (c) => c[1].definition.code,
      );
      expect(recomputedCodes).toEqual(['IND_A']);
      expect(recomputedCodes).not.toContain('IND_B');
    });
  });

  // Phase 7.E C6 v3.1 (Turn IV) — alert-event persistence wire-in.
  describe('alert-event persistence wire-in', () => {
    it('result includes alertEvents shape after a successful recompute pass', async () => {
      const prisma = makePrisma([co()], [ind()]);
      mockedRecompute.mockResolvedValue({
        ok: true,
        status: 'green',
        value: 75,
      });

      const result = await runRecomputeForCompanies(prisma as never, 'org_1', [
        { companyId: 'co_1', year: 2026 },
      ]);

      expect(result.alertEvents).toBeDefined();
      // The trigger test mock doesn't stub Organization.findUnique /
      // IndicatorValue.findMany / $transaction — the helper's per-period
      // catch fires, surfacing 1 failed period and 0 persisted. The
      // wire-in IS invoked (proof: alertEvents exists on the result).
      expect(result.alertEvents).toMatchObject({
        periodsPersisted: expect.any(Number),
        totalCreated: 0,
        failed: expect.any(Number),
      });
    });

    it('alertPersistError fires per-period with explicit-reject stub (not mock-incompleteness side-effect)', async () => {
      // Architect Turn-IV ⚠️ #2 closure: stub a known reject so the test
      // pins the intended behavior (per-period catch) rather than the
      // surface of mock-incompleteness fetch ordering.
      const prisma = makePrisma([co()], [ind()]);
      // Inject organization.findUnique that throws a controlled error —
      // helper calls this first (period-independent fetch) so the helper's
      // outer try/catch fires once per period.
      const stubError = new Error('test-controlled: org settings unavailable');
      (prisma as unknown as {
        organization: { findUnique: ReturnType<typeof vi.fn> };
      }).organization = {
        findUnique: vi.fn().mockRejectedValue(stubError),
      };
      mockedRecompute.mockResolvedValue({
        ok: true,
        status: 'green',
        value: 75,
      });
      const persistErrors: Array<{ period: string; msg: string }> = [];

      await runRecomputeForCompanies(
        prisma as never,
        'org_1',
        [{ companyId: 'co_1', year: 2026 }],
        {
          alertPersistError: (period, err) =>
            persistErrors.push({
              period,
              msg: (err as Error).message ?? String(err),
            }),
        },
      );

      // organization.findUnique fires first in the helper (period-
      // independent), throws -> caught by trigger's outer catch -> emits
      // ONE init-sentinel error (architect ⚠️ #1 closure: NOT per-year).
      expect(persistErrors).toEqual([
        { period: '__init__', msg: 'test-controlled: org settings unavailable' },
      ]);
    });
  });

  describe('B5 lineage safety boundary', () => {
    it('batch recompute leaves every row untraced', async () => {
      const prisma = makePrisma([co()], [ind()]);
      mockedRecompute.mockResolvedValue({ ok: true, status: 'green', value: 75 });

      await runRecomputeForCompanies(prisma as never, 'org_1', [
        { companyId: 'co_1', year: 2026 },
      ]);

      // The batch has no per-indicator dependency manifest, so every caller
      // writes `revisionId = null`. A row that cannot name its complete source
      // set is honestly untraced and stays Provisional.
      expect(mockedRecompute).toHaveBeenCalled();
      for (const call of mockedRecompute.mock.calls) {
        expect(call[1].revisionId).toBeUndefined();
      }
    });

    it('ignores a legacy blanket revisionId even if an untyped caller sends one', async () => {
      const prisma = makePrisma(
        [co()],
        [
          ind({
            id: 'i_budget',
            code: 'BUDGET_ONLY',
            requiredInputs: ['budgetLine:revenue'],
          }),
          ind({
            id: 'i_mixed',
            code: 'MIXED_INPUTS',
            requiredInputs: ['budgetLine:revenue', 'commodityPrice:sugar'],
          }),
        ],
      );
      mockedRecompute.mockResolvedValue({ ok: true, status: 'green', value: 75 });

      await runRecomputeForCompanies(
        prisma as never,
        'org_1',
        [{ companyId: 'co_1', year: 2026 }],
        {},
        { revisionId: 'rev_1' } as never,
      );

      expect(mockedRecompute).toHaveBeenCalledTimes(2);
      for (const call of mockedRecompute.mock.calls) {
        expect(call[1].revisionId).toBeUndefined();
        expect(call[1].organizationId).toBe('org_1');
      }
    });

    it('ignores a legacy explicit-null batch option too', async () => {
      const prisma = makePrisma([co()], [ind()]);
      mockedRecompute.mockResolvedValue({ ok: true, status: 'green', value: 75 });

      await runRecomputeForCompanies(
        prisma as never,
        'org_1',
        [{ companyId: 'co_1', year: 2026 }],
        {},
        { revisionId: null } as never,
      );

      for (const call of mockedRecompute.mock.calls) {
        expect(call[1].revisionId).toBeUndefined();
      }
    });

    it('never traces a parent rollup to the importing company\'s revision', async () => {
      // A rollup aggregates N children; a revision raised by importing ONE of
      // them names that one child. Stamping it on the parent would have the
      // holding cite a source that explains a fraction of its own number.
      const parent = co({ id: 'co_parent', code: 'HOLD', level: 1, industry: null });
      const child = co({ id: 'co_1', code: 'CHILD' });
      const rollupInd = ind({
        id: 'i_rollup',
        code: 'IND_HOLDING_REVENUE',
        formula: 'rollup("IND_REVENUE_TOTAL")',
        requiredInputs: ['rollup:IND_REVENUE_TOTAL'],
        industries: [],
      });
      const prisma = makePrisma([child], [rollupInd], [parent]);
      mockedRecompute.mockResolvedValue({ ok: true, status: 'green', value: 75 });

      await runRecomputeForCompanies(
        prisma as never,
        'org_1',
        [{ companyId: 'co_1', year: 2026 }],
        {},
        { revisionId: 'rev_1' } as never,
      );

      const byCompany = new Map<string, unknown>();
      for (const call of mockedRecompute.mock.calls) {
        byCompany.set(call[1].companyId as string, call[1].revisionId);
      }
      // Guard the guard: the parent pass must actually have run, or the
      // assertion below would pass for the wrong reason (absent ≠ untraced).
      expect(byCompany.has('co_parent')).toBe(true);
      // Neither the child nor the holding can cite a workbook-only revision:
      // the child formula may have mixed inputs and the rollup certainly does.
      expect(byCompany.get('co_1')).toBeUndefined();
      expect(byCompany.get('co_parent')).toBeUndefined();
    });

    it('does not let a legacy traced-company set opt selected rows into false lineage', async () => {
      // A multi-company apply recomputes every company it touched, but only the
      // ones its transaction actually WROTE belong to the revision. The rest
      // must not cite it.
      const written = co({ id: 'co_written', code: 'W' });
      const recomputedOnly = co({ id: 'co_untouched', code: 'U' });
      const prisma = makePrisma([written, recomputedOnly], [ind()]);
      mockedRecompute.mockResolvedValue({ ok: true, status: 'green', value: 75 });

      await runRecomputeForCompanies(
        prisma as never,
        'org_1',
        [
          { companyId: 'co_written', year: 2026 },
          { companyId: 'co_untouched', year: 2026 },
        ],
        {},
        { revisionId: 'rev_1', tracedCompanyIds: new Set(['co_written']) } as never,
      );

      const byCompany = new Map<string, unknown>();
      for (const call of mockedRecompute.mock.calls) {
        byCompany.set(call[1].companyId as string, call[1].revisionId);
      }
      // Both were recomputed — the run's scope is unchanged...
      expect(byCompany.has('co_written')).toBe(true);
      expect(byCompany.has('co_untouched')).toBe(true);
      // ...and neither is traced without complete per-KPI dependencies.
      expect(byCompany.get('co_written')).toBeUndefined();
      expect(byCompany.get('co_untouched')).toBeUndefined();
    });

    it('does not blanket-trace a single-company run', async () => {
      const prisma = makePrisma([co()], [ind()]);
      mockedRecompute.mockResolvedValue({ ok: true, status: 'green', value: 75 });

      await runRecomputeForCompanies(
        prisma as never,
        'org_1',
        [{ companyId: 'co_1', year: 2026 }],
        {},
        { revisionId: 'rev_1' } as never,
      );

      for (const call of mockedRecompute.mock.calls) {
        expect(call[1].revisionId).toBeUndefined();
      }
    });

    it('an empty traced set traces nobody', async () => {
      const prisma = makePrisma([co()], [ind()]);
      mockedRecompute.mockResolvedValue({ ok: true, status: 'green', value: 75 });

      await runRecomputeForCompanies(
        prisma as never,
        'org_1',
        [{ companyId: 'co_1', year: 2026 }],
        {},
        { revisionId: 'rev_1', tracedCompanyIds: new Set<string>() } as never,
      );

      expect(mockedRecompute).toHaveBeenCalled();
      for (const call of mockedRecompute.mock.calls) {
        expect(call[1].revisionId).toBeUndefined();
      }
    });
  });
});

// ─── Phase 11.7 — period granularity ────────────────────────────────────
describe("expandYearPeriods", () => {
  it("defaults to the year alone — the period the HeatMap reads", () => {
    expect(expandYearPeriods(2026)).toEqual(["2026"])
    expect(expandYearPeriods(2026, "year")).toEqual(["2026"])
  })

  it("expands to year + 4 quarters + 12 months, year FIRST", () => {
    // Year first is deliberate: an interrupted run still leaves the headline
    // cells correct.
    const periods = expandYearPeriods(2026, "year+quarter+month")
    expect(periods).toHaveLength(17)
    expect(periods[0]).toBe("2026")
    expect(periods.slice(1, 5)).toEqual([
      "2026-Q1",
      "2026-Q2",
      "2026-Q3",
      "2026-Q4",
    ])
    expect(periods[5]).toBe("2026-01")
    expect(periods[16]).toBe("2026-12")
  })

  it("zero-pads months so the shape matches IndicatorValue.period", () => {
    // "2026-1" would never match a stored "2026-01" row, so the stale cell
    // would survive while the recompute reported success.
    const periods = expandYearPeriods(2026, "year+quarter+month")
    expect(periods).toContain("2026-01")
    expect(periods).toContain("2026-09")
    expect(periods).not.toContain("2026-1")
  })
})
