/**
 * Handler tests for `POST /api/onboarding/import/staging/[id]/apply-multi-entity`.
 *
 * The corruption-zone slice (Codex-required adversarial set, 2026-06-20):
 *   401 / 404 / applied→409 / two-values→same-company 409 (injective) /
 *   present-unmapped 409 / cross-org 409 / entity-set drift 409 / RED 409 /
 *   one entity parse error → zero writes / happy-path routes per distinct
 *   company (delete once per company) + recompute fan-out + same code under
 *   two companies.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock, entityMocks, applierMocks, applyLinesMock, recomputeMock } = vi.hoisted(() => ({
  prismaMock: {
    importStaging: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    company: { findMany: vi.fn(), updateMany: vi.fn() },
    budgetPlan: { findFirst: vi.fn(), count: vi.fn() },
    budgetLine: { count: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  entityMocks: { applyProposalByEntity: vi.fn(), findEntityColumn: vi.fn() },
  applierMocks: { detectProposalYear: vi.fn() },
  applyLinesMock: { applyParsedLinesToCompany: vi.fn() },
  recomputeMock: { runRecomputeForCompanies: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/onboarding/ai-mapper/entity-split', () => entityMocks);
// `mergeProposal` is deliberately NOT stubbed: it computes the mapping the B5
// revision is fingerprinted from, so a stub would let the lineage assertions
// pass against a mock rather than the mapping actually applied.
vi.mock('@/lib/onboarding/ai-mapper/applier', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/lib/onboarding/ai-mapper/applier')
  >();
  return { ...actual, ...applierMocks };
});
vi.mock('@/lib/onboarding/ai-mapper/apply-lines', () => applyLinesMock);
vi.mock('@/lib/risk/recompute-trigger', () => recomputeMock);
vi.mock('xlsx', () => ({ read: vi.fn().mockReturnValue({ SheetNames: ['S'], Sheets: { S: {} } }) }));
vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit');
  return { ...actual, enforceRateLimit: vi.fn().mockReturnValue(null), getClientIp: vi.fn().mockReturnValue('127.0.0.1') };
});

import type { NextRequest as NextRequestType } from 'next/server';
import { mockSession, makeRequest } from '@/test/api-harness';
import { computeWorkbookContentHash } from '@/lib/onboarding/ai-mapper/workbook-content-hash';
import { POST } from './route';

const ORG_ID = 'org_az';
const STAGING_ID = 'staging_me';
const UPLOADED_WORKBOOK_HASH = computeWorkbookContentHash(
  new TextEncoder().encode('x'),
);

/**
 * Phase 10 / Stage B5 — the apply transaction now also pins the source state it
 * commits (`ensureDataRevision`), so every tx-spy needs the models that touches:
 * `dataRevision` for the revision itself and `user` for the actor lookup that
 * honours `createdById`'s nullable contract. Factory so the shape lives once.
 */
function makeTxSpy(over: Record<string, unknown> = {}) {
  return {
    budgetPlan: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'plan1' }),
    },
    importStaging: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({ id: STAGING_ID }),
    },
    dataRevision: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'rev_me_1' }),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'u' }) },
    ...over,
  };
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

const greenResult = (code: string, jan: number) => ({
  sheetName: 'S',
  lines: [{ code, label: code, accountType: 'revenue', plannedAnnual: jan, perMonth: [jan, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }],
  warnings: [],
  skippedRowCount: 0,
  parentRollupsDropped: [],
  parentRollupsUnallocated: [],
});

const redResult = () => ({
  sheetName: 'S',
  lines: [{ code: 'X', label: 'X', accountType: 'revenue', plannedAnnual: 1000, perMonth: [1000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }],
  warnings: [],
  skippedRowCount: 0,
  parentRollupsDropped: [{ code: 'P', label: 'P', plannedAnnual: 1000 }],
  parentRollupsUnallocated: [{ code: 'P-__UNALLOCATED__', parentCode: 'P', plannedAnnual: 500 }], // 50% → red
});

// Revenue + cost, but the inferred cost-sign convention is AMBIGUOUS → the
// validation engine hard-blocks (cannot safely decide the flip). Phase C C3.1b.
const signBlockedResult = () => ({
  sheetName: 'S',
  lines: [
    { code: 'R', label: 'R', accountType: 'revenue', plannedAnnual: 1000, perMonth: [1000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { code: 'C', label: 'C', accountType: 'cogs', plannedAnnual: 600, perMonth: [600, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  ],
  warnings: [],
  skippedRowCount: 0,
  parentRollupsDropped: [],
  parentRollupsUnallocated: [],
  signConventions: { cogs: { convention: 'ambiguous', evidence: { negRows: 1, posRows: 1, negAbs: 600, posAbs: 600, netSum: 0 } } },
});

function stage(opts: {
  status?: string;
  entityValues?: string[];
  anomalies?: unknown[];
  overallConfidence?: number;
  workbookHash?: string | null;
} = {}) {
  prismaMock.importStaging.findFirst.mockResolvedValue({
    id: STAGING_ID,
    companyId: 'anchor_co',
    status: opts.status ?? 'pending',
    sourceSheet: 'S',
    sourceFile: 'm.xlsx',
    proposal: {
      ...(opts.workbookHash === null
        ? {}
        : {
            __workbookContentSha256:
              opts.workbookHash ?? UPLOADED_WORKBOOK_HASH,
          }),
      columns: [{ sourceIndex: 0, role: 'code', confidence: 1 }],
      anomalies: opts.anomalies ?? [],
      overallConfidence: opts.overallConfidence ?? 0.95,
      __multiEntity: { entityColumnIndex: 14, entityValues: opts.entityValues ?? ['AZSF', 'EDEN'] },
    },
    userOverrides: null,
    expiresAt: new Date(Date.now() + 60_000),
    appliedAt: null,
  });
}

async function reqWith(fields: Record<string, string>): Promise<NextRequestType> {
  const fd = new FormData();
  fd.set('file', new File(['x'], 'm.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const base = new Request(`http://localhost/api/onboarding/import/staging/${STAGING_ID}/apply-multi-entity`, { method: 'POST', body: fd });
  const { NextRequest } = await import('next/server');
  return new NextRequest(base);
}

beforeEach(() => {
  for (const v of Object.values(prismaMock)) {
    if (typeof v === 'function') (v as { mockReset: () => void }).mockReset();
    else Object.values(v as object).forEach((fn) => (fn as { mockReset?: () => void }).mockReset?.());
  }
  prismaMock.auditEvent.create.mockResolvedValue({ id: 'a1' });
  prismaMock.company.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.budgetPlan.count.mockResolvedValue(0); // no pre-existing actual plan by default
  prismaMock.budgetPlan.findFirst.mockResolvedValue(null); // no targetPlanId match by default
  entityMocks.findEntityColumn.mockReset().mockReturnValue(14);
  entityMocks.applyProposalByEntity.mockReset();
  applierMocks.detectProposalYear.mockReset().mockReturnValue(2026);
  applyLinesMock.applyParsedLinesToCompany.mockReset().mockResolvedValue({ inserted: 1, deleted: 0 });
  recomputeMock.runRecomputeForCompanies.mockReset().mockResolvedValue({ ok: 2, unknown: 0, failed: 0, targets: 2 });
});

describe('POST .../apply-multi-entity', () => {
  it('401 when unauthenticated (no DB hit)', async () => {
    await mockSession(null);
    const res = await POST(makeRequest(`/x`, { method: 'POST' }), paramsFor(STAGING_ID));
    expect(res.status).toBe(401);
    expect(prismaMock.importStaging.findFirst).not.toHaveBeenCalled();
  });

  it('404 on cross-tenant / missing staging', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    prismaMock.importStaging.findFirst.mockResolvedValue(null);
    const res = await POST(makeRequest(`/x`, { method: 'POST' }), paramsFor(STAGING_ID));
    expect(res.status).toBe(404);
  });

  it('409 when already applied', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stage({ status: 'applied' });
    const res = await POST(makeRequest(`/x`, { method: 'POST' }), paramsFor(STAGING_ID));
    expect(res.status).toBe(409);
  });

  it('422 when the staging is not multi-entity (no entity column)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    entityMocks.findEntityColumn.mockReturnValue(null);
    stage();
    const res = await POST(await reqWith({ entityMap: '{}' }), paramsFor(STAGING_ID));
    expect(res.status).toBe(422);
  });

  it('409 when replacement workbook bytes do not match the analyzed upload', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stage({
      workbookHash: computeWorkbookContentHash(
        new TextEncoder().encode('reviewed-file'),
      ),
    });

    const res = await POST(
      await reqWith({ entityMap: JSON.stringify({ AZSF: 'coA', EDEN: 'coB' }) }),
      paramsFor(STAGING_ID),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ integrityError: 'mismatch' });
    expect(entityMocks.applyProposalByEntity).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('409 when staging has no byte-exact workbook fingerprint', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stage({ workbookHash: null });

    const res = await POST(
      await reqWith({ entityMap: JSON.stringify({ AZSF: 'coA', EDEN: 'coB' }) }),
      paramsFor(STAGING_ID),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ integrityError: 'missing' });
    expect(entityMocks.applyProposalByEntity).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('409 on entity-set drift (file BU set ≠ reviewed set)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stage({ entityValues: ['AZSF', 'EDEN'] });
    entityMocks.applyProposalByEntity.mockReturnValue({
      entityColumn: 14,
      entityValues: ['AZSF', 'OTHER'], // drifted
      perEntity: [
        { entityValue: 'AZSF', result: greenResult('X', 100) },
        { entityValue: 'OTHER', result: greenResult('Y', 50) },
      ],
    });
    const res = await POST(await reqWith({ entityMap: JSON.stringify({ AZSF: 'coA', OTHER: 'coB' }) }), paramsFor(STAGING_ID));
    expect(res.status).toBe(409);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('409 when an entity is present in the file but unmapped', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stage();
    entityMocks.applyProposalByEntity.mockReturnValue({
      entityColumn: 14,
      entityValues: ['AZSF', 'EDEN'],
      perEntity: [
        { entityValue: 'AZSF', result: greenResult('X', 100) },
        { entityValue: 'EDEN', result: greenResult('Y', 50) },
      ],
    });
    prismaMock.company.findMany.mockResolvedValue([{ id: 'coA', baseCurrencyCode: 'AZN' }]);
    const res = await POST(await reqWith({ entityMap: JSON.stringify({ AZSF: 'coA' }) }), paramsFor(STAGING_ID));
    expect(res.status).toBe(409);
    expect((await res.json()).unmapped).toContain('EDEN');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('skips a __SKIP__ entity (EJE) — not written, not required to be mapped', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    stage({ entityValues: ['AZSF', 'EJE'] });
    entityMocks.applyProposalByEntity.mockReturnValue({
      entityColumn: 14,
      entityValues: ['AZSF', 'EJE'],
      perEntity: [
        { entityValue: 'AZSF', result: greenResult('X', 100) },
        { entityValue: 'EJE', result: greenResult('Y', 50) }, // has lines, but reviewer skips it
      ],
    });
    prismaMock.company.findMany.mockResolvedValue([{ id: 'coA', baseCurrencyCode: 'AZN' }]);
    applyLinesMock.applyParsedLinesToCompany.mockResolvedValueOnce({ inserted: 1, deleted: 0 });
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb(makeTxSpy());
    });
    const res = await POST(await reqWith({ entityMap: JSON.stringify({ AZSF: 'coA', EJE: '__SKIP__' }) }), paramsFor(STAGING_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toEqual(['EJE']);
    expect(body.entityCount).toBe(1);
    // EJE excluded from the write; only AZSF committed (no unmapped-409 for EJE).
    expect(applyLinesMock.applyParsedLinesToCompany).toHaveBeenCalledTimes(1);
    expect(applyLinesMock.applyParsedLinesToCompany.mock.calls[0][1].companyId).toBe('coA');
  });

  it('409 when two entity values map to the SAME company (collateral-wipe path)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stage();
    entityMocks.applyProposalByEntity.mockReturnValue({
      entityColumn: 14,
      entityValues: ['AZSF', 'EDEN'],
      perEntity: [
        { entityValue: 'AZSF', result: greenResult('X', 100) },
        { entityValue: 'EDEN', result: greenResult('Y', 50) },
      ],
    });
    prismaMock.company.findMany.mockResolvedValue([{ id: 'coA', baseCurrencyCode: 'AZN' }]);
    const res = await POST(await reqWith({ entityMap: JSON.stringify({ AZSF: 'coA', EDEN: 'coA' }) }), paramsFor(STAGING_ID));
    expect(res.status).toBe(409);
    expect((await res.json()).duplicateCompanyIds).toContain('coA');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('409 when a mapped company is out of org', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stage();
    entityMocks.applyProposalByEntity.mockReturnValue({
      entityColumn: 14,
      entityValues: ['AZSF', 'EDEN'],
      perEntity: [
        { entityValue: 'AZSF', result: greenResult('X', 100) },
        { entityValue: 'EDEN', result: greenResult('Y', 50) },
      ],
    });
    // company.findMany filters by org — coX is not returned (cross-org).
    prismaMock.company.findMany.mockResolvedValue([{ id: 'coA', baseCurrencyCode: 'AZN' }]);
    const res = await POST(await reqWith({ entityMap: JSON.stringify({ AZSF: 'coA', EDEN: 'coX' }) }), paramsFor(STAGING_ID));
    expect(res.status).toBe(409);
    expect((await res.json()).crossOrg).toContain('coX');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('409 on RED control-total for any entity', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stage();
    entityMocks.applyProposalByEntity.mockReturnValue({
      entityColumn: 14,
      entityValues: ['AZSF', 'EDEN'],
      perEntity: [
        { entityValue: 'AZSF', result: greenResult('X', 100) },
        { entityValue: 'EDEN', result: redResult() },
      ],
    });
    prismaMock.company.findMany.mockResolvedValue([{ id: 'coA', baseCurrencyCode: 'AZN' }, { id: 'coB', baseCurrencyCode: 'AZN' }]);
    const res = await POST(await reqWith({ entityMap: JSON.stringify({ AZSF: 'coA', EDEN: 'coB' }) }), paramsFor(STAGING_ID));
    expect(res.status).toBe(409);
    expect((await res.json()).controlVerdict).toBe('red');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('409 + ZERO writes when an entity has a wrong/ambiguous cost-sign convention (validation hard-block)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stage();
    entityMocks.applyProposalByEntity.mockReturnValue({
      entityColumn: 14,
      entityValues: ['AZSF', 'EDEN'],
      perEntity: [
        { entityValue: 'AZSF', result: greenResult('X', 100) },
        { entityValue: 'EDEN', result: signBlockedResult() },
      ],
    });
    prismaMock.company.findMany.mockResolvedValue([{ id: 'coA', baseCurrencyCode: 'AZN' }, { id: 'coB', baseCurrencyCode: 'AZN' }]);
    const res = await POST(await reqWith({ entityMap: JSON.stringify({ AZSF: 'coA', EDEN: 'coB' }) }), paramsFor(STAGING_ID));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.blockedEntities.some((b: { entityValue: string }) => b.entityValue === 'EDEN')).toBe(true);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(applyLinesMock.applyParsedLinesToCompany).not.toHaveBeenCalled();
  });

  it('409 + ZERO writes when one entity fails to parse (all-or-none)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stage();
    entityMocks.applyProposalByEntity.mockReturnValue({
      entityColumn: 14,
      entityValues: ['AZSF', 'EDEN'],
      perEntity: [
        { entityValue: 'AZSF', result: greenResult('X', 100) },
        { entityValue: 'EDEN', error: 'Sheet parse boom' },
      ],
    });
    prismaMock.company.findMany.mockResolvedValue([{ id: 'coA', baseCurrencyCode: 'AZN' }, { id: 'coB', baseCurrencyCode: 'AZN' }]);
    const res = await POST(await reqWith({ entityMap: JSON.stringify({ AZSF: 'coA', EDEN: 'coB' }) }), paramsFor(STAGING_ID));
    expect(res.status).toBe(409);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(applyLinesMock.applyParsedLinesToCompany).not.toHaveBeenCalled();
  });

  it('happy path: routes each entity to its company (delete once per company) + recompute fan-out', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u_mgr', role: 'manager' });
    stage();
    // Same account code 'X' under BOTH entities — must land under two companyIds.
    entityMocks.applyProposalByEntity.mockReturnValue({
      entityColumn: 14,
      entityValues: ['AZSF', 'EDEN'],
      perEntity: [
        { entityValue: 'AZSF', result: greenResult('X', 100) },
        { entityValue: 'EDEN', result: greenResult('X', 200) },
      ],
    });
    prismaMock.company.findMany.mockResolvedValue([
      { id: 'coA', baseCurrencyCode: 'AZN' },
      { id: 'coB', baseCurrencyCode: 'USD' },
    ]);
    applyLinesMock.applyParsedLinesToCompany
      .mockResolvedValueOnce({ inserted: 1, deleted: 3 })
      .mockResolvedValueOnce({ inserted: 1, deleted: 2 });
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb(makeTxSpy());
    });

    const res = await POST(await reqWith({ entityMap: JSON.stringify({ AZSF: 'coA', EDEN: 'coB' }) }), paramsFor(STAGING_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'applied', year: 2026, entityCount: 2, inserted: 2, deleted: 5 });

    // applyParsedLinesToCompany called once per distinct company, with the
    // shared plan + the right companyId + currency + the same code 'X'.
    expect(applyLinesMock.applyParsedLinesToCompany).toHaveBeenCalledTimes(2);
    const calls = applyLinesMock.applyParsedLinesToCompany.mock.calls.map((c) => c[1]);
    const coA = calls.find((a) => a.companyId === 'coA');
    const coB = calls.find((a) => a.companyId === 'coB');
    expect(coA).toMatchObject({ organizationId: ORG_ID, planId: 'plan1', baseCurrencyCode: 'AZN' });
    expect(coB).toMatchObject({ organizationId: ORG_ID, planId: 'plan1', baseCurrencyCode: 'USD' });
    expect(coA.lines[0].code).toBe('X');
    expect(coB.lines[0].code).toBe('X');
    expect(coA.lines[0].plannedAnnual).toBe(100);
    expect(coB.lines[0].plannedAnnual).toBe(200);

    // Recompute fan-out covers BOTH companies.
    expect(recomputeMock.runRecomputeForCompanies).toHaveBeenCalledTimes(1);
    const pairs = recomputeMock.runRecomputeForCompanies.mock.calls[0][2]; // 3rd arg (orgId is [1])
    expect(pairs).toEqual(expect.arrayContaining([
      { companyId: 'coA', year: 2026 },
      { companyId: 'coB', year: 2026 },
    ]));

    // Audit records the multi-entity discriminator.
    const audit = prismaMock.auditEvent.create.mock.calls[0][0];
    expect(audit.data.metadata.multiEntity).toBe(true);
    expect(audit.data.metadata.entityCount).toBe(2);
  });

  it('dryRun=true → 200 preview, no transaction, surfaces mapping issues advisory', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stage();
    entityMocks.applyProposalByEntity.mockReturnValue({
      entityColumn: 14,
      entityValues: ['AZSF', 'EDEN'],
      perEntity: [
        { entityValue: 'AZSF', result: greenResult('X', 100) },
        { entityValue: 'EDEN', result: greenResult('Y', 50) },
      ],
    });
    prismaMock.company.findMany.mockResolvedValue([{ id: 'coA', baseCurrencyCode: 'AZN' }]);
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null);
    // EDEN unmapped → advisory, but dry-run never 409s.
    const res = await POST(await reqWith({ dryRun: 'true', entityMap: JSON.stringify({ AZSF: 'coA' }) }), paramsFor(STAGING_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.entityCount).toBe(2);
    expect(body.mappingIssues.unmapped).toContain('EDEN');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('409 when the entity column index differs from the reviewed one (Codex P1 #6)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stage({ entityValues: ['AZSF', 'EDEN'] }); // __multiEntity.entityColumnIndex defaults to 14
    entityMocks.applyProposalByEntity.mockReturnValue({
      entityColumn: 99, // overridden to a DIFFERENT column than reviewed (14)
      entityValues: ['AZSF', 'EDEN'],
      perEntity: [
        { entityValue: 'AZSF', result: greenResult('X', 100) },
        { entityValue: 'EDEN', result: greenResult('Y', 50) },
      ],
    });
    const res = await POST(await reqWith({ entityMap: JSON.stringify({ AZSF: 'coA', EDEN: 'coB' }) }), paramsFor(STAGING_ID));
    expect(res.status).toBe(409);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // ── Option C: explicit plan target (2026-06-21) ──────────────────────────
  function txWithPlanCreate(inTxPlan: { id: string } | null = { id: 'existing-plan' }) {
    const planCreate = vi.fn().mockResolvedValue({ id: 'newplan' });
    const planFindFirst = vi.fn().mockResolvedValue(inTxPlan); // in-tx TOCTOU recheck
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb(
        makeTxSpy({ budgetPlan: { create: planCreate, findFirst: planFindFirst } }),
      );
    });
    return { planCreate, planFindFirst };
  }
  function oneEntity() {
    stage({ entityValues: ['AZSF'] });
    entityMocks.applyProposalByEntity.mockReturnValue({
      entityColumn: 14, entityValues: ['AZSF'], perEntity: [{ entityValue: 'AZSF', result: greenResult('X', 100) }],
    });
    prismaMock.company.findMany.mockResolvedValue([{ id: 'coA', baseCurrencyCode: 'AZN' }]);
  }

  it('targetPlanId → UPDATES the existing plan (no new plan created)', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    oneEntity();
    prismaMock.budgetPlan.findFirst.mockResolvedValue({ id: 'existing-plan' }); // org+year match
    const { planCreate } = txWithPlanCreate();
    const res = await POST(await reqWith({ entityMap: JSON.stringify({ AZSF: 'coA' }), targetPlanId: 'existing-plan' }), paramsFor(STAGING_ID));
    expect(res.status).toBe(200);
    expect(planCreate).not.toHaveBeenCalled(); // used existing, didn't create
    expect(applyLinesMock.applyParsedLinesToCompany.mock.calls[0][1].planId).toBe('existing-plan');
  });

  it('targetPlanId soft-deleted DURING the tx (TOCTOU) → 409, no create', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    oneEntity();
    prismaMock.budgetPlan.findFirst.mockResolvedValue({ id: 'existing-plan' }); // pre-tx OK
    const { planCreate } = txWithPlanCreate(null); // in-tx recheck → gone
    const res = await POST(await reqWith({ entityMap: JSON.stringify({ AZSF: 'coA' }), targetPlanId: 'existing-plan' }), paramsFor(STAGING_ID));
    expect(res.status).toBe(409);
    expect(planCreate).not.toHaveBeenCalled();
  });

  it('targetPlanId not found / wrong year → 400, no tx', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    oneEntity();
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null); // no match
    const res = await POST(await reqWith({ entityMap: JSON.stringify({ AZSF: 'coA' }), targetPlanId: 'bogus' }), paramsFor(STAGING_ID));
    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('newPlanName + planKind=budget → creates plan with explicit name + kind', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    oneEntity();
    const { planCreate } = txWithPlanCreate();
    const res = await POST(await reqWith({ entityMap: JSON.stringify({ AZSF: 'coA' }), newPlanName: 'My 2026 Plan', planKind: 'budget' }), paramsFor(STAGING_ID));
    expect(res.status).toBe(200);
    expect(planCreate).toHaveBeenCalledOnce();
    expect(planCreate.mock.calls[0][0].data).toMatchObject({ name: 'My 2026 Plan', kind: 'budget' });
  });

  it('creating a 2nd actual plan when one exists → 409 requiresAcknowledgement; ack → 200', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    oneEntity();
    prismaMock.budgetPlan.count.mockResolvedValue(1); // an actual plan already exists this year
    txWithPlanCreate();
    // no ack → blocked
    const blocked = await POST(await reqWith({ entityMap: JSON.stringify({ AZSF: 'coA' }), planKind: 'actual' }), paramsFor(STAGING_ID));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).requiresAcknowledgement).toBe('acknowledgeSecondActualPlan');
    // with ack → proceeds
    const ok = await POST(await reqWith({ entityMap: JSON.stringify({ AZSF: 'coA' }), planKind: 'actual', acknowledgeSecondActualPlan: 'true' }), paramsFor(STAGING_ID));
    expect(ok.status).toBe(200);
  });
});

/**
 * Phase 10 / Stage B5 — multi-company import revision, from committed writes.
 *
 * The rule these tests exist to enforce: `companyIds` is derived from what the
 * transaction actually wrote, never from the entity map, the request or the
 * plan. Those state intent; a revision attests to fact. Every test below runs
 * the real `$transaction` callback so the scope is the route's, not a fixture's.
 */
describe('POST .../apply-multi-entity — B5 multi-company import revision', () => {
  const REVISION_ID = 'rev_me_1';

  function wireTx(over: Record<string, unknown> = {}) {
    const dataRevisionCreate = vi.fn().mockResolvedValue({ id: REVISION_ID });
    const spy = makeTxSpy({
      dataRevision: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: dataRevisionCreate,
      },
      ...over,
    });
    prismaMock.$transaction.mockImplementation(
      async (cb: (tx: unknown) => Promise<unknown>) => cb(spy),
    );
    return { dataRevisionCreate };
  }

  function stageTwoEntities() {
    stage({ entityValues: ['AZSF', 'EDEN'] });
    entityMocks.applyProposalByEntity.mockReturnValue({
      entityColumn: 14,
      entityValues: ['AZSF', 'EDEN'],
      perEntity: [
        { entityValue: 'AZSF', result: greenResult('X', 100) },
        { entityValue: 'EDEN', result: greenResult('Y', 50) },
      ],
    });
    prismaMock.company.findMany.mockResolvedValue([
      { id: 'coA', baseCurrencyCode: 'AZN' },
      { id: 'coB', baseCurrencyCode: 'AZN' },
    ]);
  }

  const twoEntityMap = JSON.stringify({ AZSF: 'coA', EDEN: 'coB' });

  function revisionData(spy: { dataRevisionCreate: ReturnType<typeof vi.fn> }) {
    return (
      spy.dataRevisionCreate.mock.calls as unknown as Array<
        [{ data: Record<string, string[] & string> }]
      >
    )[0][0].data;
  }

  it('names every company the transaction actually wrote', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stageTwoEntities();
    applyLinesMock.applyParsedLinesToCompany
      .mockResolvedValueOnce({ inserted: 3, deleted: 0 })
      .mockResolvedValueOnce({ inserted: 2, deleted: 1 });
    const spy = wireTx();

    const res = await POST(await reqWith({ entityMap: twoEntityMap }), paramsFor(STAGING_ID));
    expect(res.status).toBe(200);

    const data = revisionData(spy);
    expect(data.companyIds).toEqual(['coA', 'coB']);
    expect(data.organizationId).toBe(ORG_ID);
    expect(data.reason).toBe('import');
    expect(data.sourceArtifactIds).toEqual([`import-staging:${STAGING_ID}`]);
    expect(data.mappingVersionIds).toHaveLength(1);
    expect(data.mappingVersionIds[0]).toMatch(/^effective-mapping:[0-9a-f]{64}$/);
    expect(data.periodFrom).toBe('2026-01');
    expect(data.periodTo).toBe('2026-12');
  });

  it('one written company yields a one-company revision', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stage({ entityValues: ['AZSF'] });
    entityMocks.applyProposalByEntity.mockReturnValue({
      entityColumn: 14,
      entityValues: ['AZSF'],
      perEntity: [{ entityValue: 'AZSF', result: greenResult('X', 100) }],
    });
    prismaMock.company.findMany.mockResolvedValue([{ id: 'coA', baseCurrencyCode: 'AZN' }]);
    applyLinesMock.applyParsedLinesToCompany.mockResolvedValue({ inserted: 3, deleted: 0 });
    const spy = wireTx();

    await POST(await reqWith({ entityMap: JSON.stringify({ AZSF: 'coA' }) }), paramsFor(STAGING_ID));

    expect(revisionData(spy).companyIds).toEqual(['coA']);
  });

  it('a mapped company that wrote NOTHING is not in the revision', async () => {
    // The entity map named two; the transaction wrote one. The revision must
    // attest to the one — intent is not evidence.
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stageTwoEntities();
    applyLinesMock.applyParsedLinesToCompany
      .mockResolvedValueOnce({ inserted: 3, deleted: 0 })
      .mockResolvedValueOnce({ inserted: 0, deleted: 0 });
    const spy = wireTx();

    await POST(await reqWith({ entityMap: twoEntityMap }), paramsFor(STAGING_ID));

    const data = revisionData(spy);
    expect(data.companyIds).toEqual(['coA']);
    expect(data.companyIds).not.toContain('coB');
  });

  it('a company written only by DELETION is in the revision — its data changed', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stageTwoEntities();
    applyLinesMock.applyParsedLinesToCompany
      .mockResolvedValueOnce({ inserted: 3, deleted: 0 })
      .mockResolvedValueOnce({ inserted: 0, deleted: 9 });
    const spy = wireTx();

    await POST(await reqWith({ entityMap: twoEntityMap }), paramsFor(STAGING_ID));

    expect(revisionData(spy).companyIds).toEqual(['coA', 'coB']);
  });

  it('does not blanket-stamp the import revision onto any batch-recomputed KPI', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stageTwoEntities();
    applyLinesMock.applyParsedLinesToCompany
      .mockResolvedValueOnce({ inserted: 3, deleted: 0 })
      .mockResolvedValueOnce({ inserted: 0, deleted: 0 });
    wireTx();

    await POST(await reqWith({ entityMap: twoEntityMap }), paramsFor(STAGING_ID));

    const call = recomputeMock.runRecomputeForCompanies.mock.calls[0];
    // Both companies still take the normal refresh path; neither receives a
    // workbook-only revision for formulas that may have mixed dependencies.
    expect(call[2]).toEqual([
      { companyId: 'coA', year: 2026 },
      { companyId: 'coB', year: 2026 },
    ]);
    expect(call[4]).toBeUndefined();
  });

  it('rejects and rolls back when the transaction wrote nothing at all', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stageTwoEntities();
    applyLinesMock.applyParsedLinesToCompany.mockResolvedValue({ inserted: 0, deleted: 0 });
    const spy = wireTx();

    const res = await POST(await reqWith({ entityMap: twoEntityMap }), paramsFor(STAGING_ID));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.reasonCode).toBe('empty_committed_scope');
    // Fail-closed: no revision, and the import is gone with it.
    expect(spy.dataRevisionCreate).not.toHaveBeenCalled();
    expect(recomputeMock.runRecomputeForCompanies).not.toHaveBeenCalled();
  });

  it('the lineage error leaks no source data or identifiers', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stageTwoEntities();
    applyLinesMock.applyParsedLinesToCompany.mockResolvedValue({ inserted: 0, deleted: 0 });
    wireTx();

    const res = await POST(await reqWith({ entityMap: twoEntityMap }), paramsFor(STAGING_ID));
    const raw = JSON.stringify(await res.json());

    expect(raw).not.toContain('coA');
    expect(raw).not.toContain('coB');
    expect(raw).not.toContain('AZSF');
  });

  it('a lineage failure rolls the whole import back — no partial financial commit', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stageTwoEntities();
    const spy = wireTx({
      dataRevision: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(new Error('REVISION_WRITE_FAILED')),
      },
    });
    void spy;

    const res = await POST(await reqWith({ entityMap: twoEntityMap }), paramsFor(STAGING_ID));

    expect(res.status).toBe(500);
    // The lines were written in the same transaction; the throw takes them with it.
    expect(applyLinesMock.applyParsedLinesToCompany).toHaveBeenCalled();
    expect(recomputeMock.runRecomputeForCompanies).not.toHaveBeenCalled();
  });

  it('a source-write failure leaves no revision', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stageTwoEntities();
    applyLinesMock.applyParsedLinesToCompany.mockRejectedValue(new Error('WRITE_FAILED'));
    const spy = wireTx();

    const res = await POST(await reqWith({ entityMap: twoEntityMap }), paramsFor(STAGING_ID));

    expect(res.status).toBe(500);
    expect(spy.dataRevisionCreate).not.toHaveBeenCalled();
    expect(recomputeMock.runRecomputeForCompanies).not.toHaveBeenCalled();
  });

  it('a repeat apply creates no second revision — the staging claim stops it', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stageTwoEntities();
    const spy = wireTx({
      importStaging: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }), // lost the claim
        update: vi.fn(),
      },
    });

    const res = await POST(await reqWith({ entityMap: twoEntityMap }), paramsFor(STAGING_ID));

    expect(res.status).toBe(409);
    expect(spy.dataRevisionCreate).not.toHaveBeenCalled();
    expect(recomputeMock.runRecomputeForCompanies).not.toHaveBeenCalled();
  });

  it('reuses an identical revision rather than creating a duplicate', async () => {
    await mockSession({ orgId: ORG_ID, userId: 'u', role: 'manager' });
    stageTwoEntities();
    const dataRevisionCreate = vi.fn();
    wireTx({
      dataRevision: {
        findFirst: vi.fn().mockResolvedValue({ id: 'rev_existing' }),
        create: dataRevisionCreate,
      },
    });

    await POST(await reqWith({ entityMap: twoEntityMap }), paramsFor(STAGING_ID));

    expect(dataRevisionCreate).not.toHaveBeenCalled();
    expect(recomputeMock.runRecomputeForCompanies.mock.calls[0][4]).toBeUndefined();
  });

  it('records no actor rather than failing when the user vanished mid-request', async () => {
    // `createdById` is nullable with SetNull; a deleted author is a fact about
    // the author, not a reason to reject the import.
    await mockSession({ orgId: ORG_ID, userId: 'u_gone', role: 'manager' });
    stageTwoEntities();
    const spy = wireTx({ user: { findUnique: vi.fn().mockResolvedValue(null) } });

    const res = await POST(await reqWith({ entityMap: twoEntityMap }), paramsFor(STAGING_ID));

    expect(res.status).toBe(200);
    expect(revisionData(spy).createdById).toBeNull();
  });
});
