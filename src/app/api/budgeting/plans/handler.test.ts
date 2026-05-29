/**
 * Handler tests for `/api/budgeting/plans` POST + GET (Phase C batch 1).
 *
 * Closes the runtime-proof gap from Turn 25 Phase B: `budget_plan_create`
 * audit emission was wired but never tested at the handler level.
 *
 * Mocks: `@/lib/auth` (NextAuth), `@/lib/prisma` (full set), `@/lib/cost-
 * model/db` (loadAndCompute returns null → skips auto-populate cleanly),
 * `@/lib/notifications` (createNotification noop). Auto-populate's
 * downstream paths (forecast clone) are not exercised here — covered
 * by separate unit tests in src/lib/budgeting/cost-model-map.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock, costModelMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    budgetLine: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      create: vi.fn(),
    },
    salesForecast: { findMany: vi.fn() },
    expenseForecast: { findMany: vi.fn() },
    // Phase 8 — auto-populate clone reads/writes (quarterly fix test).
    salesBudgetLine: { findMany: vi.fn(), createMany: vi.fn() },
    cOGSBudgetLine: { findMany: vi.fn(), createMany: vi.fn() },
    balanceSheetLine: { findMany: vi.fn(), createMany: vi.fn() },
    budgetAssumption: { findMany: vi.fn(), createMany: vi.fn() },
    auditEvent: { create: vi.fn() },
    // Phase 5.2 Stage 2 — withOrgScope wraps budget_plans reads/writes.
    $transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
    ),
    $executeRawUnsafe: vi.fn(async () => 1),
  },
  costModelMock: { loadAndCompute: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/cost-model/db', () => costModelMock);

import { mockSession, makeRequest } from '@/test/api-harness';
import { POST, GET } from './route';

// Phase 5.2 — withOrgScope validates 20-32 char cuid-shaped orgId.
const ORG_ID = 'cm3rlsplans0000001abc';
const PLAN_ID = 'plan_new_2026';

beforeEach(() => {
  prismaMock.budgetPlan.findMany.mockReset().mockResolvedValue([]);
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue(null);
  prismaMock.budgetPlan.create.mockReset();
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([]);
  prismaMock.budgetLine.createMany.mockReset();
  prismaMock.budgetLine.create.mockReset();
  prismaMock.salesBudgetLine.findMany.mockReset().mockResolvedValue([]);
  prismaMock.cOGSBudgetLine.findMany.mockReset().mockResolvedValue([]);
  prismaMock.balanceSheetLine.findMany.mockReset().mockResolvedValue([]);
  prismaMock.budgetAssumption.findMany.mockReset().mockResolvedValue([]);
  prismaMock.salesForecast.findMany.mockReset().mockResolvedValue([]);
  prismaMock.expenseForecast.findMany.mockReset().mockResolvedValue([]);
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: 'audit_1' });
  costModelMock.loadAndCompute.mockReset().mockResolvedValue(null);
});

describe('GET /api/budgeting/plans — handler', () => {
  it('returns 401 when unauthenticated', async () => {
    await mockSession(null);
    const res = await GET(makeRequest('/api/budgeting/plans'));
    expect(res.status).toBe(401);
    expect(prismaMock.budgetPlan.findMany).not.toHaveBeenCalled();
  });

  it('lists plans tenant-scoped on happy path', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'editor' });
    prismaMock.budgetPlan.findMany.mockResolvedValue([
      { id: 'p1', name: 'AZMADE 2026', year: 2026 },
    ]);
    const res = await GET(makeRequest('/api/budgeting/plans'));
    expect(res.status).toBe(200);
    const call = prismaMock.budgetPlan.findMany.mock.calls[0][0];
    expect(call.where.organizationId).toBe(ORG_ID);
    expect(call.where.deletedAt).toBeNull();
  });
});

describe('POST /api/budgeting/plans — handler', () => {
  it('returns 401 when unauthenticated', async () => {
    await mockSession(null);
    const res = await POST(
      makeRequest('/api/budgeting/plans', {
        method: 'POST',
        json: { name: 'X', periodType: 'annual', year: 2026 },
      }),
    );
    expect(res.status).toBe(401);
    expect(prismaMock.budgetPlan.create).not.toHaveBeenCalled();
  });

  it('returns 403 when caller is below manager', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'editor' });
    const res = await POST(
      makeRequest('/api/budgeting/plans', {
        method: 'POST',
        json: { name: 'X', periodType: 'annual', year: 2026 },
      }),
    );
    expect(res.status).toBe(403);
    expect(prismaMock.budgetPlan.create).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid body (zod failure)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    const res = await POST(
      makeRequest('/api/budgeting/plans', {
        method: 'POST',
        json: { name: '', periodType: 'invalid', year: 1900 },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(prismaMock.budgetPlan.create).not.toHaveBeenCalled();
  });

  it('returns 409 when duplicate plan exists for same period', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    prismaMock.budgetPlan.findFirst.mockResolvedValueOnce({
      id: 'existing',
      name: 'AZMADE 2026',
    });
    const res = await POST(
      makeRequest('/api/budgeting/plans', {
        method: 'POST',
        json: { name: 'AZMADE 2026 v2', periodType: 'annual', year: 2026 },
      }),
    );
    expect(res.status).toBe(409);
    expect(prismaMock.budgetPlan.create).not.toHaveBeenCalled();
  });

  it('emits budget_plan_create audit on 201 happy path with full metadata', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    prismaMock.budgetPlan.create.mockResolvedValue({
      id: PLAN_ID,
      name: 'AZMADE 2026 Q1',
      year: 2026,
      periodType: 'quarterly',
      organizationId: ORG_ID,
      month: null,
      quarter: 1,
      notes: null,
    });
    // Auto-populate skip: source plan = null → no findMany on lines
    prismaMock.budgetPlan.findFirst
      .mockResolvedValueOnce(null) // duplicate check passes
      .mockResolvedValueOnce(null); // source plan check (none)

    const res = await POST(
      makeRequest('/api/budgeting/plans', {
        method: 'POST',
        json: {
          name: 'AZMADE 2026 Q1',
          periodType: 'quarterly',
          year: 2026,
          quarter: 1,
        },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(PLAN_ID);
    expect(body.auditStale).toBe(false);

    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(1);
    const auditCall = prismaMock.auditEvent.create.mock.calls[0][0];
    expect(auditCall.data.action).toBe('budget_plan_create');
    expect(auditCall.data.entityType).toBe('BudgetPlan');
    expect(auditCall.data.entityId).toBe(PLAN_ID);
    expect(auditCall.data.actorUserId).toBe('u_mgr');
    expect(auditCall.data.metadata).toEqual({
      planName: 'AZMADE 2026 Q1',
      year: 2026,
      scope: 'quarterly',
    });
  });

  it('surfaces auditStale: true when audit emission fails (never-throws)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    prismaMock.budgetPlan.create.mockResolvedValue({
      id: PLAN_ID,
      name: 'AZMADE 2026',
      year: 2026,
      periodType: 'annual',
      organizationId: ORG_ID,
      month: null,
      quarter: null,
      notes: null,
    });
    prismaMock.auditEvent.create.mockRejectedValue(new Error('audit DB down'));
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(
      makeRequest('/api/budgeting/plans', {
        method: 'POST',
        json: { name: 'AZMADE 2026', periodType: 'annual', year: 2026 },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    // Mutation still applied; flag surfaces the soft failure.
    expect(body.auditStale).toBe(true);
    expect(prismaMock.budgetPlan.create).toHaveBeenCalledTimes(1);
    consoleErr.mockRestore();
  });

  // Phase 8 fix (2026-05-29) — quarterly auto-populate. Regression lock for
  // the bug found by live test: the clone (a) read source lines WITHOUT a
  // `deletedAt` filter (resurrecting archived rows) and (b) derived the month
  // from `sortOrder % 100` (always 0 for live lines) instead of `monthIndex`,
  // so a Q2 plan cloned deleted rows and dropped `monthIndex`. This locks all
  // three: deletedAt:null on the read, monthIndex-based filtering, monthIndex
  // preserved on the clone.
  it('quarterly clone takes only in-quarter LIVE lines by monthIndex + preserves monthIndex', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    prismaMock.budgetPlan.create.mockResolvedValue({
      id: PLAN_ID, name: 'Q2', year: 2026, periodType: 'quarterly',
      organizationId: ORG_ID, month: null, quarter: 2, notes: null,
    });
    // 1st findFirst = duplicate check (none); 2nd = source plan (annual).
    prismaMock.budgetPlan.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'src', periodType: 'annual', isRolling: false });
    // Source: an April line (monthIndex 3 ∈ Q2 {3,4,5}) and an August line
    // (monthIndex 7, outside Q2). Only April should clone.
    const baseLine = {
      sortOrder: 0, plannedAmount: 100, lineType: 'expense', department: null,
      costModelKey: null, notes: null, lineSubtype: null, parentId: null,
    };
    prismaMock.budgetLine.findMany.mockResolvedValue([
      { ...baseLine, id: 'l_apr', monthIndex: 3, accountId: 'acc_apr', account: { code: 'A', name: 'A' } },
      { ...baseLine, id: 'l_aug', monthIndex: 7, accountId: 'acc_aug', account: { code: 'B', name: 'B' } },
    ]);
    prismaMock.budgetLine.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new', ...data }),
    );

    const res = await POST(
      makeRequest('/api/budgeting/plans', {
        method: 'POST',
        json: { name: 'Q2', periodType: 'quarterly', year: 2026, quarter: 2 },
      }),
    );
    expect(res.status).toBe(201);

    // (a) Source lines read with deletedAt: null — no resurrecting archived rows.
    const sourceRead = prismaMock.budgetLine.findMany.mock.calls[0][0];
    expect(sourceRead.where.deletedAt).toBeNull();

    // (b) Only the April line (monthIndex 3) cloned; August (7) excluded.
    expect(prismaMock.budgetLine.create).toHaveBeenCalledTimes(1);
    const created = prismaMock.budgetLine.create.mock.calls[0][0].data;
    expect(created.accountId).toBe('acc_apr');
    // (c) monthIndex preserved on the cloned line (was dropped before the fix).
    expect(created.monthIndex).toBe(3);
  });
});
