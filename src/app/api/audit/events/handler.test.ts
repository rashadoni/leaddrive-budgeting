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
    // Audit-log RBAC bulk-fetches IV → companyId for IndicatorValue events.
    indicatorValue: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { mockSession, makeRequest } from '@/test/api-harness';
import { GET } from './route';

const ORG_ID = 'org_demo';

beforeEach(() => {
  prismaMock.auditEvent.findMany.mockReset().mockResolvedValue([]);
});

function mkRow(id: string, createdAt: Date) {
  return {
    id,
    action: 'company_create',
    entityType: 'Company',
    entityId: 'co_a',
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
});
