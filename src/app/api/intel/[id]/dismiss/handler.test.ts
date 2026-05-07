// @vitest-environment node
/**
 * Phase 7.G Turn XLIV (Phase D.3) — handler test for `DELETE /api/intel/[id]/dismiss`.
 *
 * Locks: 401 unauth, 200 viewer can dismiss (any auth), 404
 * cross-tenant, idempotent on already-dismissed (returns unchanged
 * DTO, no DB write), happy-path appends userId without duplicating
 * existing dismissedBy entries.
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
import { DELETE } from './route';

const ORG_ID = 'org_demo';
const USER_ID = 'u_viewer';
const OTHER_USER_ID = 'u_other';
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

describe('DELETE /api/intel/[id]/dismiss', () => {
  it('returns 401 when unauthenticated', async () => {
    await mockSession(null);
    const req = makeRequest(`/api/intel/${ITEM_ID}/dismiss`, { method: 'DELETE' });
    const res = await DELETE(req, paramsFor(ITEM_ID));
    expect(res.status).toBe(401);
    expect(prismaMock.intelItem.findFirst).not.toHaveBeenCalled();
  });

  it('returns 404 when item belongs to a different org', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'viewer' });
    prismaMock.intelItem.findFirst.mockResolvedValue(null);
    const req = makeRequest(`/api/intel/${ITEM_ID}/dismiss`, { method: 'DELETE' });
    const res = await DELETE(req, paramsFor(ITEM_ID));
    expect(res.status).toBe(404);
    expect(prismaMock.intelItem.update).not.toHaveBeenCalled();
    const findCall = prismaMock.intelItem.findFirst.mock.calls[0][0];
    expect(findCall.where.organizationId).toBe(ORG_ID);
  });

  it('200 happy path: viewer dismisses an item, userId appended', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'viewer' });
    prismaMock.intelItem.findFirst.mockResolvedValue(baseRow);
    prismaMock.intelItem.update.mockResolvedValue({
      ...baseRow,
      dismissedBy: [USER_ID],
    });

    const req = makeRequest(`/api/intel/${ITEM_ID}/dismiss`, { method: 'DELETE' });
    const res = await DELETE(req, paramsFor(ITEM_ID));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');

    const body = await res.json();
    expect(body.item.id).toBe(ITEM_ID);
    expect(body.item.isDismissed).toBe(true);

    // The set-deduped array should contain just the new userId.
    expect(prismaMock.intelItem.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: { dismissedBy: { set: [USER_ID] } },
    });
  });

  it('preserves existing entries from other users when dismissing', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'viewer' });
    prismaMock.intelItem.findFirst.mockResolvedValue({
      ...baseRow,
      dismissedBy: [OTHER_USER_ID],
    });
    prismaMock.intelItem.update.mockResolvedValue({
      ...baseRow,
      dismissedBy: [OTHER_USER_ID, USER_ID],
    });

    const req = makeRequest(`/api/intel/${ITEM_ID}/dismiss`, { method: 'DELETE' });
    const res = await DELETE(req, paramsFor(ITEM_ID));
    expect(res.status).toBe(200);

    expect(prismaMock.intelItem.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: { dismissedBy: { set: [OTHER_USER_ID, USER_ID] } },
    });
  });

  it('idempotent: re-dismiss is a no-op (no DB write)', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'viewer' });
    prismaMock.intelItem.findFirst.mockResolvedValue({
      ...baseRow,
      dismissedBy: [USER_ID],
    });

    const req = makeRequest(`/api/intel/${ITEM_ID}/dismiss`, { method: 'DELETE' });
    const res = await DELETE(req, paramsFor(ITEM_ID));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.item.isDismissed).toBe(true);
    expect(prismaMock.intelItem.update).not.toHaveBeenCalled();
  });

  it('manager + admin can also dismiss (no role gate)', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'admin' });
    prismaMock.intelItem.findFirst.mockResolvedValue(baseRow);
    prismaMock.intelItem.update.mockResolvedValue({
      ...baseRow,
      dismissedBy: [USER_ID],
    });
    const req = makeRequest(`/api/intel/${ITEM_ID}/dismiss`, { method: 'DELETE' });
    const res = await DELETE(req, paramsFor(ITEM_ID));
    expect(res.status).toBe(200);
  });

  it('returns 400 when id is empty string in URL', async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: 'viewer' });
    const req = makeRequest('/api/intel//dismiss', { method: 'DELETE' });
    const res = await DELETE(req, paramsFor(''));
    expect(res.status).toBe(400);
    expect(prismaMock.intelItem.findFirst).not.toHaveBeenCalled();
  });
});
