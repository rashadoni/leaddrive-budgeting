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
// `applyProposal` / `detectProposalYear` are stubbed (they need a real
// workbook); `mergeProposal` is NOT. It computes the mapping the B5 revision
// is fingerprinted from, so stubbing it would let the lineage tests assert a
// mapping id derived from a mock rather than from the proposal actually
// applied — which is the one thing those tests exist to disprove.
vi.mock('@/lib/onboarding/ai-mapper/applier', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/lib/onboarding/ai-mapper/applier')
  >();
  return { ...actual, ...applierMocks };
});
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
            updateMany: vi.fn().mockResolvedValue({ count: 1 }), // concurrency claim
            update: vi.fn().mockResolvedValue({ id: STAGING_ID }),
          },
          // Phase 10 / Stage B5 — the apply transaction now also pins the
          // source state it commits (`ensureDataRevision`). Stubbed here so
          // this test keeps its scope (the 12-row BudgetLine contract);
          // lineage itself is asserted in the B5 block below.
          dataRevision: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: 'rev_1' }),
          },
          user: { findUnique: vi.fn().mockResolvedValue({ id: 'u_mgr' }) },
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
      // Phase 2 — control-total verdict (1 parent, 0 unallocated → reconciles).
      controlVerdict: 'green',
      controlNoData: false,
      controlTotals: [],
      // Phase A validation engine — revenue+cogs present, green control → certified.
      validationVerdict: 'certified',
      validationFindings: [],
      rowTotalMismatches: 0,
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

// ── Server-side review gates (Codex P1 #1, 2026-06-20) ─────────────────
// A direct POST to /apply (no dryRun) must NOT bypass the wizard's gates.
// RED control-total = hard 409; critical anomalies + low confidence need
// explicit acknowledgement form fields.
describe('POST .../apply — server-side review gates', () => {
  function stage(proposal: unknown) {
    prismaMock.importStaging.findFirst.mockResolvedValue({
      id: STAGING_ID,
      companyId: COMPANY_ID,
      status: 'pending',
      sourceSheet: 'SOPL',
      proposal,
      userOverrides: null,
      expiresAt: new Date(Date.now() + 60_000),
      appliedAt: null,
    });
  }
  async function applyReqWith(fields: Record<string, string>): Promise<NextRequestType> {
    const fd = new FormData();
    fd.set('file', new File(['fake'], 'aac.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    const base = new Request(
      `http://localhost/api/onboarding/import/staging/${STAGING_ID}/apply`,
      { method: 'POST', body: fd },
    );
    const { NextRequest } = await import('next/server');
    return new NextRequest(base);
  }

  beforeEach(() => {
    applierMocks.detectProposalYear.mockReturnValue(2026);
  });

  it('RED control-total → 409 hard block, no transaction', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    stage({ columns: [{ sourceIndex: 0, role: 'code', confidence: 1 }], anomalies: [], overallConfidence: 0.95, mappings: [] });
    applierMocks.applyProposal.mockReturnValue({
      lines: [{ code: 'X', label: 'X', plannedAnnual: 1000, accountType: 'revenue' }],
      warnings: [],
      parentRollupsDropped: [{ code: 'P', plannedAnnual: 1000 }],
      parentRollupsUnallocated: [{ parentCode: 'P', plannedAnnual: 500 }], // 50% delta → red
    });
    const res = await POST(await applyReqWith({}), paramsFor(STAGING_ID));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.controlVerdict).toBe('red');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('critical anomaly without acknowledgeAnomalies → 409', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    stage({ columns: [{ sourceIndex: 0, role: 'code', confidence: 1 }], anomalies: [{ row: 5, severity: 'critical', category: 'sign_inversion', description: 'x' }], overallConfidence: 0.95, mappings: [] });
    applierMocks.applyProposal.mockReturnValue({ lines: [{ code: 'X', label: 'X', plannedAnnual: 1, accountType: 'revenue' }], warnings: [], parentRollupsDropped: [], parentRollupsUnallocated: [] });
    const res = await POST(await applyReqWith({}), paramsFor(STAGING_ID));
    expect(res.status).toBe(409);
    expect((await res.json()).requiresAcknowledgement).toBe('acknowledgeAnomalies');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('low-confidence column without acknowledgeLowConfidence → 409', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    stage({ columns: [{ sourceIndex: 0, role: 'code', confidence: 0.3 }], anomalies: [], overallConfidence: 0.95, mappings: [] });
    applierMocks.applyProposal.mockReturnValue({ lines: [{ code: 'X', label: 'X', plannedAnnual: 1, accountType: 'revenue' }], warnings: [], parentRollupsDropped: [], parentRollupsUnallocated: [] });
    const res = await POST(await applyReqWith({}), paramsFor(STAGING_ID));
    expect(res.status).toBe(409);
    expect((await res.json()).requiresAcknowledgement).toBe('acknowledgeLowConfidence');
  });

  it('critical anomaly WITH acknowledgement → passes the gate and commits', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    stage({ columns: [{ sourceIndex: 0, role: 'code', confidence: 1 }], anomalies: [{ row: 5, severity: 'critical', category: 'sign_inversion', description: 'x' }], overallConfidence: 0.95, mappings: [] });
    applierMocks.applyProposal.mockReturnValue({ lines: [{ code: 'X', label: 'X', plannedAnnual: 1, accountType: 'revenue' }], warnings: [], parentRollupsDropped: [], parentRollupsUnallocated: [] });
    prismaMock.$transaction.mockResolvedValue({ inserted: 1, deleted: 0, warnings: 0, parentRollupsDropped: 0, parentRollupsUnallocated: 0 });
    const res = await POST(await applyReqWith({ acknowledgeAnomalies: 'true' }), paramsFor(STAGING_ID));
    expect(res.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });
});

// ── Codex pre-prod fixes (2026-06-20) ──────────────────────────────────
describe("POST .../apply — Codex pre-prod guards", () => {
  it("P0 #1: rejects a multi-entity staging (entity column) → 422, no tx", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_mgr", role: "manager" });
    prismaMock.importStaging.findFirst.mockResolvedValue({
      id: STAGING_ID, companyId: COMPANY_ID, status: "pending", sourceSheet: "SOPL",
      proposal: { columns: [{ sourceIndex: 0, role: "code" }, { sourceIndex: 5, role: "entity" }] },
      userOverrides: null, expiresAt: new Date(Date.now() + 60_000), appliedAt: null,
    });
    const res = await POST(await makeMultipartApplyRequest(), paramsFor(STAGING_ID));
    expect(res.status).toBe(422);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("P0 #2: 409 + no delete when the concurrency claim loses (count 0)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_mgr", role: "manager" });
    prismaMock.importStaging.findFirst.mockResolvedValue({
      id: STAGING_ID, companyId: COMPANY_ID, status: "pending", sourceSheet: "SOPL",
      proposal: { columns: [{ sourceIndex: 2, role: "amount:Plan2026" }] },
      userOverrides: null, expiresAt: new Date(Date.now() + 60_000), appliedAt: null,
    });
    applierMocks.applyProposal.mockReturnValue({
      lines: [{ code: "601", label: "R", accountType: "revenue", plannedAnnual: 1200, perMonth: Array(12).fill(100) }],
      warnings: [], parentRollupsDropped: [], parentRollupsUnallocated: [],
    });
    applierMocks.detectProposalYear.mockReturnValue(2026);
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        importStaging: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), update: vi.fn() }, // lost the claim
        budgetPlan: { findFirst: vi.fn().mockResolvedValue({ id: "plan1" }), create: vi.fn() },
        budgetLine: { deleteMany, create: vi.fn() },
        chartOfAccount: { findUnique: vi.fn(), create: vi.fn() },
      };
      return cb(tx);
    });
    const res = await POST(await makeMultipartApplyRequest(), paramsFor(STAGING_ID));
    expect(res.status).toBe(409);
    // The claim is the FIRST tx op — delete must never run when it loses.
    expect(deleteMany).not.toHaveBeenCalled();
  });
});

/**
 * Phase 10 / Stage B5 — the production lineage writer.
 *
 * This is the block that proves lineage is *recorded*, not merely recordable.
 * It runs the real `$transaction` callback against a tx-spy, so the revision
 * write and the ids it carries are the route's, not a fixture's.
 *
 * What it deliberately does NOT claim: three-way atomicity across apply +
 * revision + IndicatorValue. Recompute is post-commit on this route (and on
 * every import path here), per 03-DATA-KPI-TRUST-SPEC §6.1/§6.4. The tests
 * below pin the boundary that does hold — apply ↔ revision — and pin the
 * post-commit hand-off of the revisionId.
 */
describe('POST /api/onboarding/import/staging/[id]/apply — B5 lineage writer', () => {
  const REVISION_ID = 'rev_committed_1';

  type TxSpy = {
    dataRevisionCreate: ReturnType<typeof vi.fn>;
    dataRevisionFindFirst: ReturnType<typeof vi.fn>;
    budgetLineCreate: ReturnType<typeof vi.fn>;
  };

  /** Wire `$transaction` to actually run the route's callback. */
  function wireTx(opts: {
    existingRevision?: { id: string } | null;
    onRevisionCreate?: () => unknown;
    failBudgetLine?: boolean;
    claimCount?: number;
  } = {}): TxSpy {
    const dataRevisionFindFirst = vi
      .fn()
      .mockResolvedValue(opts.existingRevision ?? null);
    const dataRevisionCreate = vi.fn(async () => {
      if (opts.onRevisionCreate) return opts.onRevisionCreate();
      return { id: REVISION_ID };
    });
    const budgetLineCreate = vi.fn(async () => {
      if (opts.failBudgetLine) throw new Error('BUDGET_LINE_WRITE_FAILED');
      return { id: 'bl_1' };
    });
    prismaMock.$transaction.mockImplementation(
      async (cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          budgetPlan: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: 'plan_1' }),
          },
          budgetLine: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            create: budgetLineCreate,
          },
          chartOfAccount: {
            findUnique: vi.fn().mockResolvedValue(null),
            create: vi.fn(async ({ data }: { data: { code: string } }) => ({
              id: `coa_${data.code}`,
            })),
          },
          importStaging: {
            updateMany: vi
              .fn()
              .mockResolvedValue({ count: opts.claimCount ?? 1 }),
            update: vi.fn().mockResolvedValue({ id: STAGING_ID }),
          },
          dataRevision: {
            findFirst: dataRevisionFindFirst,
            create: dataRevisionCreate,
          },
          // B5 actor resolution (nullable/SetNull contract) reads the user.
          user: { findUnique: vi.fn().mockResolvedValue({ id: 'u_mgr' }) },
        };
        // A real interactive transaction rolls back on a throw. Let it
        // propagate exactly as Prisma would; the route's catch handles it.
        return await cb(tx);
      },
    );
    return { dataRevisionCreate, dataRevisionFindFirst, budgetLineCreate };
  }

  function stageStagingRow(proposal?: Record<string, unknown>) {
    prismaMock.importStaging.findFirst.mockResolvedValue({
      id: STAGING_ID,
      companyId: COMPANY_ID,
      status: 'pending',
      sourceFile: 'aac.xlsx',
      sourceSheet: 'SOPL',
      proposal: proposal ?? {
        columns: [
          { sourceIndex: 0, role: 'code', confidence: 0.9, reasoning: 'codes' },
          { sourceIndex: 2, role: 'amount:Plan2026', confidence: 0.8, reasoning: 'amounts' },
        ],
        accountTypeOverrides: [],
        anomalies: [],
      },
      userOverrides: null,
      expiresAt: new Date(Date.now() + 60_000),
      appliedAt: null,
    });
    applierMocks.applyProposal.mockReturnValue({
      lines: [
        {
          code: '601-01',
          label: 'Revenue',
          plannedAnnual: 1200,
          accountType: 'revenue',
          perMonth: Array.from({ length: 12 }, () => 100),
        },
      ],
      warnings: [],
      parentRollupsDropped: [],
      parentRollupsUnallocated: [],
    });
    applierMocks.detectProposalYear.mockReturnValue(2026);
  }

  it('creates the revision inside the apply transaction with REAL artifact + mapping ids', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    stageStagingRow();
    const spy = wireTx();

    const res = await POST(await makeMultipartApplyRequest(), paramsFor(STAGING_ID));
    expect(res.status).toBe(200);

    expect(spy.dataRevisionCreate).toHaveBeenCalledTimes(1);
    const data = spy.dataRevisionCreate.mock.calls[0][0].data;
    expect(data.organizationId).toBe(ORG_ID);
    expect(data.companyIds).toEqual([COMPANY_ID]);
    expect(data.reason).toBe('import');
    expect(data.createdById).toBe('u_mgr');
    // The artifact is the staging row that was actually applied — not a
    // filename, not a constant.
    expect(data.sourceArtifactIds).toEqual([`import-staging:${STAGING_ID}`]);
    // The mapping id is derived from the proposal actually applied.
    expect(data.mappingVersionIds).toHaveLength(1);
    expect(data.mappingVersionIds[0]).toMatch(/^effective-mapping:[0-9a-f]{64}$/);
    // The period range is the fiscal year the apply wrote.
    expect(data.periodFrom).toBe('2026-01');
    expect(data.periodTo).toBe('2026-12');
    // No placeholder ever reaches the database.
    for (const id of [...data.sourceArtifactIds, ...data.mappingVersionIds]) {
      expect(id).not.toMatch(/unknown|placeholder|todo|tbd/i);
    }
  });

  it('passes the committed revisionId to recomputeIndicator via the trigger', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    stageStagingRow();
    wireTx();

    await POST(await makeMultipartApplyRequest(), paramsFor(STAGING_ID));

    expect(recomputeMock.runRecomputeForCompanies).toHaveBeenCalledTimes(1);
    const call = recomputeMock.runRecomputeForCompanies.mock.calls[0];
    // 4th arg is RunRecomputeOptions — this is the hand-off that makes the
    // IndicatorValue rows traceable.
    expect(call[4]).toMatchObject({ revisionId: REVISION_ID });
    // And it is scoped to the company/year the apply touched.
    expect(call[2]).toEqual([{ companyId: COMPANY_ID, year: 2026 }]);
  });

  it('surfaces the revisionId on the apply response (additively)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    stageStagingRow();
    wireTx();

    const res = await POST(await makeMultipartApplyRequest(), paramsFor(STAGING_ID));
    const body = await res.json();
    expect(body.revisionId).toBe(REVISION_ID);
    // Pre-existing response contract is untouched.
    expect(body).toMatchObject({ stagingId: STAGING_ID, status: 'applied', year: 2026 });
  });

  it('reuses an identical revision rather than creating a duplicate', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    stageStagingRow();
    const spy = wireTx({ existingRevision: { id: 'rev_existing' } });

    await POST(await makeMultipartApplyRequest(), paramsFor(STAGING_ID));

    // Found by content hash → no second row, and the existing id is what
    // the observations get traced to.
    expect(spy.dataRevisionCreate).not.toHaveBeenCalled();
    expect(recomputeMock.runRecomputeForCompanies.mock.calls[0][4]).toMatchObject({
      revisionId: 'rev_existing',
    });
  });

  it('a failed source write rolls back the revision with the apply — and never recomputes', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    stageStagingRow();
    const spy = wireTx({ failBudgetLine: true });
    prismaMock.importStaging.update.mockResolvedValue({ id: STAGING_ID });

    const res = await POST(await makeMultipartApplyRequest(), paramsFor(STAGING_ID));

    expect(res.status).toBe(500);
    // The revision write is downstream of the failing line write, so it is
    // never even attempted; had it been, the transaction throw would undo it.
    expect(spy.dataRevisionCreate).not.toHaveBeenCalled();
    // No revision, no import → nothing to trace, so nothing is recomputed.
    expect(recomputeMock.runRecomputeForCompanies).not.toHaveBeenCalled();
  });

  it('a failed revision write rolls back the apply — no untraceable import commits', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    stageStagingRow();
    const spy = wireTx({
      onRevisionCreate: () => {
        throw new Error('REVISION_WRITE_FAILED');
      },
    });
    prismaMock.importStaging.update.mockResolvedValue({ id: STAGING_ID });

    const res = await POST(await makeMultipartApplyRequest(), paramsFor(STAGING_ID));

    // The import lines were written in this transaction; the revision throw
    // takes them down with it. An import that cannot say where it came from
    // does not land.
    expect(res.status).toBe(500);
    expect(spy.budgetLineCreate).toHaveBeenCalled(); // it tried
    expect(recomputeMock.runRecomputeForCompanies).not.toHaveBeenCalled();
  });

  it('a repeat apply of the same staging creates no second revision', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    stageStagingRow();
    // The concurrency claim is what makes apply once-only: the second POST
    // sees count 0 and throws STAGING_RACE before any write lands.
    const spy = wireTx({ claimCount: 0 });

    const res = await POST(await makeMultipartApplyRequest(), paramsFor(STAGING_ID));

    expect(res.status).toBe(409);
    expect(spy.dataRevisionCreate).not.toHaveBeenCalled();
    expect(recomputeMock.runRecomputeForCompanies).not.toHaveBeenCalled();
  });

  it('a recompute failure does not roll back the revision — and is reported, not hidden', async () => {
    // This pins the boundary honestly rather than pretending it is stronger
    // than it is. Recompute is post-commit here; a failure leaves the import
    // and its revision committed, with `indicatorsStale` telling the truth.
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    stageStagingRow();
    const spy = wireTx();
    recomputeMock.runRecomputeForCompanies.mockResolvedValue({
      ok: 0,
      unknown: 0,
      failed: 3,
      targets: 3,
    });

    const res = await POST(await makeMultipartApplyRequest(), paramsFor(STAGING_ID));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(spy.dataRevisionCreate).toHaveBeenCalledTimes(1);
    expect(body.indicatorsStale).toBe(true);
    expect(body.revisionId).toBe(REVISION_ID);
  });
});
