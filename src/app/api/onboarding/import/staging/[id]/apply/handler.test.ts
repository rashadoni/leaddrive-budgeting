/**
 * Handler tests for `POST /api/onboarding/import/staging/[id]/apply`.
 *
 * Scope this turn: the lazy-flip audit emission path
 * (`triggeredBy: 'lazy_apply'`) — analogous to the staging GET test
 * but covers the second emission point that fires when an apply request
 * encounters a past-expiresAt pending row. Asserts 410 + correct audit
 * metadata + race-loser path (no double-emit not possible here because
 * apply doesn't gate on count, but worth pinning the metadata shape so
 * a future refactor can't drop the discriminator).
 *
 * NOT covered: full happy-path apply emission (`import_staging_apply`).
 * That needs `applyProposal` + `detectProposalYear` + `XLSX.read` +
 * `$transaction` callback all mocked together. Documented as a tighter
 * 🔄 in CARRYOVER ("apply happy-path emission integration test —
 * applyProposal mock fixture needed").
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock, applierMocks, recomputeMock } = vi.hoisted(() => ({
  prismaMock: {
    importStaging: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    // Phase 7.G L425 dry-run path queries existing plan + line count
    // before the transaction. Keep these out of the inner-callback
    // `tx` (which is a fresh per-test object) — the dry-run branch
    // uses the top-level prisma client.
    budgetPlan: { findFirst: vi.fn() },
    budgetLine: { count: vi.fn() },
    // Phase 7.G L1 closure (Turn XXXIX): the route looks up
    // `company.baseCurrencyCode` once before the transaction so every
    // BudgetLine insert can tag `currencyCode = baseCurrencyCode`.
    company: { findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  applierMocks: {
    applyProposal: vi.fn(),
    detectProposalYear: vi.fn(),
  },
  recomputeMock: { runRecomputeForCompanies: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/onboarding/ai-mapper/applier', () => applierMocks);
vi.mock('@/lib/risk/recompute-trigger', () => recomputeMock);
vi.mock('xlsx', () => ({
  read: vi.fn().mockReturnValue({
    SheetNames: ['SOPL'],
    Sheets: { SOPL: {} },
  }),
}));
vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit')>(
    '@/lib/rate-limit',
  );
  return {
    ...actual,
    enforceRateLimit: vi.fn().mockReturnValue(null),
    getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  };
});

import type { NextRequest as NextRequestType } from 'next/server';
import { mockSession, makeRequest } from '@/test/api-harness';
import { POST } from './route';

const ORG_ID = 'org_az';
const STAGING_ID = 'staging_1';
const COMPANY_ID = 'co_aac';

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  prismaMock.importStaging.findFirst.mockReset();
  prismaMock.importStaging.updateMany.mockReset();
  prismaMock.importStaging.update.mockReset();
  prismaMock.budgetPlan.findFirst.mockReset();
  prismaMock.budgetLine.count.mockReset();
  // Default: company.baseCurrencyCode = 'AZN' (matches AZMADE seed). Tests
  // that rely on a different currency override per-case.
  prismaMock.company.findUnique.mockReset().mockResolvedValue({ baseCurrencyCode: 'AZN' });
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: 'audit_1' });
  prismaMock.$transaction.mockReset();
  applierMocks.applyProposal.mockReset();
  applierMocks.detectProposalYear.mockReset();
  recomputeMock.runRecomputeForCompanies
    .mockReset()
    .mockResolvedValue({ ok: 5, unknown: 1, failed: 0, targets: 6 });
});

async function makeMultipartApplyRequest(): Promise<NextRequestType> {
  const fd = new FormData();
  fd.set('file', new File(['fake'], 'aac.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const base = new Request(
    `http://localhost/api/onboarding/import/staging/${STAGING_ID}/apply`,
    { method: 'POST', body: fd },
  );
  const { NextRequest } = await import('next/server');
  return new NextRequest(base);
}

describe('POST /api/onboarding/import/staging/[id]/apply — handler (lazy-flip audit path)', () => {
  it('expired pending row → 410 + emits import_staging_expired with triggeredBy=lazy_apply', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_admin', role: 'admin' });
    const past = new Date(Date.now() - 60_000);
    prismaMock.importStaging.findFirst.mockResolvedValue({
      id: STAGING_ID,
      companyId: COMPANY_ID,
      status: 'pending',
      sourceSheet: 'SOPL',
      proposal: {},
      userOverrides: null,
      expiresAt: past,
      appliedAt: null,
    });
    prismaMock.importStaging.updateMany.mockResolvedValue({ count: 1 });

    // Apply requires manager+; a manager can hit it. We're testing the
    // lazy-flip path which fires before formData parsing — body shape
    // doesn't matter here.
    const req = makeRequest(
      `/api/onboarding/import/staging/${STAGING_ID}/apply`,
      { method: 'POST' },
    );
    const res = await POST(req, paramsFor(STAGING_ID));
    expect(res.status).toBe(410);

    expect(prismaMock.importStaging.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(1);
    const auditCall = prismaMock.auditEvent.create.mock.calls[0][0];
    expect(auditCall.data.action).toBe('import_staging_expired');
    expect(auditCall.data.entityType).toBe('ImportStaging');
    expect(auditCall.data.entityId).toBe(STAGING_ID);
    expect(auditCall.data.metadata).toMatchObject({
      companyId: COMPANY_ID,
      triggeredBy: 'lazy_apply',
      expiresAt: past.toISOString(),
    });
  });

  it('returns 401 when unauthenticated (no DB hit)', async () => {
    await mockSession(null);
    const req = makeRequest(
      `/api/onboarding/import/staging/${STAGING_ID}/apply`,
      { method: 'POST' },
    );
    const res = await POST(req, paramsFor(STAGING_ID));
    expect(res.status).toBe(401);
    expect(prismaMock.importStaging.findFirst).not.toHaveBeenCalled();
  });

  it('returns 404 on cross-tenant staging id (no audit fired)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    prismaMock.importStaging.findFirst.mockResolvedValue(null);
    const req = makeRequest(
      `/api/onboarding/import/staging/${STAGING_ID}/apply`,
      { method: 'POST' },
    );
    const res = await POST(req, paramsFor(STAGING_ID));
    expect(res.status).toBe(404);
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it('happy path: emits import_staging_apply with full discriminated metadata', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    prismaMock.importStaging.findFirst.mockResolvedValue({
      id: STAGING_ID,
      companyId: COMPANY_ID,
      status: 'pending',
      sourceSheet: 'SOPL',
      proposal: {
        columns: [
          { sourceIndex: 2, role: 'amount:Plan2026' },
        ],
        mappings: [],
      },
      userOverrides: null,
      expiresAt: new Date(Date.now() + 60_000),
      appliedAt: null,
    });
    applierMocks.applyProposal.mockReturnValue({
      lines: [{ code: '5000', label: 'Revenue', plannedAnnual: 1000, accountType: 'revenue' }],
      warnings: [],
      parentRollupsDropped: [{ code: 'PARENT', plannedAnnual: 100 }],
      parentRollupsUnallocated: [],
    });
    applierMocks.detectProposalYear.mockReturnValue(2026);
    // **Coverage limit (Turn-22 architect ⚠️):** the diagnostics shape
    // below is FIXTURE-SUPPLIED, not derived from the route's inner
    // callback. A future refactor that moves diagnostics computation OUT
    // of the `$transaction` body into post-processing would silently
    // pass this test. Inner-callback coverage lives in `applyProposal`
    // unit tests + (eventually) a real DB integration test. This test's
    // scope is the audit-emission shape + the 200-response wiring on top
    // of a successful $transaction — both of which DO depend on the
    // route's post-transaction code path being exercised.
    prismaMock.$transaction.mockResolvedValue({
      inserted: 1,
      deleted: 0,
      warnings: 0,
      parentRollupsDropped: 1,
      parentRollupsUnallocated: 0,
    });

    const req = await makeMultipartApplyRequest();
    const res = await POST(req, paramsFor(STAGING_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      stagingId: STAGING_ID,
      status: 'applied',
      year: 2026,
      inserted: 1,
      auditStale: false,
    });

    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(1);
    const auditCall = prismaMock.auditEvent.create.mock.calls[0][0];
    expect(auditCall.data.action).toBe('import_staging_apply');
    expect(auditCall.data.entityType).toBe('ImportStaging');
    expect(auditCall.data.entityId).toBe(STAGING_ID);
    expect(auditCall.data.actorUserId).toBe('u_mgr');
    expect(auditCall.data.metadata).toEqual({
      companyId: COMPANY_ID,
      year: 2026,
      inserted: 1,
      deleted: 0,
      warnings: 0,
      parentRollupsDropped: 1,
      parentRollupsUnallocated: 0,
      recompute: { ok: 5, unknown: 1, failed: 0, targets: 6 },
    });
  });

  // Turn 42 sub-2 closure: the prior happy-path test uses
  // `prismaMock.$transaction.mockResolvedValue(...)` which bypasses the
  // route's inner-callback path entirely (existing FIXTURE-SUPPLIED
  // coverage limit, comment at line 183-191). The Turn-42-sub-2 audit fix
  // changed the inner-callback's BudgetLine insert from 1 row at
  // sortOrder=0 → 12 rows at sortOrder=monthIdx with plannedAmount=
  // perMonth[idx]. Without exercising the inner callback, the prior
  // tests would silently green-pass even if a future regression
  // re-introduced the 1-row-at-sortOrder=0 bug.
  //
  // This test invokes `$transaction` via `mockImplementation` so the
  // callback ACTUALLY runs against a captured tx-spy. Then asserts the
  // 12-row contract: 12 calls, sortOrder 0..11 distinct, plannedAmount
  // mirrors perMonth[idx], isAutoPlanned=false (xlsx-sourced — Turn 29
  // Bug #1b), and per-month sum equals plannedAnnual.
  it('inner-callback: writes 12 BudgetLine rows per parsed line with sortOrder=monthIdx + plannedAmount=perMonth[idx]', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    prismaMock.importStaging.findFirst.mockResolvedValue({
      id: STAGING_ID,
      companyId: COMPANY_ID,
      status: 'pending',
      sourceSheet: 'SOPL',
      proposal: {
        columns: [{ sourceIndex: 2, role: 'amount:Plan2026' }],
        mappings: [],
      },
      userOverrides: null,
      expiresAt: new Date(Date.now() + 60_000),
      appliedAt: null,
    });
    // 2 parsed lines × 12 months = 24 expected create calls.
    // Distinct perMonth shapes (seasonal + flat) so we can verify the
    // mapping isn't being collapsed via averaging.
    const seasonalPerMonth = [
      100, 110, 130, 140, 160, 80, 70, 60, 90, 120, 150, 170,
    ]; // sums to 1380
    const flatPerMonth = Array.from({ length: 12 }, () => 50); // sums to 600
    applierMocks.applyProposal.mockReturnValue({
      lines: [
        {
          code: '601-01-01',
          label: 'Revenue A',
          plannedAnnual: 1380,
          accountType: 'revenue',
          perMonth: seasonalPerMonth,
        },
        {
          code: '701-01-01',
          label: 'COGS A',
          plannedAnnual: 600,
          accountType: 'cogs',
          perMonth: flatPerMonth,
        },
      ],
      warnings: [],
      parentRollupsDropped: [],
      parentRollupsUnallocated: [],
    });
    applierMocks.detectProposalYear.mockReturnValue(2026);

    // Capture every tx.budgetLine.create call + the coa-cache spies so we
    // can also assert the cache prevents 12× redundant findUnique calls
    // per parsed line (architect Round-2 💡 closure).
    const budgetLineCreates: Array<Record<string, unknown>> = [];
    const coaFindUnique = vi.fn().mockResolvedValue(null);
    const coaCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: `coa-${data.code}`,
    }));
    prismaMock.$transaction.mockImplementation(
      async (cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          budgetPlan: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: 'plan-fresh' }),
          },
          budgetLine: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
              budgetLineCreates.push(data);
              return { id: `bl-${budgetLineCreates.length}` };
            }),
          },
          chartOfAccount: {
            findUnique: coaFindUnique,
            create: coaCreate,
          },
          importStaging: {
            update: vi.fn().mockResolvedValue({ id: STAGING_ID }),
          },
        };
        return await cb(tx);
      },
    );

    const req = await makeMultipartApplyRequest();
    const res = await POST(req, paramsFor(STAGING_ID));
    expect(res.status).toBe(200);

    // ── 12-row contract per parsed line ────────────────────────────
    expect(budgetLineCreates).toHaveLength(24); // 2 lines × 12 months

    // First parsed line — seasonal (codes 601-*).
    // Phase 2.1 session 3: filter by accountId (category column dropped);
    // coaCreate mock returns id=`coa-${data.code}`.
    const seasonalRows = budgetLineCreates.filter(
      (d) => d.accountId === 'coa-601-01-01',
    );
    expect(seasonalRows).toHaveLength(12);
    // sortOrder 0..11 distinct.
    const seasonalSortOrders = seasonalRows
      .map((r) => r.sortOrder)
      .sort((a: unknown, b: unknown) => (a as number) - (b as number));
    expect(seasonalSortOrders).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // plannedAmount mirrors perMonth[idx] exactly (no averaging).
    seasonalRows
      .sort((a, b) => (a.sortOrder as number) - (b.sortOrder as number))
      .forEach((r, idx) => {
        expect(r.plannedAmount).toBe(seasonalPerMonth[idx]);
        expect(r.isAutoPlanned).toBe(false); // xlsx-sourced (Turn 29 Bug #1b)
        expect(r.lineType).toBe('revenue');
        // Phase 7.G Turn XXXIX (L1 closure): every inserted line is
        // tagged with the company's baseCurrencyCode. Default mock
        // returns 'AZN' for AZMADE companies — see prismaMock at L37.
        expect(r.currencyCode).toBe('AZN');
      });
    // Sum invariant: ∑perMonth == plannedAnnual.
    const seasonalSum = seasonalRows.reduce(
      (s, r) => s + (r.plannedAmount as number),
      0,
    );
    expect(seasonalSum).toBe(1380);

    // Second parsed line — flat (codes 701-*, sign-flipped at applier
    // level; here the mock returned positive perMonth for simplicity).
    // Symmetric assertions with the seasonal block above (architect Round-2
    // ⚠️ closure: missing sortOrder-distinct + sum invariant for cogs).
    const cogsRows = budgetLineCreates.filter((d) => d.accountId === 'coa-701-01-01');
    expect(cogsRows).toHaveLength(12);
    const cogsSortOrders = cogsRows
      .map((r) => r.sortOrder)
      .sort((a: unknown, b: unknown) => (a as number) - (b as number));
    expect(cogsSortOrders).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    cogsRows.forEach((r) => {
      expect(r.plannedAmount).toBe(50);
      expect(r.lineType).toBe('cogs');
      expect(r.isAutoPlanned).toBe(false);
    });
    const cogsSum = cogsRows.reduce((s, r) => s + (r.plannedAmount as number), 0);
    expect(cogsSum).toBe(600);

    // ── Coa cache contract (architect Round-2 💡 closure) ───────────
    // The route's `coaCache` MUST prevent 12× redundant chartOfAccount
    // lookups per parsed line. With 2 distinct codes, findUnique should
    // fire exactly 2 times (once per code), not 24 (once per row).
    expect(coaFindUnique).toHaveBeenCalledTimes(2);
    // Both codes were missing → both went to create branch.
    expect(coaCreate).toHaveBeenCalledTimes(2);
  });

  it('already-applied row → 409 without audit', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    prismaMock.importStaging.findFirst.mockResolvedValue({
      id: STAGING_ID,
      companyId: COMPANY_ID,
      status: 'applied',
      sourceSheet: 'SOPL',
      proposal: {},
      userOverrides: null,
      expiresAt: new Date(Date.now() + 60_000),
      appliedAt: new Date(),
    });
    const req = makeRequest(
      `/api/onboarding/import/staging/${STAGING_ID}/apply`,
      { method: 'POST' },
    );
    const res = await POST(req, paramsFor(STAGING_ID));
    expect(res.status).toBe(409);
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  // Phase 7.G L425 — dry-run flag returns the same diagnostics shape but
  // skips the prisma transaction, audit emission, and recompute trigger.
  // Lets the wizard preview the apply result before the user commits.
  it('dryRun=true → 200 status="preview", skips $transaction + audit + recompute', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    prismaMock.importStaging.findFirst.mockResolvedValue({
      id: STAGING_ID,
      companyId: COMPANY_ID,
      status: 'pending',
      sourceSheet: 'SOPL',
      proposal: {
        columns: [{ sourceIndex: 2, role: 'amount:Plan2026' }],
        mappings: [],
      },
      userOverrides: null,
      expiresAt: new Date(Date.now() + 60_000),
      appliedAt: null,
    });
    applierMocks.applyProposal.mockReturnValue({
      lines: [
        { code: '601-01-01', label: 'Revenue A', plannedAnnual: 1000, accountType: 'revenue' },
        { code: '701-01-01', label: 'COGS A', plannedAnnual: 400, accountType: 'cogs' },
      ],
      warnings: [{ row: 5, reason: 'sample warning' }],
      parentRollupsDropped: [{ code: 'PARENT', plannedAnnual: 1400 }],
      parentRollupsUnallocated: [],
    });
    applierMocks.detectProposalYear.mockReturnValue(2026);
    // Existing plan with 24 lines that WOULD be deleted on a real apply.
    prismaMock.budgetPlan.findFirst.mockResolvedValue({ id: 'plan_existing' });
    prismaMock.budgetLine.count.mockResolvedValue(24);

    const fd = new FormData();
    fd.set('file', new File(['fake'], 'aac.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));
    fd.set('dryRun', 'true');
    const base = new Request(
      `http://localhost/api/onboarding/import/staging/${STAGING_ID}/apply`,
      { method: 'POST', body: fd },
    );
    const { NextRequest } = await import('next/server');
    const req = new NextRequest(base);

    const res = await POST(req, paramsFor(STAGING_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      stagingId: STAGING_ID,
      status: 'preview',
      dryRun: true,
      year: 2026,
      inserted: 2,                  // applyResult.lines.length
      deleted: 24,                  // existing plan's BudgetLine count
      warnings: 1,                  // applyResult.warnings.length
      parentRollupsDropped: 1,      // applyResult.parentRollupsDropped.length
      parentRollupsUnallocated: 0,
    });

    // Critical contract: dry-run does NOT mutate state.
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
    expect(recomputeMock.runRecomputeForCompanies).not.toHaveBeenCalled();
    expect(prismaMock.importStaging.update).not.toHaveBeenCalled();
    expect(prismaMock.importStaging.updateMany).not.toHaveBeenCalled();
  });

  it('dryRun=true on a fresh org (no existing plan) → deleted=0', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    prismaMock.importStaging.findFirst.mockResolvedValue({
      id: STAGING_ID,
      companyId: COMPANY_ID,
      status: 'pending',
      sourceSheet: 'SOPL',
      proposal: {
        columns: [{ sourceIndex: 2, role: 'amount:Plan2027' }],
        mappings: [],
      },
      userOverrides: null,
      expiresAt: new Date(Date.now() + 60_000),
      appliedAt: null,
    });
    applierMocks.applyProposal.mockReturnValue({
      lines: [{ code: '601-01-01', label: 'Revenue', plannedAnnual: 1000, accountType: 'revenue' }],
      warnings: [],
      parentRollupsDropped: [],
      parentRollupsUnallocated: [],
    });
    applierMocks.detectProposalYear.mockReturnValue(2027);
    // No existing plan — fresh org-year combo.
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null);

    const fd = new FormData();
    fd.set('file', new File(['fake'], 'aac.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));
    fd.set('dryRun', '1'); // alternative truthy value
    const base = new Request(
      `http://localhost/api/onboarding/import/staging/${STAGING_ID}/apply`,
      { method: 'POST', body: fd },
    );
    const { NextRequest } = await import('next/server');
    const req = new NextRequest(base);

    const res = await POST(req, paramsFor(STAGING_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(0);
    expect(body.inserted).toBe(1);
    expect(body.dryRun).toBe(true);
    // No call to budgetLine.count when no plan exists (skip the lookup).
    expect(prismaMock.budgetLine.count).not.toHaveBeenCalled();
  });
});
