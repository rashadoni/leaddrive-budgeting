/**
 * Tests for `audit/log.ts` — the never-throws logger that backs Phase 7.F.
 * Mocks Prisma's `auditEvent.create` directly so the test runs without
 * a database. The contract under test:
 *  - Happy-path returns `{ ok: true, id }` and persists the discriminated
 *    metadata + optional context exactly as supplied.
 *  - DB-failure path returns `{ ok: false, error }` and logs to console
 *    instead of throwing — caller workflows must not be aborted by an
 *    audit-trail outage.
 *  - Empty `organizationId` is rejected before any DB hit (defensive
 *    against env-var bugs in CLI scripts).
 *  - `context: null` round-trips as `Prisma.JsonNull` (not undefined,
 *    not the JS-literal "null" — Prisma treats those differently).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  logAuditEvent,
  buildAuditContext,
  type AuditEventInput,
} from './log';

type FakePrisma = {
  auditEvent: {
    create: ReturnType<typeof vi.fn>;
  };
};

function makePrisma(
  createImpl: (args: unknown) => Promise<{ id: string }> = async () => ({
    id: 'audit_1',
  }),
): FakePrisma {
  return {
    auditEvent: {
      create: vi.fn(createImpl),
    },
  };
}

const happyEvent: AuditEventInput = {
  action: 'import_budget_create',
  entityType: 'BudgetPlan',
  entityId: 'plan_123',
  metadata: {
    companyId: 'co_1',
    companyCode: 'AAC',
    year: 2026,
    parser: 'sopl',
    inserted: 42,
    deleted: 12,
    warnings: 0,
    parentRollupsDropped: 1,
    parentRollupsUnallocated: 0,
    recompute: { ok: 5, unknown: 2, failed: 0, targets: 7 },
  },
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('logAuditEvent', () => {
  it('happy path: persists event + returns inserted id', async () => {
    const prisma = makePrisma();
    const res = await logAuditEvent(prisma as never, {
      organizationId: 'org_1',
      actorUserId: 'user_1',
      event: happyEvent,
      context: { route: '/api/onboarding/import/budget' },
    });
    expect(res).toEqual({ ok: true, id: 'audit_1' });
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    const callArg = prisma.auditEvent.create.mock.calls[0][0];
    expect(callArg.data.organizationId).toBe('org_1');
    expect(callArg.data.actorUserId).toBe('user_1');
    expect(callArg.data.action).toBe('import_budget_create');
    expect(callArg.data.entityType).toBe('BudgetPlan');
    expect(callArg.data.entityId).toBe('plan_123');
    expect(callArg.data.metadata).toEqual(happyEvent.metadata);
    expect(callArg.data.context).toEqual({
      route: '/api/onboarding/import/budget',
    });
  });

  it('null context maps to Prisma.JsonNull (not undefined / not JS null)', async () => {
    const prisma = makePrisma();
    await logAuditEvent(prisma as never, {
      organizationId: 'org_1',
      actorUserId: null,
      event: happyEvent,
      context: null,
    });
    const callArg = prisma.auditEvent.create.mock.calls[0][0];
    expect(callArg.data.context).toBe(Prisma.JsonNull);
  });

  it('omitted context is treated as null', async () => {
    const prisma = makePrisma();
    await logAuditEvent(prisma as never, {
      organizationId: 'org_1',
      actorUserId: null,
      event: happyEvent,
    });
    const callArg = prisma.auditEvent.create.mock.calls[0][0];
    expect(callArg.data.context).toBe(Prisma.JsonNull);
  });

  it('actorUserId=null is allowed (system / CLI events)', async () => {
    const prisma = makePrisma();
    const res = await logAuditEvent(prisma as never, {
      organizationId: 'org_1',
      actorUserId: null,
      event: happyEvent,
    });
    expect(res.ok).toBe(true);
    expect(prisma.auditEvent.create.mock.calls[0][0].data.actorUserId).toBeNull();
  });

  it('rejects empty organizationId without hitting the DB', async () => {
    const prisma = makePrisma();
    const res = await logAuditEvent(prisma as never, {
      organizationId: '',
      actorUserId: 'user_1',
      event: happyEvent,
    });
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/organizationId/i) });
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('never-throws on DB failure: returns { ok: false, error } instead', async () => {
    const prisma = makePrisma(async () => {
      throw new Error('connection refused');
    });
    let didThrow = false;
    let result: Awaited<ReturnType<typeof logAuditEvent>> | undefined;
    try {
      result = await logAuditEvent(prisma as never, {
        organizationId: 'org_1',
        actorUserId: 'user_1',
        event: happyEvent,
      });
    } catch {
      didThrow = true;
    }
    expect(didThrow).toBe(false);
    expect(result).toEqual({ ok: false, error: 'connection refused' });
    expect(console.error).toHaveBeenCalled();
  });

  it('non-Error throw (string / object) is normalised to a string error', async () => {
    const prisma = makePrisma(async () => {
      throw 'string-throw';
    });
    const res = await logAuditEvent(prisma as never, {
      organizationId: 'org_1',
      actorUserId: 'user_1',
      event: happyEvent,
    });
    expect(res).toEqual({ ok: false, error: 'string-throw' });
  });

  it('discriminated union: company_role_change variant carries from/to enum members', async () => {
    const prisma = makePrisma();
    await logAuditEvent(prisma as never, {
      organizationId: 'org_1',
      actorUserId: 'user_1',
      event: {
        action: 'company_role_change',
        entityType: 'Company',
        entityId: 'co_1',
        metadata: { from: 'operational', to: 'admin', companyCode: 'ATL-MRKZ' },
      },
    });
    const data = prisma.auditEvent.create.mock.calls[0][0].data;
    expect(data.action).toBe('company_role_change');
    expect(data.metadata).toEqual({
      from: 'operational',
      to: 'admin',
      companyCode: 'ATL-MRKZ',
    });
  });

  it('discriminated union: import_staging_expired carries triggeredBy origin', async () => {
    const prisma = makePrisma();
    await logAuditEvent(prisma as never, {
      organizationId: 'org_1',
      actorUserId: null,
      event: {
        action: 'import_staging_expired',
        entityType: 'ImportStaging',
        entityId: 'st_1',
        metadata: {
          companyId: 'co_1',
          expiresAt: '2026-04-26T00:00:00.000Z',
          triggeredBy: 'lazy_get',
        },
      },
    });
    const data = prisma.auditEvent.create.mock.calls[0][0].data;
    expect(data.metadata.triggeredBy).toBe('lazy_get');
  });
});

describe('buildAuditContext', () => {
  it('returns null for an empty bag', () => {
    expect(buildAuditContext({})).toBeNull();
  });

  it('keeps only the populated fields', () => {
    expect(buildAuditContext({ route: '/api/foo' })).toEqual({
      route: '/api/foo',
    });
  });

  it('truncates user-agent to 60 chars', () => {
    const long = 'A'.repeat(200);
    const ctx = buildAuditContext({ userAgent: long });
    expect(ctx?.userAgent).toHaveLength(60);
  });

  it('preserves all three fields when supplied', () => {
    expect(
      buildAuditContext({
        route: '/api/x',
        ipHashPrefix: 'abc12',
        userAgent: 'Mozilla/5.0',
      }),
    ).toEqual({
      route: '/api/x',
      ipHashPrefix: 'abc12',
      userAgent: 'Mozilla/5.0',
    });
  });
});
