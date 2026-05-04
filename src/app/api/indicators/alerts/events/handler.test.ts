// @vitest-environment node
/**
 * Phase 7.E C6 v3.2 (Turn IV) — handler test for `GET /api/indicators/alerts/events`.
 *
 * Locks: 401 unauth, 400 missing/invalid period, 400 invalid cursor, 400
 * limit out of range, 200 happy-path with composite (emittedAt, id)
 * keyset cursor + ISO-8601 emittedAt + Cache-Control header. ruleId
 * filter passes through to where clause.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    alertEvent: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { mockSession, makeRequest } from '@/test/api-harness';
import { GET } from './route';

const ORG_ID = 'org_demo';

beforeEach(() => {
  prismaMock.alertEvent.findMany.mockReset().mockResolvedValue([]);
});

describe('GET /api/indicators/alerts/events', () => {
  it('401 when unauthenticated', async () => {
    await mockSession(null);
    const res = await GET(
      makeRequest('/api/indicators/alerts/events?period=2025'),
    );
    expect(res.status).toBe(401);
    expect(prismaMock.alertEvent.findMany).not.toHaveBeenCalled();
  });

  it('400 when period is missing', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'viewer' });
    const res = await GET(makeRequest('/api/indicators/alerts/events'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/period/i);
    expect(prismaMock.alertEvent.findMany).not.toHaveBeenCalled();
  });

  it('400 when period is malformed', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'viewer' });
    const res = await GET(
      makeRequest('/api/indicators/alerts/events?period=garbage'),
    );
    expect(res.status).toBe(400);
    expect(prismaMock.alertEvent.findMany).not.toHaveBeenCalled();
  });

  it('400 when cursor is malformed', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'viewer' });
    const res = await GET(
      makeRequest(
        '/api/indicators/alerts/events?period=2025&cursor=not-a-cursor',
      ),
    );
    expect(res.status).toBe(400);
    expect(prismaMock.alertEvent.findMany).not.toHaveBeenCalled();
  });

  it('400 when limit > 200', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'viewer' });
    const res = await GET(
      makeRequest('/api/indicators/alerts/events?period=2025&limit=500'),
    );
    expect(res.status).toBe(400);
  });

  it('200 happy path: returns events array, hasMore=false when rows ≤ limit', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'viewer' });
    const now = new Date('2026-05-05T10:00:00.000Z');
    prismaMock.alertEvent.findMany.mockResolvedValue([
      {
        id: 'ae1',
        period: '2025',
        ruleId: 'RULE_CRITICAL_INDICATOR',
        ruleName: 'Critical indicator org-wide',
        severity: 'critical',
        message: 'IND_NET_MARGIN red across 4 companies',
        messageKey: 'alerts.messages.RULE_CRITICAL_INDICATOR',
        messageParams: { code: 'IND_NET_MARGIN', count: 4 },
        affectedCompanyIds: ['co_a', 'co_b', 'co_c', 'co_d'],
        affectedIndicatorCodes: ['IND_NET_MARGIN'],
        emittedAt: now,
      },
    ]);

    const res = await GET(
      makeRequest('/api/indicators/alerts/events?period=2025'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].emittedAt).toBe(now.toISOString());
    expect(body.events[0].messageParams).toEqual({
      code: 'IND_NET_MARGIN',
      count: 4,
    });
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();

    // Where clause scopes to the org + period.
    const whereArg = prismaMock.alertEvent.findMany.mock.calls[0]?.[0];
    expect(whereArg.where.organizationId).toBe(ORG_ID);
    expect(whereArg.where.period).toBe('2025');
    // No ruleId filter → not in where.
    expect(whereArg.where.ruleId).toBeUndefined();
    // Take = limit + 1 (hasMore detection).
    expect(whereArg.take).toBe(51);
    // Order by composite (emittedAt, id) DESC for the keyset.
    expect(whereArg.orderBy).toEqual([
      { emittedAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('hasMore=true + nextCursor when rows > limit; cursor format is `<iso>|<id>`', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'viewer' });
    const t1 = new Date('2026-05-05T10:00:00.000Z');
    const t2 = new Date('2026-05-05T09:59:00.000Z');
    // Stub limit + 1 = 3 rows so hasMore fires.
    prismaMock.alertEvent.findMany.mockResolvedValue([
      mkRow('ae1', t1, 'RULE_X'),
      mkRow('ae2', t2, 'RULE_X'),
      mkRow('ae3', t2, 'RULE_X'),
    ]);

    const res = await GET(
      makeRequest('/api/indicators/alerts/events?period=2025&limit=2'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(2);
    expect(body.hasMore).toBe(true);
    // nextCursor = `<iso>|<id>` of the 2nd row (last in returned page).
    expect(body.nextCursor).toBe(`${t2.toISOString()}|ae2`);
  });

  it('ruleId filter flows into where clause when supplied', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'viewer' });
    await GET(
      makeRequest(
        '/api/indicators/alerts/events?period=2025&ruleId=RULE_MOSTLY_RED',
      ),
    );
    const whereArg = prismaMock.alertEvent.findMany.mock.calls[0]?.[0];
    expect(whereArg.where.ruleId).toBe('RULE_MOSTLY_RED');
  });

  it('cursor parsed → composite OR clause in where', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'viewer' });
    const cursorIso = '2026-05-05T10:00:00.000Z';
    const cursorId = 'ae_prev';
    await GET(
      makeRequest(
        `/api/indicators/alerts/events?period=2025&cursor=${cursorIso}|${cursorId}`,
      ),
    );
    const whereArg = prismaMock.alertEvent.findMany.mock.calls[0]?.[0];
    expect(whereArg.where.OR).toEqual([
      { emittedAt: { lt: new Date(cursorIso) } },
      {
        emittedAt: { equals: new Date(cursorIso) },
        id: { lt: cursorId },
      },
    ]);
  });
});

function mkRow(id: string, emittedAt: Date, ruleId: string) {
  return {
    id,
    period: '2025',
    ruleId,
    ruleName: 'X',
    severity: 'warning',
    message: 'msg',
    messageKey: `alerts.messages.${ruleId}`,
    messageParams: {},
    affectedCompanyIds: [],
    affectedIndicatorCodes: [],
    emittedAt,
  };
}
