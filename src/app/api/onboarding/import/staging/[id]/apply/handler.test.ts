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
});
