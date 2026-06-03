/**
 * Handler test for `GET /api/indicators/matrix`.
 *
 * Locks in the Turn-16 default-period regression: the recompute pipeline
 * writes IndicatorValue rows under `period: String(year)` (annual). An
 * earlier `currentMonthString()` default returned `YYYY-MM` and silently
 * mismatched all pipeline-written rows, surfacing as 15 stale orphan-
 * monthly cells in the HeatMap (real count was 36 annual). The fix at
 * `route.ts:40-44` renames it to `defaultPeriodString()` (Phase 7.G Turn
 * XXXIII switched the body from `String(getUTCFullYear())` to
 * `currentBakuYear()` — Asia/Baku-anchored — closing the latent off-by-one
 * footgun documented in L416/L433). This test pins that contract: the
 * request with no `?period=` MUST query Prisma with a 4-digit year string.
 *
 * Also covers: 401 unauth, 400 invalid period, period override via
 * query string. The auth gate + tenant scoping shape mirrors
 * `companies/[id]/handler.test.ts` — proves the harness is reusable
 * across routes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findMany: vi.fn() },
    indicatorDefinition: { findMany: vi.fn() },
    indicatorValue: { findMany: vi.fn() },
    // Phase 7.F sub-group RBAC — getCompanyScope reads user.allowedSubGroupIds
    // for non-admin roles. Default empty array = full access (legacy behavior).
    user: { findFirst: vi.fn() },
    // Phase 5.2 Stage 2 — withOrgScope wraps the GET handler body.
    $transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
    ),
    $executeRawUnsafe: vi.fn(async () => 1),
  },
}));

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { mockSession, makeRequest } from '@/test/api-harness';
import { GET } from './route';

const ORG_ID = 'cm3rlswraporg00000001matrx';

beforeEach(() => {
  prismaMock.company.findMany.mockReset().mockResolvedValue([]);
  prismaMock.indicatorDefinition.findMany.mockReset().mockResolvedValue([]);
  prismaMock.indicatorValue.findMany.mockReset().mockResolvedValue([]);
  prismaMock.user.findFirst.mockReset().mockResolvedValue({ allowedSubGroupIds: [] });
});

describe('GET /api/indicators/matrix — handler', () => {
  it('returns 401 when unauthenticated', async () => {
    await mockSession(null);
    const res = await GET(makeRequest('/api/indicators/matrix'));
    expect(res.status).toBe(401);
    expect(prismaMock.company.findMany).not.toHaveBeenCalled();
  });

  it('defaults to annual period (YYYY) — Turn-16 regression guard', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    // Stub a single operational company + a single indicator so the
    // findMany on indicatorValue actually runs (the route short-circuits
    // when either list is empty).
    prismaMock.company.findMany.mockResolvedValue([
      {
        id: 'c1',
        code: 'AAC',
        name: 'AAC',
        industry: 'hospitality',
        level: 2,
        isActive: true,
        role: 'operational',
        sortOrder: 1,
      },
    ]);
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: 'i1',
        code: 'GROSS_MARGIN',
        nameEn: 'Gross Margin',
        direction: 'higher_is_better',
        unit: '%',
        sortOrder: 1,
      },
    ]);

    const res = await GET(makeRequest('/api/indicators/matrix'));
    expect(res.status).toBe(200);
    const body = await res.json();

    // The exact year is wall-clock dependent, but it MUST be a 4-digit
    // string (annual), not a YYYY-MM monthly key — that's the regression.
    expect(body.period).toMatch(/^\d{4}$/);
    expect(body.period).not.toMatch(/-\d{2}$/);

    // And the indicatorValue.findMany call must scope to that same period.
    expect(prismaMock.indicatorValue.findMany).toHaveBeenCalledTimes(1);
    const ivCall = prismaMock.indicatorValue.findMany.mock.calls[0][0];
    expect(ivCall.where.period).toBe(body.period);
    expect(ivCall.where.organizationId).toBe(ORG_ID);
  });

  it('honors an explicit ?period=YYYY-MM override', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    prismaMock.company.findMany.mockResolvedValue([
      {
        id: 'c1',
        code: 'AAC',
        name: 'AAC',
        industry: 'hospitality',
        level: 2,
        isActive: true,
        role: 'operational',
        sortOrder: 1,
      },
    ]);
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: 'i1',
        code: 'X',
        nameEn: 'X',
        direction: 'higher_is_better',
        unit: '%',
        sortOrder: 1,
      },
    ]);

    const res = await GET(makeRequest('/api/indicators/matrix?period=2026-04'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.period).toBe('2026-04');
    const ivCall = prismaMock.indicatorValue.findMany.mock.calls[0][0];
    expect(ivCall.where.period).toBe('2026-04');
  });

  it('rejects malformed period with 400 — gate fires before any DB hit', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    const res = await GET(makeRequest('/api/indicators/matrix?period=garbage'));
    expect(res.status).toBe(400);
    // Lock the gate ordering — period validation must precede company /
    // indicator lookups, otherwise a malformed query still wastes DB hits.
    expect(prismaMock.company.findMany).not.toHaveBeenCalled();
    expect(prismaMock.indicatorDefinition.findMany).not.toHaveBeenCalled();
    expect(prismaMock.indicatorValue.findMany).not.toHaveBeenCalled();
  });

  it('skips indicatorValue.findMany when no operational companies', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    prismaMock.company.findMany.mockResolvedValue([
      // admin entity → filtered out by filterOperationalCompanies
      {
        id: 'c1',
        code: 'HQ',
        name: 'HQ',
        industry: null,
        level: 2,
        isActive: true,
        role: 'admin',
        sortOrder: 1,
      },
    ]);
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: 'i1',
        code: 'X',
        nameEn: 'X',
        direction: 'higher_is_better',
        unit: '%',
        sortOrder: 1,
        category: 'operational',
        requiredInputs: ['budgetLine'],
      },
    ]);

    const res = await GET(makeRequest('/api/indicators/matrix'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.companies).toEqual([]);
    expect(body.cells).toEqual([]);
    expect(prismaMock.indicatorValue.findMany).not.toHaveBeenCalled();
  });

  // ─── Sub-44 cont'd render-path closure ──────────────────────────────────
  // Surfaces parent-co (level=1) IVs for rollup-bearing indicators in the
  // matrix. Closes the gap where sub-44 prereq #1's pipeline writes
  // IND_HOLDING_REVENUE to DB but the UI couldn't see it.

  describe("sub-44 cont'd render-path — parent-co rollup IVs", () => {
    /**
     * Mock company.findMany to honor where clauses:
     *   - 1st call: full company list for the org
     *   - 2nd call: child cos by parentCompanyId (Turn 33.5 path)
     */
    function setupCompaniesMock(allCos: unknown[], childCos: unknown[]): void {
      prismaMock.company.findMany.mockImplementation(
        async (
          arg: { where?: { parentCompanyId?: { in?: string[] } } } = {},
        ) => {
          if (arg.where?.parentCompanyId) return childCos;
          return allCos;
        },
      );
    }

    /**
     * Mock indicatorValue.findMany to honor where clauses:
     *   - operational pass: companyId in level=2 ids
     *   - parent pass (NEW): companyId in level=1 (sub-group) ids
     */
    function setupIVMock(opIVs: unknown[], parentIVs: unknown[], parentIds: string[]): void {
      prismaMock.indicatorValue.findMany.mockImplementation(
        async (
          arg: { where?: { companyId?: { in?: string[] } } } = {},
        ) => {
          const targetIds = arg.where?.companyId?.in ?? [];
          // Detect parent-IV pass by intersection with parent ids.
          if (targetIds.some((id: string) => parentIds.includes(id))) {
            return parentIVs;
          }
          return opIVs;
        },
      );
    }

    it("includes rollup-bearing internal indicators in the indicators list (column visible)", async () => {
      await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
      setupCompaniesMock(
        [
          {
            id: 'co_op',
            code: 'AAC-MAIN',
            name: 'AAC Main',
            industry: 'industrial',
            level: 2,
            isActive: true,
            role: 'operational',
            sortOrder: 1,
          },
        ],
        [],
      );
      // Three indicators: 1 operational (visible), 1 internal-non-rollup
      // (hidden), 1 internal-rollup (NEW: visible via the relaxed filter).
      prismaMock.indicatorDefinition.findMany.mockResolvedValue([
        {
          id: 'i_op',
          code: 'IND_NET_MARGIN',
          nameEn: 'Net Margin',
          direction: 'higher_is_better',
          unit: '%',
          sortOrder: 1,
          category: 'operational',
          requiredInputs: ['budgetLine'],
        },
        {
          id: 'i_internal_persist',
          code: 'IND_REVENUE_TOTAL',
          nameEn: 'Revenue Total',
          direction: 'higher_is_better',
          unit: 'AZN',
          sortOrder: 2,
          category: 'internal',
          requiredInputs: ['budgetLine'], // NOT rollup-bearing
        },
        {
          id: 'i_internal_rollup',
          code: 'IND_HOLDING_REVENUE',
          nameEn: 'Holding Revenue',
          direction: 'higher_is_better',
          unit: 'AZN',
          sortOrder: 3,
          category: 'internal',
          requiredInputs: ['rollup:IND_REVENUE_TOTAL'], // rollup-bearing
        },
      ]);
      setupIVMock([], [], []);

      const res = await GET(makeRequest('/api/indicators/matrix'));
      expect(res.status).toBe(200);
      const body = await res.json();

      const codes = body.indicators.map((i: { code: string }) => i.code);
      expect(codes).toContain('IND_NET_MARGIN');
      expect(codes).toContain('IND_HOLDING_REVENUE'); // NEW: rollup-bearing internal kept
      expect(codes).not.toContain('IND_REVENUE_TOTAL'); // non-rollup internal still filtered
    });

    it("emits real parent-co cells from rollup() IVs with drill-downable indicatorValueId", async () => {
      await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
      const subgroup = {
        id: 'co_holding',
        code: 'AAC',
        name: 'AAC Holding',
        industry: null,
        level: 1,
        isActive: true,
        role: 'operational', // Turn 33.5 keeps level=1 only when role=operational
        sortOrder: 1,
      };
      const opChild = {
        id: 'co_op',
        code: 'AAC-MAIN',
        name: 'AAC Main',
        industry: 'industrial',
        level: 2,
        isActive: true,
        role: 'operational',
        sortOrder: 2,
      };
      setupCompaniesMock(
        [subgroup, opChild],
        [{ id: 'co_op', parentCompanyId: 'co_holding' }],
      );
      prismaMock.indicatorDefinition.findMany.mockResolvedValue([
        {
          id: 'i_internal_rollup',
          code: 'IND_HOLDING_REVENUE',
          nameEn: 'Holding Revenue',
          direction: 'higher_is_better',
          unit: 'AZN',
          sortOrder: 1,
          category: 'internal',
          requiredInputs: ['rollup:IND_REVENUE_TOTAL'],
        },
      ]);
      // Op-co has an IV (rollup of empty children = 0 amber) — MUST be
      // suppressed from cells. Parent-co has the real rollup IV — MUST
      // appear with drill-downable indicatorValueId.
      setupIVMock(
        // op pass returns the op-co's misleading IND_HOLDING_REVENUE IV
        [
          {
            id: 'iv_op',
            companyId: 'co_op',
            indicatorId: 'i_internal_rollup',
            value: 0,
            status: 'amber',
            inputs: null,
            sparkline: null,
          },
        ],
        // parent pass returns the real rollup IV
        [
          {
            id: 'iv_parent',
            companyId: 'co_holding',
            indicatorId: 'i_internal_rollup',
            value: 5_000_000,
            status: 'green',
            inputs: null,
            sparkline: null,
          },
        ],
        ['co_holding'],
      );

      const res = await GET(makeRequest('/api/indicators/matrix'));
      expect(res.status).toBe(200);
      const body = await res.json();

      // Op-co cell suppressed (load-bearing — closes the "misleading
      // amber on every op-co" UX issue noted in seed comment).
      const opCells = body.cells.filter(
        (c: { companyId: string }) => c.companyId === 'co_op',
      );
      expect(opCells).toEqual([]);

      // Parent-co cell present with drill-downable IV.
      const parentCells = body.cells.filter(
        (c: { companyId: string }) => c.companyId === 'co_holding',
      );
      expect(parentCells).toHaveLength(1);
      expect(parentCells[0]).toMatchObject({
        indicatorValueId: 'iv_parent',
        indicatorId: 'i_internal_rollup',
        value: 5_000_000,
        status: 'green',
        kind: 'real-rollup',
      });
    });

    it("REGRESSION (terminal-audit P2 #7): lastComputedAt is populated from IV computedAt (freshness badge was never rendering)", async () => {
      await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
      setupCompaniesMock(
        [
          {
            id: 'co_op',
            code: 'AAC',
            name: 'AAC',
            industry: 'industrial',
            level: 2,
            isActive: true,
            role: 'operational',
            sortOrder: 1,
          },
        ],
        [],
      );
      prismaMock.indicatorDefinition.findMany.mockResolvedValue([
        {
          id: 'i_op',
          code: 'GROSS_MARGIN',
          nameEn: 'Gross Margin',
          direction: 'higher_is_better',
          unit: '%',
          sortOrder: 1,
        },
      ]);
      const newest = new Date('2026-06-03T09:30:00.000Z');
      setupIVMock(
        [
          {
            id: 'iv_a',
            companyId: 'co_op',
            indicatorId: 'i_op',
            value: 30,
            status: 'green',
            inputs: null,
            sparkline: null,
            computedAt: newest,
          },
        ],
        [],
        [],
      );

      const res = await GET(makeRequest('/api/indicators/matrix'));
      expect(res.status).toBe(200);
      const body = await res.json();
      // Pre-fix: the cell .map()s dropped computedAt, so the loop over `cells`
      // always saw undefined → lastComputedAt was null → the «Updated Xh ago»
      // badge (gated on it in HeatMap) never rendered. Now read from raw rows.
      expect(body.lastComputedAt).toBe(newest.toISOString());
    });

    it("real parent IV beats Turn 33.5 synthetic-average when both could apply (priority lock)", async () => {
      await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
      const subgroup = {
        id: 'co_holding',
        code: 'AAC',
        name: 'AAC Holding',
        industry: null,
        level: 1,
        isActive: true,
        role: 'operational',
        sortOrder: 1,
      };
      const opChild = {
        id: 'co_op',
        code: 'AAC-MAIN',
        name: 'AAC Main',
        industry: 'industrial',
        level: 2,
        isActive: true,
        role: 'operational',
        sortOrder: 2,
      };
      setupCompaniesMock(
        [subgroup, opChild],
        [{ id: 'co_op', parentCompanyId: 'co_holding' }],
      );
      // Operational-category indicator (NOT rollup-bearing, NOT internal).
      // Op-co has a cell → Turn 33.5 would synthesize a parent average from
      // it. Parent ALSO has a real IV (e.g. some org seeds an org-scoped
      // override that fires on parents). Real IV must win.
      prismaMock.indicatorDefinition.findMany.mockResolvedValue([
        {
          id: 'i_op_kpi',
          code: 'IND_NET_MARGIN',
          nameEn: 'Net Margin',
          direction: 'higher_is_better',
          unit: '%',
          sortOrder: 1,
          category: 'operational',
          requiredInputs: ['budgetLine'],
        },
      ]);
      setupIVMock(
        [
          {
            id: 'iv_op_real',
            companyId: 'co_op',
            indicatorId: 'i_op_kpi',
            value: 12.5,
            status: 'amber',
            inputs: null,
            sparkline: null,
          },
        ],
        [
          {
            id: 'iv_parent_real',
            companyId: 'co_holding',
            indicatorId: 'i_op_kpi',
            value: 99.9, // distinct from any average of op-cells
            status: 'green',
            inputs: null,
            sparkline: null,
          },
        ],
        ['co_holding'],
      );

      const res = await GET(makeRequest('/api/indicators/matrix'));
      expect(res.status).toBe(200);
      const body = await res.json();

      const parentCells = body.cells.filter(
        (c: { companyId: string }) => c.companyId === 'co_holding',
      );
      expect(parentCells).toHaveLength(1);
      // Real IV (99.9) wins over synthetic average that would have been 12.5.
      expect(parentCells[0].value).toBe(99.9);
      expect(parentCells[0].indicatorValueId).toBe('iv_parent_real');
      expect(parentCells[0].kind).toBe('real-rollup');
      // No synthetic-rollup cell for the same pair (priority lock).
      expect(
        parentCells.some(
          (c: { kind?: string }) => c.kind === 'synthetic-rollup',
        ),
      ).toBe(false);
    });

    it("consolidates ratio indicators (Σnum/Σdenom) — incl. a child whose margin is unknown but components are real (2026-05-30 fix)", async () => {
      await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
      const subgroup = { id: 'co_holding', code: 'AAC', name: 'AAC Holding', industry: null, level: 1, isActive: true, role: 'operational', sortOrder: 1 };
      const coA = { id: 'co_a', code: 'A', name: 'A', industry: 'food_processing', level: 2, isActive: true, role: 'operational', sortOrder: 2 };
      const coB = { id: 'co_b', code: 'B', name: 'B', industry: 'food_processing', level: 2, isActive: true, role: 'operational', sortOrder: 3 };
      setupCompaniesMock(
        [subgroup, coA, coB],
        [{ id: 'co_a', parentCompanyId: 'co_holding' }, { id: 'co_b', parentCompanyId: 'co_holding' }],
      );
      prismaMock.indicatorDefinition.findMany.mockResolvedValue([
        { id: 'i_ebitda', code: 'IND_EBITDA_MARGIN', nameEn: 'EBITDA Margin', direction: 'higher_is_better', unit: '%', sortOrder: 1, category: 'operational', requiredInputs: ['budgetLine'] },
      ]);
      setupIVMock(
        [
          // co_a: real margin, red.
          { id: 'iv_a', companyId: 'co_a', indicatorId: 'i_ebitda', value: -10, status: 'red', inputs: { resolved: { ebitda: -100, revenue: 1000 } }, sparkline: null },
          // co_b: margin -900% is out_of_range → status unknown (hidden at the
          // leaf), BUT its ebitda/revenue are real and belong in the holding Σ.
          { id: 'iv_b', companyId: 'co_b', indicatorId: 'i_ebitda', value: -900, status: 'unknown', inputs: { resolved: { ebitda: -900, revenue: 100 } }, sparkline: null },
        ],
        [],
        ['co_holding'],
      );

      const res = await GET(makeRequest('/api/indicators/matrix'));
      expect(res.status).toBe(200);
      const body = await res.json();
      const cell = body.cells.find(
        (c: { companyId: string; indicatorId: string }) =>
          c.companyId === 'co_holding' && c.indicatorId === 'i_ebitda',
      );
      expect(cell).toBeTruthy();
      expect(cell.kind).toBe('synthetic-rollup');
      // Consolidated Σebitda/Σrevenue × 100 = (-100 + -900)/(1000 + 100) × 100
      // = -90.9%. Distinguishes the fix from BOTH the old buggy average incl.
      // unknown (-455%) AND a naive exclude-unknown average (-10%).
      expect(cell.value).toBeCloseTo(-90.9, 1);
    });

    it("Turn 33.5 synthetic-average fallback preserved when no real parent IV exists (back-compat)", async () => {
      await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
      const subgroup = {
        id: 'co_holding',
        code: 'AAC',
        name: 'AAC Holding',
        industry: null,
        level: 1,
        isActive: true,
        role: 'operational',
        sortOrder: 1,
      };
      const opChild = {
        id: 'co_op',
        code: 'AAC-MAIN',
        name: 'AAC Main',
        industry: 'industrial',
        level: 2,
        isActive: true,
        role: 'operational',
        sortOrder: 2,
      };
      setupCompaniesMock(
        [subgroup, opChild],
        [{ id: 'co_op', parentCompanyId: 'co_holding' }],
      );
      prismaMock.indicatorDefinition.findMany.mockResolvedValue([
        {
          id: 'i_op_kpi',
          code: 'IND_GROSS_MARGIN',
          nameEn: 'Gross Margin',
          direction: 'higher_is_better',
          unit: '%',
          sortOrder: 1,
          category: 'operational',
          requiredInputs: ['budgetLine'],
        },
      ]);
      setupIVMock(
        [
          {
            id: 'iv_op_real',
            companyId: 'co_op',
            indicatorId: 'i_op_kpi',
            value: 25.0,
            status: 'green',
            inputs: null,
            sparkline: null,
          },
        ],
        [], // no real parent IV
        ['co_holding'],
      );

      const res = await GET(makeRequest('/api/indicators/matrix'));
      expect(res.status).toBe(200);
      const body = await res.json();

      const parentCells = body.cells.filter(
        (c: { companyId: string }) => c.companyId === 'co_holding',
      );
      // Falls back to Turn 33.5 synthetic — single op-co cell, average = 25.
      expect(parentCells).toHaveLength(1);
      expect(parentCells[0]).toMatchObject({
        indicatorValueId: null, // synthetic — not drill-downable
        value: 25.0,
        status: 'green',
        kind: 'synthetic-rollup',
      });
      // Not a real parent rollup — discriminated-union variant must be
      // EXACTLY 'synthetic-rollup', not 'real-rollup'.
      expect(parentCells[0].kind).not.toBe('real-rollup');
    });

    it("non-rollup internal indicators stay filtered (back-compat with sub-42 architect Round-1 closure)", async () => {
      // IND_REVENUE_TOTAL is internal-but-NOT-rollup-bearing — used as a
      // building block for IND_HOLDING_REVENUE. Sub-42 architect closure
      // explicitly hid it from the matrix (see seed comment at
      // indicator-seeds.ts:260-268). Sub-44 cont'd MUST preserve that.
      await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
      setupCompaniesMock(
        [
          {
            id: 'co_op',
            code: 'AAC-MAIN',
            name: 'AAC Main',
            industry: 'industrial',
            level: 2,
            isActive: true,
            role: 'operational',
            sortOrder: 1,
          },
        ],
        [],
      );
      prismaMock.indicatorDefinition.findMany.mockResolvedValue([
        {
          id: 'i_internal_persist',
          code: 'IND_REVENUE_TOTAL',
          nameEn: 'Revenue Total',
          direction: 'higher_is_better',
          unit: 'AZN',
          sortOrder: 1,
          category: 'internal',
          requiredInputs: ['budgetLine'], // NOT rollup-bearing
        },
      ]);
      setupIVMock(
        [
          // Op-co has an IV for the internal-persist indicator
          {
            id: 'iv_persist',
            companyId: 'co_op',
            indicatorId: 'i_internal_persist',
            value: 1_000_000,
            status: 'green',
            inputs: null,
            sparkline: null,
          },
        ],
        [],
        [],
      );

      const res = await GET(makeRequest('/api/indicators/matrix'));
      expect(res.status).toBe(200);
      const body = await res.json();

      // Indicator filtered out → no column.
      expect(body.indicators).toEqual([]);
      // Cell filtered out (no indicator → no cell makes it through).
      expect(body.cells).toEqual([]);
    });
  });

  it('emits Cache-Control: private, max-age=10 on success (Turn-CC perf guard)', async () => {
    // Phase 7.G Turn CC — closes Turn-32 architect ⚠️ on
    // CommandBar IND keystroke flurry duplicating /api/indicators/matrix
    // fetches. The header lets the browser reuse the matrix response for
    // 10s without re-hitting the server. `private` keeps shared caches
    // out of the picture (response is org-scoped + auth-gated).
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    prismaMock.company.findMany.mockResolvedValue([]);
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest('/api/indicators/matrix'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=10');
  });
});

describe('GET /api/indicators/matrix — truth-infra C.3 pending filter', () => {
  beforeEach(() => {
    prismaMock.company.findMany.mockReset().mockResolvedValue([]);
    prismaMock.indicatorDefinition.findMany.mockReset().mockResolvedValue([]);
    prismaMock.indicatorValue.findMany.mockReset().mockResolvedValue([]);
    prismaMock.user.findFirst.mockReset().mockResolvedValue({ allowedSubGroupIds: [] });
  });

  it('default request excludes pending companies (status filter applied)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    await GET(makeRequest('/api/indicators/matrix?period=2026'));
    // First findMany call = top-level companies query
    const where = prismaMock.company.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      organizationId: ORG_ID,
      isActive: true,
      status: { not: 'pending' },
    });
  });

  it('?includePending=true drops the status filter', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    await GET(
      makeRequest('/api/indicators/matrix?period=2026&includePending=true'),
    );
    const where = prismaMock.company.findMany.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({ organizationId: ORG_ID, isActive: true }),
    );
    // Status filter should NOT be in the where object when includePending=true
    expect(where).not.toHaveProperty('status');
  });

  it('?includePending=false (explicit) keeps the status filter', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    await GET(
      makeRequest('/api/indicators/matrix?period=2026&includePending=false'),
    );
    const where = prismaMock.company.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ status: { not: 'pending' } });
  });
});
