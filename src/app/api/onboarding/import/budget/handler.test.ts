/**
 * Handler test for `POST /api/onboarding/import/budget` — runtime proof
 * that `import_budget_create` audit emission fires with the correct
 * discriminated metadata shape after a successful import.
 *
 * Closes architect Turn-21 ⚠️: prior turn's "blocker too brittle" reframe
 * was vague — `prisma.$transaction(cb)` mocks one-line, the parser
 * (`parseSoplSheet`) mocks via `vi.mock` of the adapter module, and
 * `runRecomputeForCompanies` mocks the same way. Locked in here.
 *
 * Scope: happy-path emission only — auth gate, parser-error, multipart
 * malformed, and similar already covered by individual unit tests on the
 * parser and shared helpers. The audit-emission write-side is the
 * unique-to-this-file concern.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock, recomputeMock, parserMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findFirst: vi.fn() },
    $transaction: vi.fn(),
    auditEvent: { create: vi.fn() },
  },
  recomputeMock: { runRecomputeForCompanies: vi.fn() },
  parserMock: {
    parseSoplSheet: vi.fn(),
    parseSummaryRollupSheet: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/risk/recompute-trigger', () => recomputeMock);
vi.mock('@/lib/onboarding/adapters/azmade-sopl', () => parserMock);
// Bypass rate limiter — process-global bucket would trip across tests.
vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit')>(
    '@/lib/rate-limit',
  );
  return {
    ...actual,
    enforceRateLimit: vi.fn().mockReturnValue(null),
    getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  };
});
// xlsx parsing is real here but the result is shadowed by the mocked
// adapters above (we never read SheetNames or sheet contents through
// real XLSX paths in these tests). Mock at module level so the file size
// check + sheet-existence check pass without a real workbook payload.
vi.mock('xlsx', () => ({
  read: vi.fn().mockReturnValue({
    SheetNames: ['SOPL'],
    Sheets: { SOPL: {} },
  }),
}));

import type { NextRequest } from 'next/server';
import { mockSession } from '@/test/api-harness';
import { POST } from './route';

const ORG_ID = 'org_az';
const COMPANY_ID = 'co_aac';
const PLAN_ID = 'plan_2026';

beforeEach(() => {
  prismaMock.company.findFirst.mockReset();
  prismaMock.$transaction.mockReset();
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: 'audit_1' });
  recomputeMock.runRecomputeForCompanies
    .mockReset()
    .mockResolvedValue({ ok: 5, unknown: 1, failed: 0, targets: 6 });
  parserMock.parseSoplSheet.mockReset();
  parserMock.parseSummaryRollupSheet.mockReset();
});

/**
 * Build a multipart/form-data POST. Has to bypass the harness's
 * `makeRequest` because that serialises body via JSON-shorthand path
 * and NextRequest's strict typing forces an explicit Headers object
 * which strips the FormData-auto-set boundary content-type.
 *
 * Easiest reliable shape: build a global `Request` (which knows how to
 * boundary-encode FormData), then wrap it in `NextRequest`.
 */
async function makeMultipartRequest(): Promise<NextRequest> {
  const fd = new FormData();
  fd.set('file', new File(['fake'], 'aac.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  fd.set('companyId', COMPANY_ID);
  fd.set('sheetName', 'SOPL');
  fd.set('year', '2026');
  fd.set('parser', 'sopl');
  const base = new Request('http://localhost/api/onboarding/import/budget', {
    method: 'POST',
    body: fd,
  });
  const { NextRequest } = await import('next/server');
  return new NextRequest(base);
}

describe('POST /api/onboarding/import/budget — handler', () => {
  it('emits import_budget_create audit with full metadata shape on happy path', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    prismaMock.company.findFirst.mockResolvedValue({
      id: COMPANY_ID,
      code: 'AAC',
      name: 'AAC',
      industry: 'hospitality',
      level: 2,
    });
    parserMock.parseSoplSheet.mockReturnValue({
      lines: [{ code: '5000', label: 'Revenue', accountType: 'revenue' }],
      warnings: [{ row: 3, reason: 'unknown col' }],
      parentRollupsDropped: [{ code: 'PARENT', plannedAnnual: 100 }],
      parentRollupsUnallocated: [],
      skippedRowCount: 0,
    });
    // $transaction returns whatever its callback returns — we short-circuit
    // by skipping the inner Prisma calls and returning the expected shape.
    prismaMock.$transaction.mockImplementation(async (cb) => {
      // Don't invoke `cb` — the route only consumes the return value.
      return {
        inserted: 1,
        deleted: 0,
        warnings: 1,
        parentRollupsDropped: 1,
        parentRollupsUnallocated: 0,
        planId: PLAN_ID,
        planCreated: true,
      };
    });

    const req = await makeMultipartRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      planId: PLAN_ID,
      companyCode: 'AAC',
      year: 2026,
      auditStale: false,
    });

    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(1);
    const auditCall = prismaMock.auditEvent.create.mock.calls[0][0];
    expect(auditCall.data.action).toBe('import_budget_create');
    expect(auditCall.data.entityType).toBe('BudgetPlan');
    expect(auditCall.data.entityId).toBe(PLAN_ID);
    expect(auditCall.data.actorUserId).toBe('u1');
    expect(auditCall.data.metadata).toEqual({
      companyId: COMPANY_ID,
      companyCode: 'AAC',
      year: 2026,
      parser: 'sopl',
      inserted: 1,
      deleted: 0,
      warnings: 1,
      parentRollupsDropped: 1,
      parentRollupsUnallocated: 0,
      recompute: { ok: 5, unknown: 1, failed: 0, targets: 6 },
    });
  });

  it('returns 404 on cross-tenant companyId', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    prismaMock.company.findFirst.mockResolvedValue(null);
    const req = await makeMultipartRequest();
    const res = await POST(req);
    expect(res.status).toBe(404);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    await mockSession(null);
    const req = await makeMultipartRequest();
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(prismaMock.company.findFirst).not.toHaveBeenCalled();
  });
});
