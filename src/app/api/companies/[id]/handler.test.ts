/**
 * First end-to-end handler test using the new `src/test/api-harness.ts`
 * scaffold. Covers `PATCH /api/companies/[id]` — the role-flip endpoint
 * landed in Turn 18 — at the handler level (not just the validator).
 *
 * What this proves end-to-end:
 *  1. The harness can boot a route module that transitively imports
 *     `next-auth` (vitest's resolver normally crashes on next-auth's
 *     subpath imports — we sidestep by mocking `@/lib/auth`).
 *  2. The auth gate (admin-only via `requireRole`) returns 401/403 as
 *     expected without hitting the DB.
 *  3. Tenant scoping returns 404 (not 403) on cross-org IDs — the
 *     existence-leak guard is enforced.
 *  4. Same-role PATCH is a true no-op: no `prisma.company.update` call
 *     AND no `prisma.auditEvent.create` call.
 *  5. Role change emits a `company_role_change` audit event with
 *     `from`/`to`/`companyCode` metadata matching the discriminated
 *     union in `src/lib/audit/log.ts`.
 *  6. Audit-log failure surfaces as `auditStale: true` in the response
 *     without aborting the mutation (never-throws contract).
 *
 * Mocking order matters: `vi.mock` calls are hoisted by vitest, but the
 * mock factories run lazily; we configure return values per test via the
 * harness `mockSession` + per-test `prisma.<model>.<method>.mockReset` /
 * `mockResolvedValue`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted mocks — must precede the route import. `vi.hoisted` lets us
// expose the mock fns to test bodies AND have them available inside the
// hoisted-to-top vi.mock factories (a plain const above vi.mock would
// be a ReferenceError because vi.mock runs before module init).
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    company: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

// Rate limiter is in-memory and process-global; reset its bucket
// between tests so 11+ tests in a row don't trip the 10/min cap.
const { rateLimitMock } = vi.hoisted(() => ({
  rateLimitMock: {
    enforceRateLimit: vi.fn().mockReturnValue(null),
    getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  },
}));
vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit')>(
    '@/lib/rate-limit',
  );
  return { ...actual, ...rateLimitMock };
});

import { mockSession, makeRequest } from '@/test/api-harness';
import { PATCH } from './route';

const COMPANY_ID = 'co_aac';
const ORG_ID = 'org_az';

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  prismaMock.company.findFirst.mockReset();
  prismaMock.company.update.mockReset();
  prismaMock.auditEvent.create.mockReset();
  rateLimitMock.enforceRateLimit.mockReset().mockReturnValue(null);
});

describe('PATCH /api/companies/[id] — handler', () => {
  it('returns 401 when unauthenticated', async () => {
    await mockSession(null);
    const req = makeRequest(`/api/companies/${COMPANY_ID}`, {
      method: 'PATCH',
      json: { role: 'admin' },
    });
    const res = await PATCH(req, paramsFor(COMPANY_ID));
    expect(res.status).toBe(401);
    expect(prismaMock.company.findFirst).not.toHaveBeenCalled();
  });

  it('returns 403 when caller is below admin role', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    const req = makeRequest(`/api/companies/${COMPANY_ID}`, {
      method: 'PATCH',
      json: { role: 'admin' },
    });
    const res = await PATCH(req, paramsFor(COMPANY_ID));
    expect(res.status).toBe(403);
    expect(prismaMock.company.findFirst).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid body shape', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_admin', role: 'admin' });
    const req = makeRequest(`/api/companies/${COMPANY_ID}`, {
      method: 'PATCH',
      json: { role: 'Admin' }, // typo — capital A
    });
    const res = await PATCH(req, paramsFor(COMPANY_ID));
    expect(res.status).toBe(400);
  });

  it('returns 404 (not 403) when company belongs to a different org', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_admin', role: 'admin' });
    prismaMock.company.findFirst.mockResolvedValue(null);
    const req = makeRequest(`/api/companies/${COMPANY_ID}`, {
      method: 'PATCH',
      json: { role: 'admin' },
    });
    const res = await PATCH(req, paramsFor(COMPANY_ID));
    expect(res.status).toBe(404);
    // Confirm the lookup was tenant-scoped — the where clause must
    // include organizationId, not just id.
    const call = prismaMock.company.findFirst.mock.calls[0][0];
    expect(call.where).toEqual({ id: COMPANY_ID, organizationId: ORG_ID });
  });

  it('returns 200 + skips update + skips audit on same-role no-op', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_admin', role: 'admin' });
    prismaMock.company.findFirst.mockResolvedValue({
      id: COMPANY_ID,
      code: 'AAC',
      role: 'operational',
    });
    const req = makeRequest(`/api/companies/${COMPANY_ID}`, {
      method: 'PATCH',
      json: { role: 'operational' },
    });
    const res = await PATCH(req, paramsFor(COMPANY_ID));
    expect(res.status).toBe(200);
    expect(prismaMock.company.update).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it('emits company_role_change audit event on real role change', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_admin', role: 'admin' });
    prismaMock.company.findFirst.mockResolvedValue({
      id: COMPANY_ID,
      code: 'AAC',
      role: 'operational',
    });
    prismaMock.company.update.mockResolvedValue({
      id: COMPANY_ID,
      code: 'AAC',
      role: 'admin',
    });
    prismaMock.auditEvent.create.mockResolvedValue({ id: 'audit_1' });

    const req = makeRequest(`/api/companies/${COMPANY_ID}`, {
      method: 'PATCH',
      json: { role: 'admin' },
      headers: { 'user-agent': 'TestRunner/1.0' },
    });
    const res = await PATCH(req, paramsFor(COMPANY_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: COMPANY_ID, code: 'AAC', role: 'admin' });

    expect(prismaMock.company.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(1);
    const auditCall = prismaMock.auditEvent.create.mock.calls[0][0];
    expect(auditCall.data.action).toBe('company_role_change');
    expect(auditCall.data.entityType).toBe('Company');
    expect(auditCall.data.entityId).toBe(COMPANY_ID);
    expect(auditCall.data.organizationId).toBe(ORG_ID);
    expect(auditCall.data.actorUserId).toBe('u_admin');
    expect(auditCall.data.metadata).toEqual({
      from: 'operational',
      to: 'admin',
      companyCode: 'AAC',
    });
    // Forensics context picks up the user-agent header (trimmed by buildAuditContext).
    expect(auditCall.data.context).toMatchObject({
      route: '/api/companies/[id]',
      userAgent: 'TestRunner/1.0',
    });
  });

  it('returns 429 when rate-limit denies the request', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_admin', role: 'admin' });
    // Simulate a rate-limit hit by returning a NextResponse from the
    // mocked enforcer — the route forwards it verbatim.
    const { NextResponse } = await import('next/server');
    rateLimitMock.enforceRateLimit.mockReturnValue(
      NextResponse.json({ error: 'rate' }, { status: 429 }),
    );
    const req = makeRequest(`/api/companies/${COMPANY_ID}`, {
      method: 'PATCH',
      json: { role: 'admin' },
    });
    const res = await PATCH(req, paramsFor(COMPANY_ID));
    expect(res.status).toBe(429);
    expect(prismaMock.company.findFirst).not.toHaveBeenCalled();
  });

  it('flags auditStale + skips emission when existing.role is unknown to the audit union (schema-drift guard)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_admin', role: 'admin' });
    // Simulate a future Prisma enum extension (e.g. `vendor`) that hasn't
    // been added to the audit metadata union yet. The runtime guard
    // `isValidCompanyRole` should refuse to emit malformed metadata and
    // surface auditStale instead.
    prismaMock.company.findFirst.mockResolvedValue({
      id: COMPANY_ID,
      code: 'AAC',
      role: 'vendor',
    });
    prismaMock.company.update.mockResolvedValue({
      id: COMPANY_ID,
      code: 'AAC',
      role: 'admin',
    });
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = makeRequest(`/api/companies/${COMPANY_ID}`, {
      method: 'PATCH',
      json: { role: 'admin' },
    });
    const res = await PATCH(req, paramsFor(COMPANY_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ auditStale: true });
    // Mutation still committed; emission skipped (not failed-via-throw).
    expect(prismaMock.company.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('surfaces auditStale: true when audit emission fails', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_admin', role: 'admin' });
    prismaMock.company.findFirst.mockResolvedValue({
      id: COMPANY_ID,
      code: 'AAC',
      role: 'operational',
    });
    prismaMock.company.update.mockResolvedValue({
      id: COMPANY_ID,
      code: 'AAC',
      role: 'admin',
    });
    prismaMock.auditEvent.create.mockRejectedValue(new Error('audit DB down'));
    // Suppress the never-throws console.error so test output stays clean.
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

    const req = makeRequest(`/api/companies/${COMPANY_ID}`, {
      method: 'PATCH',
      json: { role: 'admin' },
    });
    const res = await PATCH(req, paramsFor(COMPANY_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Mutation still applied; flag surfaces the soft failure.
    expect(body).toMatchObject({ id: COMPANY_ID, role: 'admin', auditStale: true });
    expect(prismaMock.company.update).toHaveBeenCalledTimes(1);
    consoleErr.mockRestore();
  });
});
