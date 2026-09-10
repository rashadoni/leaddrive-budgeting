// @vitest-environment node
/**
 * Phase 7.G Turn XLIII (Phase D.2) — handler test for `POST /api/intel/refresh`.
 *
 * What this proves:
 *   1. 401 unauth, 403 non-admin (manager fails), 503 no Anthropic key.
 *   2. 429 when org-wide rate limit kicks in.
 *   3. 200 happy path: derives industries[] + companyCodes[] from
 *      `prisma.company.findMany`, calls `runIntelCrawl`, writes
 *      `intel_crawl_run` audit_event with the expected metadata shape.
 *   4. Empty-org path: zero counters in audit metadata, no crash.
 *   5. Audit emission failure does NOT block the response.
 *
 * `runIntelCrawl` is mocked (treated as opaque) so this test stays
 * scoped to the handler's plumbing — the crawler's own behavior is
 * covered by `src/lib/intel/crawler.test.ts`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findMany: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
// Stage 3 RLS — hand the mock straight to the scope callback.
vi.mock('@/lib/db/with-org-scope', () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
}));

const { aiClientMock } = vi.hoisted(() => ({
  aiClientMock: { hasAnthropicKeyForOrg: async () => true },
}));
vi.mock('@/lib/ai/client', () => aiClientMock);

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

const { runIntelCrawlMock } = vi.hoisted(() => ({
  runIntelCrawlMock: vi.fn(),
}));
vi.mock('@/lib/intel/crawler', async () => {
  const actual = await vi.importActual<typeof import('@/lib/intel/crawler')>(
    '@/lib/intel/crawler',
  );
  return { ...actual, runIntelCrawl: runIntelCrawlMock };
});

import { mockSession, makeRequest } from '@/test/api-harness';
import { POST } from './route';

const ORG_ID = 'org_demo';
const USER_ID = 'u_admin';

const HAPPY_RESULT = {
  itemsFetched: 5,
  itemsCreated: 4,
  itemsSkipped: 1,
  errors: [],
  modelName: 'claude-sonnet-4-5-20250929',
  promptVersion: 'v1',
  usage: { inputTokens: 1100, outputTokens: 600 },
};

beforeEach(() => {
  prismaMock.company.findMany.mockReset().mockResolvedValue([
    { code: 'AAC', industry: 'industrial' },
    { code: 'HLTN', industry: 'hospitality' },
    { code: 'AAC2', industry: 'industrial' },
    { code: 'NULL_INDUSTRY', industry: null },
  ]);
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: 'audit_1' });
  runIntelCrawlMock.mockReset().mockResolvedValue(HAPPY_RESULT);
  aiClientMock.hasAnthropicKey.mockReturnValue(true);
  rateLimitMock.enforceRateLimit.mockReset().mockReturnValue(null);
});

describe('POST /api/intel/refresh — auth + gate', () => {
  it('returns 503 when ANTHROPIC_API_KEY is missing — short-circuits before auth', async () => {
    aiClientMock.hasAnthropicKey.mockReturnValue(false);
    const res = await POST(makeRequest('/api/intel/refresh', { method: 'POST' }));
    expect(res.status).toBe(503);
    expect(prismaMock.company.findMany).not.toHaveBeenCalled();
    expect(runIntelCrawlMock).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    await mockSession(null);
    const res = await POST(makeRequest('/api/intel/refresh', { method: 'POST' }));
    expect(res.status).toBe(401);
    expect(runIntelCrawlMock).not.toHaveBeenCalled();
  });

  it('returns 403 when caller is not admin (manager rejected)', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'manager' });
    const res = await POST(makeRequest('/api/intel/refresh', { method: 'POST' }));
    expect(res.status).toBe(403);
    expect(runIntelCrawlMock).not.toHaveBeenCalled();
  });

  it('returns 429 when rate-limited', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'admin' });
    rateLimitMock.enforceRateLimit.mockReturnValue(
      new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
      }),
    );
    const res = await POST(makeRequest('/api/intel/refresh', { method: 'POST' }));
    expect(res.status).toBe(429);
    expect(runIntelCrawlMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/intel/refresh — happy path', () => {
  it('returns 200 + counters + audit event on success', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'admin' });
    const res = await POST(makeRequest('/api/intel/refresh', { method: 'POST' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.itemsFetched).toBe(5);
    expect(body.itemsCreated).toBe(4);
    expect(body.itemsSkipped).toBe(1);
    expect(body.errors).toEqual([]);
    expect(typeof body.durationMs).toBe('number');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');

    // runIntelCrawl was called with the distinct industries +
    // companyCodes derived from the company list.
    expect(runIntelCrawlMock).toHaveBeenCalledTimes(1);
    const arg = runIntelCrawlMock.mock.calls[0][0];
    expect(arg.organizationId).toBe(ORG_ID);
    expect(arg.industries.sort()).toEqual(['hospitality', 'industrial']);
    expect(arg.companyCodes.sort()).toEqual([
      'AAC',
      'AAC2',
      'HLTN',
      'NULL_INDUSTRY',
    ]);
  });

  it('writes audit_event with the expected intel_crawl_run shape', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'admin' });
    await POST(makeRequest('/api/intel/refresh', { method: 'POST' }));
    // Audit emission is non-blocking; await a tick so the void-promise
    // resolves before we inspect.
    await new Promise((r) => setImmediate(r));

    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(1);
    const audit = prismaMock.auditEvent.create.mock.calls[0][0];
    expect(audit.data.action).toBe('intel_crawl_run');
    expect(audit.data.entityType).toBe('Organization');
    expect(audit.data.entityId).toBe(ORG_ID);
    expect(audit.data.actorUserId).toBe(USER_ID);
    expect(audit.data.organizationId).toBe(ORG_ID);
    expect(audit.data.metadata).toMatchObject({
      industriesCount: 2,
      companyCodesCount: 4,
      itemsFetched: 5,
      itemsCreated: 4,
      itemsSkipped: 1,
      tokensIn: 1100,
      tokensOut: 600,
      modelName: 'claude-sonnet-4-5-20250929',
      promptVersion: 'v1',
      errorsCount: 0,
    });
    expect(typeof audit.data.metadata.durationMs).toBe('number');
  });
});

describe('POST /api/intel/refresh — empty-org + audit-failure resilience', () => {
  it('handles org with zero companies — short-circuits, audit logs zero counts', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'admin' });
    prismaMock.company.findMany.mockResolvedValue([]);
    runIntelCrawlMock.mockResolvedValue({
      itemsFetched: 0,
      itemsCreated: 0,
      itemsSkipped: 0,
      errors: [],
      promptVersion: 'v1',
      // No usage / modelName because the crawler short-circuited.
    });
    const res = await POST(makeRequest('/api/intel/refresh', { method: 'POST' }));
    expect(res.status).toBe(200);

    await new Promise((r) => setImmediate(r));
    const audit = prismaMock.auditEvent.create.mock.calls[0][0];
    expect(audit.data.metadata.industriesCount).toBe(0);
    expect(audit.data.metadata.companyCodesCount).toBe(0);
    expect(audit.data.metadata.itemsFetched).toBe(0);
    expect(audit.data.metadata.tokensIn).toBe(0);
    expect(audit.data.metadata.modelName).toBe('unknown');
  });

  it('does not block response when audit emission fails', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'admin' });
    prismaMock.auditEvent.create.mockRejectedValue(new Error('audit DB down'));
    const res = await POST(makeRequest('/api/intel/refresh', { method: 'POST' }));
    expect(res.status).toBe(200);
    // Tick so the rejected promise's catch fires (silently — the audit
    // module's failure path now writes via `getLogger('lib:audit').error`
    // which is muted in test env per Phase 8 D4 logger contract). The
    // primary assertion above — response 200 even on audit failure —
    // is the public contract callers depend on.
    await new Promise((r) => setImmediate(r));
  });
});
