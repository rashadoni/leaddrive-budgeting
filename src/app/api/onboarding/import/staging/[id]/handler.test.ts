/**
 * Handler tests for `GET /api/onboarding/import/staging/[id]` — covers
 * the lazy-flip path where a `pending` row past `expiresAt` is
 * transitioned to `expired` and an `import_staging_expired` audit event
 * is emitted (race-guarded by `flipResult.count === 1`).
 *
 * This is the FIRST runtime proof of an audit-emission write-side path
 * — Turn 17 backfilled events via psql, the architect Round-1 review
 * flagged that the actual `logAuditEvent` call was never exercised at
 * runtime. Now it is.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    importStaging: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { mockSession, makeRequest } from '@/test/api-harness';
import { GET } from './route';

const ORG_ID = 'org_az';
const STAGING_ID = 'staging_1';
const COMPANY_ID = 'co_aac';

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  prismaMock.importStaging.findFirst.mockReset();
  prismaMock.importStaging.updateMany.mockReset();
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: 'audit_1' });
});

describe('GET /api/onboarding/import/staging/[id] — handler', () => {
  it('returns 401 when unauthenticated', async () => {
    await mockSession(null);
    const res = await GET(
      makeRequest(`/api/onboarding/import/staging/${STAGING_ID}`),
      paramsFor(STAGING_ID),
    );
    expect(res.status).toBe(401);
    expect(prismaMock.importStaging.findFirst).not.toHaveBeenCalled();
  });

  it('returns 404 (not 403) on cross-tenant id — existence-leak guard', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    prismaMock.importStaging.findFirst.mockResolvedValue(null);
    const res = await GET(
      makeRequest(`/api/onboarding/import/staging/${STAGING_ID}`),
      paramsFor(STAGING_ID),
    );
    expect(res.status).toBe(404);
    const call = prismaMock.importStaging.findFirst.mock.calls[0][0];
    expect(call.where).toEqual({ id: STAGING_ID, organizationId: ORG_ID });
  });

  it('returns active pending row as JSON without firing audit', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    const future = new Date(Date.now() + 60_000);
    prismaMock.importStaging.findFirst.mockResolvedValue({
      id: STAGING_ID,
      organizationId: ORG_ID,
      companyId: COMPANY_ID,
      status: 'pending',
      sourceFile: 'aac.xlsx',
      sourceSheet: 'SOPL',
      proposal: { mappings: [] },
      userOverrides: null,
      createdAt: new Date(),
      expiresAt: future,
      appliedAt: null,
    });
    const res = await GET(
      makeRequest(`/api/onboarding/import/staging/${STAGING_ID}`),
      paramsFor(STAGING_ID),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
    // Defensive: a not-yet-expired row must NOT trigger the lazy flip,
    // otherwise a refactor that loosens the expiresAt check would silently
    // mark live rows as expired.
    expect(prismaMock.importStaging.updateMany).not.toHaveBeenCalled();
  });

  it('lazy-flips expired pending row + emits import_staging_expired audit (winning racer)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_admin', role: 'admin' });
    const past = new Date(Date.now() - 60_000);
    prismaMock.importStaging.findFirst.mockResolvedValue({
      id: STAGING_ID,
      organizationId: ORG_ID,
      companyId: COMPANY_ID,
      status: 'pending',
      sourceFile: 'aac.xlsx',
      sourceSheet: 'SOPL',
      proposal: {},
      userOverrides: null,
      createdAt: new Date(past.getTime() - 60_000),
      expiresAt: past,
      appliedAt: null,
    });
    // We won the race — count===1 → audit fires.
    prismaMock.importStaging.updateMany.mockResolvedValue({ count: 1 });

    const res = await GET(
      makeRequest(`/api/onboarding/import/staging/${STAGING_ID}`),
      paramsFor(STAGING_ID),
    );
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.status).toBe('expired');

    expect(prismaMock.importStaging.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(1);
    const auditCall = prismaMock.auditEvent.create.mock.calls[0][0];
    expect(auditCall.data.action).toBe('import_staging_expired');
    expect(auditCall.data.entityType).toBe('ImportStaging');
    expect(auditCall.data.entityId).toBe(STAGING_ID);
    expect(auditCall.data.actorUserId).toBe('u_admin');
    expect(auditCall.data.metadata).toMatchObject({
      companyId: COMPANY_ID,
      triggeredBy: 'lazy_get',
      expiresAt: past.toISOString(),
    });
  });

  it('does NOT emit audit when losing the lazy-flip race (count===0)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    const past = new Date(Date.now() - 60_000);
    prismaMock.importStaging.findFirst.mockResolvedValue({
      id: STAGING_ID,
      organizationId: ORG_ID,
      companyId: COMPANY_ID,
      status: 'pending',
      sourceFile: 'aac.xlsx',
      sourceSheet: 'SOPL',
      proposal: {},
      userOverrides: null,
      createdAt: new Date(past.getTime() - 60_000),
      expiresAt: past,
      appliedAt: null,
    });
    // Another reader won the race first.
    prismaMock.importStaging.updateMany.mockResolvedValue({ count: 0 });

    const res = await GET(
      makeRequest(`/api/onboarding/import/staging/${STAGING_ID}`),
      paramsFor(STAGING_ID),
    );
    expect(res.status).toBe(410);
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it('returns 410 for already-applied staging without audit', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    prismaMock.importStaging.findFirst.mockResolvedValue({
      id: STAGING_ID,
      organizationId: ORG_ID,
      companyId: COMPANY_ID,
      status: 'applied',
      sourceFile: 'aac.xlsx',
      sourceSheet: 'SOPL',
      proposal: {},
      userOverrides: null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      appliedAt: new Date(),
    });
    const res = await GET(
      makeRequest(`/api/onboarding/import/staging/${STAGING_ID}`),
      paramsFor(STAGING_ID),
    );
    expect(res.status).toBe(410);
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });
});
