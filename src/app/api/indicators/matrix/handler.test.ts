/**
 * Handler test for `GET /api/indicators/matrix`.
 *
 * Locks in the Turn-16 default-period regression: the recompute pipeline
 * writes IndicatorValue rows under `period: String(year)` (annual). An
 * earlier `currentMonthString()` default returned `YYYY-MM` and silently
 * mismatched all pipeline-written rows, surfacing as 15 stale orphan-
 * monthly cells in the HeatMap (real count was 36 annual). The fix at
 * `route.ts:40-44` renames it to `defaultPeriodString()` returning
 * `String(getUTCFullYear())`. This test pins that contract: the request
 * with no `?period=` MUST query Prisma with a 4-digit year string.
 *
 * Also covers: 401 unauth, 400 invalid period, period override via
 * query string. The auth gate + tenant scoping shape mirrors
 * `companies/[id]/handler.test.ts` — proves the harness is reusable
 * across routes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findMany: vi.fn() },
    indicatorDefinition: { findMany: vi.fn() },
    indicatorValue: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { mockSession, makeRequest } from '@/test/api-harness';
import { GET } from './route';

const ORG_ID = 'org_az';

beforeEach(() => {
  prismaMock.company.findMany.mockReset().mockResolvedValue([]);
  prismaMock.indicatorDefinition.findMany.mockReset().mockResolvedValue([]);
  prismaMock.indicatorValue.findMany.mockReset().mockResolvedValue([]);
});

describe('GET /api/indicators/matrix — handler', () => {
  it('returns 401 when unauthenticated', async () => {
    await mockSession(null);
    const res = await GET(makeRequest('/api/indicators/matrix'));
    expect(res.status).toBe(401);
    expect(prismaMock.company.findMany).not.toHaveBeenCalled();
  });

  it('defaults to annual period (YYYY) — Turn-16 regression guard', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    // Stub a single operational company + a single indicator so the
    // findMany on indicatorValue actually runs (the route short-circuits
    // when either list is empty).
    prismaMock.company.findMany.mockResolvedValue([
      {
        id: 'c1',
        code: 'AAC',
        name: 'AAC',
        industry: 'hospitality',
        level: 2,
        isActive: true,
        role: 'operational',
        sortOrder: 1,
      },
    ]);
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: 'i1',
        code: 'GROSS_MARGIN',
        nameEn: 'Gross Margin',
        direction: 'higher_is_better',
        unit: '%',
        sortOrder: 1,
      },
    ]);

    const res = await GET(makeRequest('/api/indicators/matrix'));
    expect(res.status).toBe(200);
    const body = await res.json();

    // The exact year is wall-clock dependent, but it MUST be a 4-digit
    // string (annual), not a YYYY-MM monthly key — that's the regression.
    expect(body.period).toMatch(/^\d{4}$/);
    expect(body.period).not.toMatch(/-\d{2}$/);

    // And the indicatorValue.findMany call must scope to that same period.
    expect(prismaMock.indicatorValue.findMany).toHaveBeenCalledTimes(1);
    const ivCall = prismaMock.indicatorValue.findMany.mock.calls[0][0];
    expect(ivCall.where.period).toBe(body.period);
    expect(ivCall.where.organizationId).toBe(ORG_ID);
  });

  it('honors an explicit ?period=YYYY-MM override', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    prismaMock.company.findMany.mockResolvedValue([
      {
        id: 'c1',
        code: 'AAC',
        name: 'AAC',
        industry: 'hospitality',
        level: 2,
        isActive: true,
        role: 'operational',
        sortOrder: 1,
      },
    ]);
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: 'i1',
        code: 'X',
        nameEn: 'X',
        direction: 'higher_is_better',
        unit: '%',
        sortOrder: 1,
      },
    ]);

    const res = await GET(makeRequest('/api/indicators/matrix?period=2026-04'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.period).toBe('2026-04');
    const ivCall = prismaMock.indicatorValue.findMany.mock.calls[0][0];
    expect(ivCall.where.period).toBe('2026-04');
  });

  it('rejects malformed period with 400 — gate fires before any DB hit', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    const res = await GET(makeRequest('/api/indicators/matrix?period=garbage'));
    expect(res.status).toBe(400);
    // Lock the gate ordering — period validation must precede company /
    // indicator lookups, otherwise a malformed query still wastes DB hits.
    expect(prismaMock.company.findMany).not.toHaveBeenCalled();
    expect(prismaMock.indicatorDefinition.findMany).not.toHaveBeenCalled();
    expect(prismaMock.indicatorValue.findMany).not.toHaveBeenCalled();
  });

  it('skips indicatorValue.findMany when no operational companies', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    prismaMock.company.findMany.mockResolvedValue([
      // admin entity → filtered out by filterOperationalCompanies
      {
        id: 'c1',
        code: 'HQ',
        name: 'HQ',
        industry: null,
        level: 2,
        isActive: true,
        role: 'admin',
        sortOrder: 1,
      },
    ]);
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: 'i1',
        code: 'X',
        nameEn: 'X',
        direction: 'higher_is_better',
        unit: '%',
        sortOrder: 1,
      },
    ]);

    const res = await GET(makeRequest('/api/indicators/matrix'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.companies).toEqual([]);
    expect(body.cells).toEqual([]);
    expect(prismaMock.indicatorValue.findMany).not.toHaveBeenCalled();
  });
});
