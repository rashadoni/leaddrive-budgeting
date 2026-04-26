/**
 * Tests for `logImportBudgetCreate` — the shared emission seam used by
 * both the API route and the CLI import script. Covers:
 *  - the discriminated `import_budget_create` event shape gets passed
 *    through to `logAuditEvent` unchanged (no metadata drift between
 *    helper input and audit row);
 *  - `actorUserId: null` (CLI / system path) is preserved, not coerced;
 *  - `context: undefined` round-trips as `null` so the JSON column
 *    stores Prisma's JsonNull sentinel (defensive against future
 *    `if (context)` truthy-checks downstream);
 *  - the never-throws contract is inherited (DB-failure path returns
 *    `{ ok: false, error }` without raising).
 */

import { describe, it, expect, vi } from 'vitest';
import { logImportBudgetCreate } from './import-helpers';

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

const baseArgs = {
  organizationId: 'org_az',
  actorUserId: null as string | null,
  planId: 'plan_2026',
  companyId: 'co_aac',
  companyCode: 'AAC',
  year: 2026,
  parser: 'sopl' as const,
  inserted: 90,
  deleted: 88,
  warnings: 2,
  parentRollupsDropped: 4,
  parentRollupsUnallocated: 0,
  recompute: { ok: 5, unknown: 1, failed: 0, targets: 6 },
};

describe('logImportBudgetCreate', () => {
  it('passes the full metadata shape through to auditEvent.create', async () => {
    const prisma = makePrisma();
    const result = await logImportBudgetCreate(prisma as never, baseArgs);

    expect(result).toEqual({ ok: true, id: 'audit_1' });
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    const call = prisma.auditEvent.create.mock.calls[0][0];
    expect(call.data.action).toBe('import_budget_create');
    expect(call.data.entityType).toBe('BudgetPlan');
    expect(call.data.entityId).toBe('plan_2026');
    expect(call.data.organizationId).toBe('org_az');
    expect(call.data.actorUserId).toBeNull();
    expect(call.data.metadata).toEqual({
      companyId: 'co_aac',
      companyCode: 'AAC',
      year: 2026,
      parser: 'sopl',
      inserted: 90,
      deleted: 88,
      warnings: 2,
      parentRollupsDropped: 4,
      parentRollupsUnallocated: 0,
      recompute: { ok: 5, unknown: 1, failed: 0, targets: 6 },
    });
  });

  it('serialises CLI context route marker', async () => {
    const prisma = makePrisma();
    await logImportBudgetCreate(prisma as never, {
      ...baseArgs,
      context: { route: 'cli:import-azmade-budgets' },
    });
    const call = prisma.auditEvent.create.mock.calls[0][0];
    expect(call.data.context).toEqual({ route: 'cli:import-azmade-budgets' });
  });

  it('omits context → JsonNull sentinel (not undefined)', async () => {
    const prisma = makePrisma();
    await logImportBudgetCreate(prisma as never, baseArgs);
    const call = prisma.auditEvent.create.mock.calls[0][0];
    // Prisma.JsonNull serialises as a sentinel object — not literal null,
    // not undefined. We just assert it's not undefined; the exact identity
    // is covered by `log.test.ts` already.
    expect(call.data.context).not.toBeUndefined();
  });

  it('returns { ok: false } on DB failure rather than throwing', async () => {
    const prisma = makePrisma(async () => {
      throw new Error('connection refused');
    });
    const result = await logImportBudgetCreate(prisma as never, baseArgs);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/connection refused/);
  });

  it('preserves rollup parser variant', async () => {
    const prisma = makePrisma();
    await logImportBudgetCreate(prisma as never, {
      ...baseArgs,
      parser: 'rollup',
    });
    const call = prisma.auditEvent.create.mock.calls[0][0];
    expect(call.data.metadata.parser).toBe('rollup');
  });
});
