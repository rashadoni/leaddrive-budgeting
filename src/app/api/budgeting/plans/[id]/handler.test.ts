/**
 * Handler tests for `/api/budgeting/plans/[id]` PUT (Phase C batch 2).
 *
 * Closes the runtime-proof gap from Turn 25 Phase B: `budget_plan_approve`
 * audit emission was wired but never tested at the handler level.
 *
 * Scope: PUT approve/reject branches + audit emission. GET tested
 * implicitly via Turn-25 Phase A defense-in-depth (line 154 fix).
 *
 * Mocks: `@/lib/auth`, `@/lib/prisma`, `@/lib/notifications`,
 * `@/lib/cost-model/db` (loadAndCompute returns null → skips
 * auto-planned line update path; that path is exercised separately
 * in cost-model-map unit tests).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock, costModelMock, notifMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    budgetLine: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    budgetDepartmentOwner: { findMany: vi.fn() },
    budgetApprovalComment: { create: vi.fn() },
    user: { findMany: vi.fn() },
    salesForecast: { findMany: vi.fn() },
    expenseForecast: { findMany: vi.fn() },
    auditEvent: { create: vi.fn() },
    // Phase L8 finish — PUT now consults Organization.lockedPeriods
    // before allowing the mutation. Stub returns [] so no lock matches
    // existing test scenarios; tests that exercise the gate explicitly
    // override.
    organization: { findUnique: vi.fn() },
  },
  costModelMock: { loadAndCompute: vi.fn() },
  notifMock: { createNotification: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
// Stage 3 RLS — GET/PUT/DELETE wrap DB access in withOrgScope; hand the
// mock straight to the callback so the handler test stays DB-free.
vi.mock('@/lib/db/with-org-scope', () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}));
vi.mock('@/lib/cost-model/db', () => costModelMock);
vi.mock('@/lib/notifications', () => notifMock);

import { mockSession, makeRequest } from '@/test/api-harness';
import { PUT } from './route';

const ORG_ID = 'org_az';
const PLAN_ID = 'plan_2026';

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  prismaMock.budgetPlan.findFirst.mockReset();
  prismaMock.budgetPlan.updateMany.mockReset();
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([]);
  prismaMock.budgetLine.updateMany.mockReset();
  prismaMock.budgetDepartmentOwner.findMany.mockReset().mockResolvedValue([]);
  prismaMock.budgetApprovalComment.create.mockReset().mockResolvedValue({});
  prismaMock.user.findMany.mockReset().mockResolvedValue([]);
  prismaMock.salesForecast.findMany.mockReset().mockResolvedValue([]);
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] });
  // Phase L8 finish — PUT now starts with a findFirst to load the plan
  // for the period-lock check. Default mock returns a plain plan (year
  // 2026, no lock) so legacy tests keep working; tests that use
  // mockResolvedValueOnce for their own findFirst chain need to set
  // this stub BEFORE their own .mockResolvedValueOnce so the gate's
  // call gets the "no lock" value first, then the priorPlan stub.
  prismaMock.budgetPlan.findFirst.mockResolvedValue({
    id: PLAN_ID,
    periodType: 'yearly',
    year: 2026,
    month: null,
    quarter: null,
  });
  prismaMock.expenseForecast.findMany.mockReset().mockResolvedValue([]);
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: 'audit_1' });
  costModelMock.loadAndCompute.mockReset().mockResolvedValue(null);
  notifMock.createNotification.mockReset().mockResolvedValue({});
});

describe('PUT /api/budgeting/plans/[id] — handler', () => {
  it('returns 401 when unauthenticated', async () => {
    await mockSession(null);
    const res = await PUT(
      makeRequest(`/api/budgeting/plans/${PLAN_ID}`, {
        method: 'PUT',
        json: { status: 'approved' },
      }),
      paramsFor(PLAN_ID),
    );
    expect(res.status).toBe(401);
    expect(prismaMock.budgetPlan.updateMany).not.toHaveBeenCalled();
  });

  it('returns 403 on approve when caller is editor without department-approver flag', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_editor', role: 'editor' });
    // budgetDepartmentOwner.findMany returns empty → no canApprove dept → 403
    const res = await PUT(
      makeRequest(`/api/budgeting/plans/${PLAN_ID}`, {
        method: 'PUT',
        json: { status: 'approved' },
      }),
      paramsFor(PLAN_ID),
    );
    expect(res.status).toBe(403);
    expect(prismaMock.budgetPlan.updateMany).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid status enum', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    const res = await PUT(
      makeRequest(`/api/budgeting/plans/${PLAN_ID}`, {
        method: 'PUT',
        json: { status: 'garbage' },
      }),
      paramsFor(PLAN_ID),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 404 (not 403) when plan belongs to a different org (existence-leak guard)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    prismaMock.budgetPlan.updateMany.mockResolvedValue({ count: 0 });
    const res = await PUT(
      makeRequest(`/api/budgeting/plans/${PLAN_ID}`, {
        method: 'PUT',
        json: { status: 'closed' }, // simple status, no priorPlan fetch
      }),
      paramsFor(PLAN_ID),
    );
    expect(res.status).toBe(404);
  });

  it('emits budget_plan_approve on approve transition with full metadata', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_admin', role: 'admin' });
    // priorPlan fetch (only when status==='approved')
    prismaMock.budgetPlan.findFirst
      // Phase L8 finish — the approve-branch gate adds an early findFirst
      // to load period info for the lock check. Returns a plain plan
      // shape (no year override → fallback "no lock"). Then the original
      // chain follows.
      .mockResolvedValueOnce({ id: PLAN_ID, periodType: 'yearly', year: 2026, month: null, quarter: null })
      .mockResolvedValueOnce({ status: 'pending_approval', name: 'AZMADE 2026' }) // priorPlan
      .mockResolvedValueOnce({ id: PLAN_ID, status: 'approved', year: 2026 }); // post-update fetch
    prismaMock.budgetPlan.updateMany.mockResolvedValue({ count: 1 });

    const res = await PUT(
      makeRequest(`/api/budgeting/plans/${PLAN_ID}`, {
        method: 'PUT',
        json: { status: 'approved' },
        headers: { 'user-agent': 'TestRunner/1.0' },
      }),
      paramsFor(PLAN_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.auditStale).toBe(false);

    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(1);
    const auditCall = prismaMock.auditEvent.create.mock.calls[0][0];
    expect(auditCall.data.action).toBe('budget_plan_approve');
    expect(auditCall.data.entityType).toBe('BudgetPlan');
    expect(auditCall.data.entityId).toBe(PLAN_ID);
    expect(auditCall.data.actorUserId).toBe('u_admin');
    expect(auditCall.data.metadata).toEqual({
      planName: 'AZMADE 2026',
      approvedBy: 'u_admin',
      priorStatus: 'pending_approval',
    });
    // Forensics context picks up user-agent.
    expect(auditCall.data.context).toMatchObject({
      route: '/api/budgeting/plans/[id]',
      userAgent: 'TestRunner/1.0',
    });
  });

  it('preserves priorStatus across approve-after-reject (priorStatus="rejected")', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_admin', role: 'admin' });
    prismaMock.budgetPlan.findFirst
      // Phase L8 finish — gate's findFirst first.
      .mockResolvedValueOnce({ id: PLAN_ID, periodType: 'yearly', year: 2026, month: null, quarter: null })
      .mockResolvedValueOnce({ status: 'rejected', name: 'AZMADE 2026' })
      .mockResolvedValueOnce({ id: PLAN_ID, status: 'approved', year: 2026 });
    prismaMock.budgetPlan.updateMany.mockResolvedValue({ count: 1 });

    const res = await PUT(
      makeRequest(`/api/budgeting/plans/${PLAN_ID}`, {
        method: 'PUT',
        json: { status: 'approved' },
      }),
      paramsFor(PLAN_ID),
    );
    expect(res.status).toBe(200);
    const auditCall = prismaMock.auditEvent.create.mock.calls[0][0];
    expect(auditCall.data.metadata.priorStatus).toBe('rejected');
  });

  it('does NOT emit audit on reject transition (only approve emits)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_admin', role: 'admin' });
    prismaMock.budgetPlan.findFirst.mockResolvedValueOnce({
      id: PLAN_ID,
      status: 'rejected',
    });
    prismaMock.budgetPlan.updateMany.mockResolvedValue({ count: 1 });

    const res = await PUT(
      makeRequest(`/api/budgeting/plans/${PLAN_ID}`, {
        method: 'PUT',
        json: { status: 'rejected', rejectedReason: 'Q1 numbers off' },
      }),
      paramsFor(PLAN_ID),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it('surfaces auditStale: true when audit emission fails (never-throws)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_admin', role: 'admin' });
    prismaMock.budgetPlan.findFirst
      .mockResolvedValueOnce({ status: 'pending_approval', name: 'AZMADE 2026' })
      .mockResolvedValueOnce({ id: PLAN_ID, status: 'approved', year: 2026 });
    prismaMock.budgetPlan.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.auditEvent.create.mockRejectedValue(new Error('audit DB down'));
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await PUT(
      makeRequest(`/api/budgeting/plans/${PLAN_ID}`, {
        method: 'PUT',
        json: { status: 'approved' },
      }),
      paramsFor(PLAN_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.auditStale).toBe(true);
    consoleErr.mockRestore();
  });
});
