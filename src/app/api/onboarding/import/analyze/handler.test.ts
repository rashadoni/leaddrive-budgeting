/**
 * Handler tests for `POST /api/onboarding/import/analyze` — the AI Data
 * Mapper entry point. Mocks the LLM surface (`runMapper`) and the
 * extract pipeline so the route's HTTP shape is exercised without a
 * real Anthropic call or a real xlsx parse.
 *
 * Coverage:
 *  - 503 when ANTHROPIC_API_KEY missing (the early-block guard)
 *  - 401 unauth, 403 below-manager
 *  - 404 cross-tenant company
 *  - 502 when runMapper throws (LLM operational failure)
 *  - 201 happy path → ImportStaging row created with the proposal,
 *    `usage` field stripped from response and persistence, sourceColumns
 *    surfaced, expiresAt is 24h ahead
 *
 * The multipart-body shape uses the same `Request` → `NextRequest` wrap
 * pattern as `budget/handler.test.ts` (FormData boundary preservation).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock, aiMocks, hasKeyMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findFirst: vi.fn() },
    importStaging: { create: vi.fn() },
  },
  aiMocks: {
    extractMapperInput: vi.fn(),
    runMapper: vi.fn(),
  },
  hasKeyMock: { hasAnthropicKey: vi.fn().mockReturnValue(true) },
}));

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/onboarding/ai-mapper/extract', () => ({
  extractMapperInput: aiMocks.extractMapperInput,
}));
vi.mock('@/lib/onboarding/ai-mapper/mapper', () => ({
  runMapper: aiMocks.runMapper,
}));
vi.mock('@/lib/ai/client', () => hasKeyMock);
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
const STAGING_ID = 'staging_new';

async function makeMultipartRequest(): Promise<NextRequest> {
  const fd = new FormData();
  fd.set('file', new File(['fake'], 'aac.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  fd.set('companyId', COMPANY_ID);
  const base = new Request('http://localhost/api/onboarding/import/analyze', {
    method: 'POST',
    body: fd,
  });
  const { NextRequest } = await import('next/server');
  return new NextRequest(base);
}

beforeEach(() => {
  prismaMock.company.findFirst.mockReset();
  prismaMock.importStaging.create.mockReset();
  aiMocks.extractMapperInput.mockReset();
  aiMocks.runMapper.mockReset();
  hasKeyMock.hasAnthropicKey.mockReset().mockReturnValue(true);
});

describe('POST /api/onboarding/import/analyze — handler', () => {
  it('returns 503 when ANTHROPIC_API_KEY is not configured', async () => {
    hasKeyMock.hasAnthropicKey.mockReturnValue(false);
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    const req = await makeMultipartRequest();
    const res = await POST(req);
    expect(res.status).toBe(503);
    expect(prismaMock.company.findFirst).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    await mockSession(null);
    const req = await makeMultipartRequest();
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 when caller is below manager', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'editor' });
    const req = await makeMultipartRequest();
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(prismaMock.company.findFirst).not.toHaveBeenCalled();
  });

  it('returns 404 on cross-tenant companyId (no LLM call)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    prismaMock.company.findFirst.mockResolvedValue(null);
    const req = await makeMultipartRequest();
    const res = await POST(req);
    expect(res.status).toBe(404);
    expect(aiMocks.runMapper).not.toHaveBeenCalled();
    expect(prismaMock.importStaging.create).not.toHaveBeenCalled();
  });

  it('returns 400 when extractMapperInput returns an error (no LLM call)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    prismaMock.company.findFirst.mockResolvedValue({
      id: COMPANY_ID,
      name: 'AAC',
      industry: 'hospitality',
    });
    aiMocks.extractMapperInput.mockReturnValue({
      error: 'Sheet has no header row recognisable as a P&L layout',
    });

    const req = await makeMultipartRequest();
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no header row/);
    expect(aiMocks.runMapper).not.toHaveBeenCalled();
    expect(prismaMock.importStaging.create).not.toHaveBeenCalled();
  });

  it('returns 502 when runMapper throws (LLM operational failure)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u1', role: 'manager' });
    prismaMock.company.findFirst.mockResolvedValue({
      id: COMPANY_ID,
      name: 'AAC',
      industry: 'hospitality',
    });
    aiMocks.extractMapperInput.mockReturnValue({
      columns: [{ index: 0, headerText: 'KOD' }],
      rows: [],
      sourceFile: 'aac.xlsx',
      sheetName: 'SOPL',
      companyName: 'AAC',
      industry: 'hospitality',
    });
    aiMocks.runMapper.mockRejectedValue(new Error('rate limited by Anthropic'));
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

    const req = await makeMultipartRequest();
    const res = await POST(req);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/rate limited by Anthropic/);
    expect(prismaMock.importStaging.create).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('happy path: persists proposal (without usage) + returns 201 with sourceColumns', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    prismaMock.company.findFirst.mockResolvedValue({
      id: COMPANY_ID,
      name: 'AAC',
      industry: 'hospitality',
    });
    aiMocks.extractMapperInput.mockReturnValue({
      columns: [
        { index: 0, headerText: 'KOD' },
        { index: 1, headerText: 'Adı' },
      ],
      rows: [],
      sourceFile: 'aac.xlsx',
      sheetName: 'SOPL',
      companyName: 'AAC',
      industry: 'hospitality',
    });
    aiMocks.runMapper.mockResolvedValue({
      mappings: [{ sourceIndex: 0, role: 'code', confidence: 0.9 }],
      // `usage` MUST be stripped from both response + persisted proposal.
      usage: { inputTokens: 1000, outputTokens: 200 },
    });
    prismaMock.importStaging.create.mockResolvedValue({ id: STAGING_ID });

    const req = await makeMultipartRequest();
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.stagingId).toBe(STAGING_ID);
    expect(body.proposal).toEqual({
      mappings: [{ sourceIndex: 0, role: 'code', confidence: 0.9 }],
    });
    expect(body.proposal.usage).toBeUndefined();
    expect(body.sourceColumns).toEqual([
      { sourceIndex: 0, headerText: 'KOD' },
      { sourceIndex: 1, headerText: 'Adı' },
    ]);

    // expiresAt ≈ now + 24h. Allow ±1min slop for test runtime.
    const expires = new Date(body.expiresAt).getTime();
    const expected = Date.now() + 24 * 60 * 60 * 1000;
    expect(Math.abs(expires - expected)).toBeLessThan(60_000);

    // Persistence: usage must NOT be in the saved proposal.
    expect(prismaMock.importStaging.create).toHaveBeenCalledTimes(1);
    const persistCall = prismaMock.importStaging.create.mock.calls[0][0];
    expect(persistCall.data.organizationId).toBe(ORG_ID);
    expect(persistCall.data.companyId).toBe(COMPANY_ID);
    expect(persistCall.data.status).toBe('pending');
    expect(persistCall.data.sourceFile).toBe('aac.xlsx');
    expect(persistCall.data.proposal.usage).toBeUndefined();
    expect(persistCall.data.createdBy).toBe('u_mgr');
  });
});
