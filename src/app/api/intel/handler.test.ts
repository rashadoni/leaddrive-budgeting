// @vitest-environment node
/**
 * Phase 7.G Turn XLII (Phase D.1) — handler test for `GET /api/intel`.
 *
 * Locks: 401 unauth, 400 invalid query params, 200 happy-path with
 * composite `(fetchedAt, id)` keyset cursor + ISO-8601 fetchedAt +
 * Cache-Control header. industry/company filter pass through to where
 * clause; isDismissed computed per-caller.
 *
 * Phase D.2 will add tests for `POST /api/intel/refresh` (LLM-driven
 * crawl trigger). Phase D.4 will add e2e tests against the running
 * dev server (panel rendering + filter UI).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    intelItem: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
// Stage 3 RLS — hand the mock straight to the scope callback.
vi.mock('@/lib/db/with-org-scope', () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
}));

import { mockSession, makeRequest } from '@/test/api-harness';
import { GET } from './route';

const ORG_ID = 'org_demo';
const USER_ID = 'u_admin';

beforeEach(() => {
  prismaMock.intelItem.findMany.mockReset().mockResolvedValue([]);
});

describe('GET /api/intel', () => {
  it('401 when unauthenticated', async () => {
    await mockSession(null);
    const res = await GET(makeRequest('/api/intel'));
    expect(res.status).toBe(401);
    expect(prismaMock.intelItem.findMany).not.toHaveBeenCalled();
  });

  it('400 when industry filter is empty string', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'viewer' });
    const res = await GET(makeRequest('/api/intel?industry='));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/industry/i);
    expect(prismaMock.intelItem.findMany).not.toHaveBeenCalled();
  });

  it('400 when minRelevance is out of [0, 1]', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'viewer' });
    const res = await GET(makeRequest('/api/intel?minRelevance=1.5'));
    expect(res.status).toBe(400);
    expect(prismaMock.intelItem.findMany).not.toHaveBeenCalled();
  });

  it('400 when cursor is malformed', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'viewer' });
    const res = await GET(
      makeRequest('/api/intel?cursor=not-a-cursor'),
    );
    expect(res.status).toBe(400);
    expect(prismaMock.intelItem.findMany).not.toHaveBeenCalled();
  });

  it('400 when limit > 200', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'viewer' });
    const res = await GET(makeRequest('/api/intel?limit=500'));
    expect(res.status).toBe(400);
  });

  it('200 happy path: returns items array + Cache-Control header', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'viewer' });
    const now = new Date('2026-05-06T10:00:00.000Z');
    prismaMock.intelItem.findMany.mockResolvedValue([
      {
        id: 'intel_1',
        organizationId: ORG_ID,
        title: 'Industrial slowdown signals',
        summary: 'Quarterly forecast cut by 3% on softening demand.',
        url: 'https://example.com/article-1',
        urlHash: 'a'.repeat(64),
        sourceLabel: 'Reuters',
        relevanceScore: 0.85,
        industryTags: ['industrial'],
        companyTags: ['AAC'],
        publishedAt: now,
        fetchedAt: now,
        isPinned: false,
        dismissedBy: [],
      },
    ]);

    const res = await GET(makeRequest('/api/intel'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');

    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toEqual({
      id: 'intel_1',
      title: 'Industrial slowdown signals',
      summary: 'Quarterly forecast cut by 3% on softening demand.',
      url: 'https://example.com/article-1',
      sourceLabel: 'Reuters',
      relevanceScore: 0.85,
      industryTags: ['industrial'],
      companyTags: ['AAC'],
      publishedAt: now.toISOString(),
      fetchedAt: now.toISOString(),
      isPinned: false,
      isDismissed: false,
    });
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it('hasMore=true + nextCursor when rows count exceeds limit', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'viewer' });
    const now = new Date('2026-05-06T10:00:00.000Z');
    // 3 rows returned for limit=2 (route fetches limit+1 to detect hasMore)
    prismaMock.intelItem.findMany.mockResolvedValue([
      {
        id: 'intel_1',
        organizationId: ORG_ID,
        title: 't1',
        summary: 's1',
        url: 'u1',
        urlHash: 'h1',
        sourceLabel: 'src',
        relevanceScore: 0.9,
        industryTags: [],
        companyTags: [],
        publishedAt: null,
        fetchedAt: now,
        isPinned: false,
        dismissedBy: [],
      },
      {
        id: 'intel_2',
        organizationId: ORG_ID,
        title: 't2',
        summary: 's2',
        url: 'u2',
        urlHash: 'h2',
        sourceLabel: 'src',
        relevanceScore: 0.8,
        industryTags: [],
        companyTags: [],
        publishedAt: null,
        fetchedAt: now,
        isPinned: false,
        dismissedBy: [],
      },
      {
        id: 'intel_3',
        organizationId: ORG_ID,
        title: 't3',
        summary: 's3',
        url: 'u3',
        urlHash: 'h3',
        sourceLabel: 'src',
        relevanceScore: 0.7,
        industryTags: [],
        companyTags: [],
        publishedAt: null,
        fetchedAt: now,
        isPinned: false,
        dismissedBy: [],
      },
    ]);

    const res = await GET(makeRequest('/api/intel?limit=2'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2); // sliced from 3 → 2
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe(`${now.toISOString()}|intel_2`);

    // Verify findMany was called with take=limit+1 (3 not 2)
    expect(prismaMock.intelItem.findMany).toHaveBeenCalledTimes(1);
    const call = prismaMock.intelItem.findMany.mock.calls[0][0];
    expect(call.take).toBe(3);
    expect(call.where.organizationId).toBe(ORG_ID);
  });

  it('isDismissed computed per-caller from dismissedBy array', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'viewer' });
    prismaMock.intelItem.findMany.mockResolvedValue([
      {
        id: 'intel_1',
        organizationId: ORG_ID,
        title: 't',
        summary: 's',
        url: 'u',
        urlHash: 'h',
        sourceLabel: 'src',
        relevanceScore: 0.5,
        industryTags: [],
        companyTags: [],
        publishedAt: null,
        fetchedAt: new Date(),
        isPinned: false,
        dismissedBy: [USER_ID, 'other_user'],
      },
    ]);

    const res = await GET(
      makeRequest('/api/intel?includeDismissed=true'),
    );
    const body = await res.json();
    expect(body.items[0].isDismissed).toBe(true);
  });

  it('industry filter passes through to where clause', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'viewer' });
    await GET(makeRequest('/api/intel?industry=hospitality'));
    expect(prismaMock.intelItem.findMany).toHaveBeenCalledTimes(1);
    const call = prismaMock.intelItem.findMany.mock.calls[0][0];
    expect(call.where.industryTags).toEqual({ has: 'hospitality' });
  });

  it('default excludes dismissed-by-caller items via NOT clause', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'viewer' });
    await GET(makeRequest('/api/intel'));
    expect(prismaMock.intelItem.findMany).toHaveBeenCalledTimes(1);
    const call = prismaMock.intelItem.findMany.mock.calls[0][0];
    expect(call.where.NOT).toEqual({
      dismissedBy: { has: USER_ID },
    });
  });

  it('cursor → composite OR clause (fetchedAt < OR fetchedAt = AND id <)', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'viewer' });
    const cursorDate = new Date('2026-05-05T10:00:00.000Z');
    const cursor = encodeURIComponent(
      `${cursorDate.toISOString()}|intel_99`,
    );
    await GET(makeRequest(`/api/intel?cursor=${cursor}`));
    expect(prismaMock.intelItem.findMany).toHaveBeenCalledTimes(1);
    const call = prismaMock.intelItem.findMany.mock.calls[0][0];
    expect(call.where.OR).toEqual([
      { fetchedAt: { lt: cursorDate } },
      {
        fetchedAt: { equals: cursorDate },
        id: { lt: 'intel_99' },
      },
    ]);
  });
});
