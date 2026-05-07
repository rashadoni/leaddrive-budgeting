// @vitest-environment node
/**
 * Phase 7.G Turn XLIV (Phase D.3) — handler test for `POST /api/intel/[id]/pin`.
 *
 * Locks: 401 unauth, 403 non-manager (viewer / editor rejected),
 * 400 missing/invalid body, 404 cross-tenant, 200 happy-path with
 * updated DTO + Cache-Control header.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    intelItem: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { mockSession, makeRequest } from '@/test/api-harness';
import { POST } from './route';

const ORG_ID = 'org_demo';
const USER_ID = 'u_manager';
const ITEM_ID = 'intel_1';

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

const baseRow = {
  id: ITEM_ID,
  organizationId: ORG_ID,
  title: 'Cocoa squeeze',
  summary: 'Ghana export cuts.',
  url: 'https://reuters.com/cocoa',
  urlHash: 'abc123',
  sourceLabel: 'Reuters',
  relevanceScore: 0.85,
  industryTags: ['agro'],
  companyTags: [],
  publishedAt: new Date('2026-05-04T00:00:00Z'),
  fetchedAt: new Date('2026-05-07T10:00:00Z'),
  isPinned: false,
  dismissedBy: [],
};

beforeEach(() => {
  prismaMock.intelItem.findFirst.mockReset();
  prismaMock.intelItem.update.mockReset();
});

describe('POST /api/intel/[id]/pin', () => {
  it('returns 401 when unauthenticated', async () => {
    await mockSession(null);
    const req = makeRequest(`/api/intel/${ITEM_ID}/pin`, {
      method: 'POST',
      json: { pinned: true },
    });
    const res = await POST(req, paramsFor(ITEM_ID));
    expect(res.status).toBe(401);
    expect(prismaMock.intelItem.findFirst).not.toHaveBeenCalled();
  });

  it('returns 403 when caller is editor (manager+ required)', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'editor' });
    const req = makeRequest(`/api/intel/${ITEM_ID}/pin`, {
      method: 'POST',
      json: { pinned: true },
    });
    const res = await POST(req, paramsFor(ITEM_ID));
    expect(res.status).toBe(403);
    expect(prismaMock.intelItem.findFirst).not.toHaveBeenCalled();
  });

  it('returns 403 when caller is viewer', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'viewer' });
    const req = makeRequest(`/api/intel/${ITEM_ID}/pin`, {
      method: 'POST',
      json: { pinned: true },
    });
    const res = await POST(req, paramsFor(ITEM_ID));
    expect(res.status).toBe(403);
  });

  it('returns 400 when body is missing pinned field', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'manager' });
    const req = makeRequest(`/api/intel/${ITEM_ID}/pin`, {
      method: 'POST',
      json: {},
    });
    const res = await POST(req, paramsFor(ITEM_ID));
    expect(res.status).toBe(400);
    expect(prismaMock.intelItem.findFirst).not.toHaveBeenCalled();
  });

  it('returns 400 when pinned is not a boolean', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'manager' });
    const req = makeRequest(`/api/intel/${ITEM_ID}/pin`, {
      method: 'POST',
      json: { pinned: 'yes' },
    });
    const res = await POST(req, paramsFor(ITEM_ID));
    expect(res.status).toBe(400);
  });

  it('returns 400 when JSON body is malformed', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'manager' });
    // makeRequest with raw string body to trigger JSON parse error
    const req = new Request(`http://localhost/api/intel/${ITEM_ID}/pin`, {
      method: 'POST',
      body: '{not json',
      headers: { 'content-type': 'application/json' },
    }) as unknown as import('next/server').NextRequest;
    const res = await POST(req, paramsFor(ITEM_ID));
    expect(res.status).toBe(400);
  });

  it('returns 404 when item belongs to a different org', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'manager' });
    // findFirst with org-scope returns null (item belongs to OTHER_ORG_ID).
    prismaMock.intelItem.findFirst.mockResolvedValue(null);
    const req = makeRequest(`/api/intel/${ITEM_ID}/pin`, {
      method: 'POST',
      json: { pinned: true },
    });
    const res = await POST(req, paramsFor(ITEM_ID));
    expect(res.status).toBe(404);
    expect(prismaMock.intelItem.update).not.toHaveBeenCalled();
    // Verify the org-scope was applied at fetch time.
    const findCall = prismaMock.intelItem.findFirst.mock.calls[0][0];
    expect(findCall.where.organizationId).toBe(ORG_ID);
  });

  it('200 happy path: flips isPinned true, returns updated DTO', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'manager' });
    prismaMock.intelItem.findFirst.mockResolvedValue(baseRow);
    prismaMock.intelItem.update.mockResolvedValue({ ...baseRow, isPinned: true });

    const req = makeRequest(`/api/intel/${ITEM_ID}/pin`, {
      method: 'POST',
      json: { pinned: true },
    });
    const res = await POST(req, paramsFor(ITEM_ID));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');

    const body = await res.json();
    expect(body.item.id).toBe(ITEM_ID);
    expect(body.item.isPinned).toBe(true);
    expect(body.item.isDismissed).toBe(false);

    expect(prismaMock.intelItem.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: { isPinned: true },
    });
  });

  it('200 happy path: flips isPinned false (unpin)', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'manager' });
    prismaMock.intelItem.findFirst.mockResolvedValue({ ...baseRow, isPinned: true });
    prismaMock.intelItem.update.mockResolvedValue({ ...baseRow, isPinned: false });

    const req = makeRequest(`/api/intel/${ITEM_ID}/pin`, {
      method: 'POST',
      json: { pinned: false },
    });
    const res = await POST(req, paramsFor(ITEM_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item.isPinned).toBe(false);
  });

  it('admin role is also accepted (manager-or-higher gate)', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'admin' });
    prismaMock.intelItem.findFirst.mockResolvedValue(baseRow);
    prismaMock.intelItem.update.mockResolvedValue({ ...baseRow, isPinned: true });
    const req = makeRequest(`/api/intel/${ITEM_ID}/pin`, {
      method: 'POST',
      json: { pinned: true },
    });
    const res = await POST(req, paramsFor(ITEM_ID));
    expect(res.status).toBe(200);
  });

  it('reflects caller-specific isDismissed in the returned DTO', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'manager' });
    const dismissedRow = { ...baseRow, dismissedBy: [USER_ID] };
    prismaMock.intelItem.findFirst.mockResolvedValue(dismissedRow);
    prismaMock.intelItem.update.mockResolvedValue({ ...dismissedRow, isPinned: true });

    const req = makeRequest(`/api/intel/${ITEM_ID}/pin`, {
      method: 'POST',
      json: { pinned: true },
    });
    const res = await POST(req, paramsFor(ITEM_ID));
    const body = await res.json();
    expect(body.item.isPinned).toBe(true);
    expect(body.item.isDismissed).toBe(true);
  });
});
