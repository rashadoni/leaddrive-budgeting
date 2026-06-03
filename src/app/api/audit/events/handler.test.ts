// @vitest-environment node
/**
 * Phase 7.G Turn XV — handler shape-lock for `GET /api/audit/events`.
 *
 * Closes Turn-U architect Round-1 💡 #1 (deferred-per-no-regression-risk):
 * lock the load-bearing internals that pure parser/where-builder tests
 * (`src/lib/audit/list.test.ts`) cannot reach:
 *   - Prisma `findMany` orderBy shape: `[{createdAt:'desc'},{id:'desc'}]`
 *     (composite keyset secondary key).
 *   - `nextCursor` template literal `<iso>|<id>` when hasMore=true.
 *   - Round-trip: page1.nextCursor → page2.where.OR composite emits
 *     deterministic gap-free pagination over same-ms ties.
 *
 * Keeps consumer-level `AuditFeed.test.tsx` round-trip tests in place —
 * those exercise the cursor as opaque pass-through; this file proves
 * the cursor's internal shape so a future refactor that breaks the
 * format gets caught at this layer, not by a downstream UI flake.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    auditEvent: { findMany: vi.fn() },
    // Phase 7.F sub-group RBAC — getCompanyScope reads user row.
    user: { findFirst: vi.fn().mockResolvedValue({ allowedSubGroupIds: [] }) },
    // getCompanyScope resolves allowedSubGroupIds → company id set.
    company: { findMany: vi.fn().mockResolvedValue([]) },
    // Audit-log RBAC bulk-fetches IV → companyId for IndicatorValue events.
    indicatorValue: { findMany: vi.fn().mockResolvedValue([]) },
    // Phase 5.2 Stage 2 — withOrgScope wraps auditEvent + indicatorValue reads.
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

// Phase 5.2 — withOrgScope validates 20-32 char cuid-shaped orgId.
const ORG_ID = 'cm3rlsauditevt00000001a';

beforeEach(() => {
  prismaMock.auditEvent.findMany.mockReset().mockResolvedValue([]);
  prismaMock.user.findFirst.mockReset().mockResolvedValue({ allowedSubGroupIds: [] });
  prismaMock.company.findMany.mockReset().mockResolvedValue([]);
  prismaMock.indicatorValue.findMany.mockReset().mockResolvedValue([]);
});

function mkRow(id: string, createdAt: Date, entityId = 'co_a') {
  return {
    id,
    action: 'company_create',
    entityType: 'Company',
    entityId,
    metadata: {},
    context: {},
    createdAt,
    actor: { id: 'u_actor', name: 'A', email: 'a@test' },
  };
}

describe('GET /api/audit/events — handler shape-lock', () => {
  it('orderBy is composite [{createdAt:desc},{id:desc}] for same-ms tie-break', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    await GET(makeRequest('/api/audit/events'));

    const arg = prismaMock.auditEvent.findMany.mock.calls[0]?.[0];
    expect(arg.orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('nextCursor is `<iso>|<id>` of last returned row when hasMore=true', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    const t1 = new Date('2026-05-05T10:00:00.000Z');
    const t2 = new Date('2026-05-05T09:59:00.000Z');
    // Stub limit + 1 = 3 rows so hasMore detection fires.
    prismaMock.auditEvent.findMany.mockResolvedValue([
      mkRow('ev1', t1),
      mkRow('ev2', t2),
      mkRow('ev3', t2),
    ]);

    const res = await GET(makeRequest('/api/audit/events?limit=2'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.events).toHaveLength(2);
    expect(body.hasMore).toBe(true);
    // Last row of returned page = ev2 @ t2.
    expect(body.nextCursor).toBe(`${t2.toISOString()}|ev2`);

    // take = limit + 1 (hasMore detection)
    const arg = prismaMock.auditEvent.findMany.mock.calls[0]?.[0];
    expect(arg.take).toBe(3);
  });

  it('round-trip: passing nextCursor → page2 where.OR composite excludes prior tail row, allows other same-ms rows', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    const cursorIso = '2026-05-05T09:59:00.000Z';
    const cursorId = 'ev2';

    await GET(
      makeRequest(
        `/api/audit/events?cursor=${encodeURIComponent(`${cursorIso}|${cursorId}`)}`,
      ),
    );

    const arg = prismaMock.auditEvent.findMany.mock.calls[0]?.[0];
    expect(arg.where.OR).toEqual([
      { createdAt: { lt: new Date(cursorIso) } },
      {
        createdAt: new Date(cursorIso),
        id: { lt: cursorId },
      },
    ]);
    // The composite OR is AND-ed with the org scope — sibling fields
    // remain on `where` root.
    expect(arg.where.organizationId).toBe(ORG_ID);
  });

  it('REGRESSION (terminal-audit P1): scoped manager is NOT truncated when the limit+1 window contains out-of-scope rows', async () => {
    // A scoped (non-admin) manager who can see only company `co_a`.
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    prismaMock.user.findFirst.mockResolvedValue({ allowedSubGroupIds: ['co_a'] });
    prismaMock.company.findMany.mockResolvedValue([{ id: 'co_a' }]); // scope.ids = {co_a}

    const t = new Date('2026-05-05T10:00:00.000Z');
    const older = (n: number) => new Date(t.getTime() - n * 60_000);

    // limit=2 → BATCH=3. Round 1's limit+1 window has an out-of-scope co_b row,
    // so only 2 in-scope survive. PRE-FIX: hasMore = 2 > 2 = false → the trail
    // is silently truncated even though more in-scope rows exist deeper.
    prismaMock.auditEvent.findMany
      .mockResolvedValueOnce([
        mkRow('ev1', older(1), 'co_a'),
        mkRow('ev2', older(2), 'co_b'), // out of scope — dropped by RBAC
        mkRow('ev3', older(3), 'co_a'),
      ])
      // Round 2 (loop continues post-fix): one more in-scope row, then exhausted.
      .mockResolvedValueOnce([mkRow('ev4', older(4), 'co_a')]);

    const res = await GET(makeRequest('/api/audit/events?limit=2'));
    expect(res.status).toBe(200);
    const body = await res.json();

    // Only in-scope rows are returned…
    expect(body.events.map((e: { id: string }) => e.id)).toEqual(['ev1', 'ev3']);
    // …and the trail is NOT truncated: a deeper in-scope row (ev4) exists.
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe(`${older(3).toISOString()}|ev3`);
    // It actually looped a second batch rather than stopping at the first.
    expect(prismaMock.auditEvent.findMany.mock.calls.length).toBe(2);
    // The 2nd batch advanced the keyset cursor past the last RAW row of batch 1.
    const batch2Where = prismaMock.auditEvent.findMany.mock.calls[1]?.[0].where;
    expect(batch2Where.OR).toEqual([
      { createdAt: { lt: older(3) } },
      { createdAt: older(3), id: { lt: 'ev3' } },
    ]);
  });

  it('scoped manager: source exhausted before a full page → hasMore=false, nextCursor=null', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    prismaMock.user.findFirst.mockResolvedValue({ allowedSubGroupIds: ['co_a'] });
    prismaMock.company.findMany.mockResolvedValue([{ id: 'co_a' }]);

    const t = new Date('2026-05-05T10:00:00.000Z');
    // limit=2, BATCH=3 → a single short batch (2 rows < 3) ends the scan.
    prismaMock.auditEvent.findMany.mockResolvedValueOnce([
      mkRow('ev1', t, 'co_a'),
      mkRow('ev2', new Date(t.getTime() - 60_000), 'co_b'), // out of scope
    ]);

    const res = await GET(makeRequest('/api/audit/events?limit=2'));
    const body = await res.json();
    expect(body.events.map((e: { id: string }) => e.id)).toEqual(['ev1']);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
    expect(prismaMock.auditEvent.findMany.mock.calls.length).toBe(1); // short batch → no 2nd round
  });
});
