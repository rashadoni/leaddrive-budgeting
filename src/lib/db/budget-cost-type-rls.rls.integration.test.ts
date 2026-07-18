/**
 * Budget cost type RLS and same-organization guards (LIVE DB).
 *
 * Opt in only on a disposable database with real-shaped app/admin roles.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { withOrgScope } from './with-org-scope';

const RUN = process.env.RLS_INTEGRATION === '1';
const d = RUN ? describe : describe.skip;
const APP_URL = process.env.DATABASE_URL_APP;
const admin = new PrismaClient();
const adminPeer = new PrismaClient();
const app = APP_URL
  ? new PrismaClient({ datasources: { db: { url: APP_URL } } })
  : null;
const scopeOpts = { client: app as unknown as PrismaClient };

const ORG_A = 'zzcosttypeorgaaaa000001';
const ORG_B = 'zzcosttypeorgbbbb000002';
const ORG_C = 'zzcosttypeorgcccc000003';
const COST_A = 'zzcosttyperowaaaa00001';
const COST_A2 = 'zzcosttyperowaaaa00002';
const COST_B = 'zzcosttyperowbbbb00001';
const PLAN_A = 'zzcosttypeplana0000001';
const ACCOUNT_A = 'zzcosttypeaccounta00001';
const LINE_A = 'zzcosttypelineaaaa00001';
const ACTUAL_A = 'zzcosttypeactualaa00001';
const ENTRY_A = 'zzcosttypeentryaaa00001';
const TEMPLATE_A = 'zzcosttypetemplatea0001';
const EXPENSE_A = 'zzcosttypeexpenseaa0001';

d('budget cost type RLS guards (live DB)', () => {
  beforeAll(async () => {
    if (!app || !APP_URL) {
      throw new Error(
        'DATABASE_URL_APP is required; cost-type RLS tests must use budgetpro_app',
      );
    }

    const [appRole] = await app.$queryRawUnsafe<
      Array<{ role: string; rolsuper: boolean; rolbypassrls: boolean }>
    >(
      'SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(appRole).toEqual({
      role: 'budgetpro_app',
      rolsuper: false,
      rolbypassrls: false,
    });

    const adminRole = await admin.$queryRawUnsafe<
      Array<{ role: string; rolsuper: boolean; rolbypassrls: boolean }>
    >(
      'SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(adminRole).toEqual([
      { role: 'budgetpro_admin', rolsuper: false, rolbypassrls: true },
    ]);

    await admin.organization.deleteMany({
      where: { id: { in: [ORG_A, ORG_B, ORG_C] } },
    });
    await admin.organization.createMany({
      data: [
        { id: ORG_A, name: 'zz cost type A', slug: 'zz-cost-type-a' },
        { id: ORG_B, name: 'zz cost type B', slug: 'zz-cost-type-b' },
        { id: ORG_C, name: 'zz cost type C', slug: 'zz-cost-type-c' },
      ],
    });
    await admin.budgetCostType.createMany({
      data: [
        { id: COST_A, organizationId: ORG_A, key: 'zz-a', label: 'ZZ A' },
        { id: COST_A2, organizationId: ORG_A, key: 'zz-a2', label: 'ZZ A2' },
        { id: COST_B, organizationId: ORG_B, key: 'zz-b', label: 'ZZ B' },
      ],
    });
    await admin.budgetPlan.create({
      data: { id: PLAN_A, organizationId: ORG_A, name: 'ZZ plan A', year: 2099 },
    });
    await admin.chartOfAccount.create({
      data: {
        id: ACCOUNT_A,
        organizationId: ORG_A,
        code: 'ZZ-CT-001',
        name: 'ZZ cost-type account',
        accountType: 'expense',
      },
    });
    await admin.budgetLine.create({
      data: {
        id: LINE_A,
        organizationId: ORG_A,
        planId: PLAN_A,
        accountId: ACCOUNT_A,
        costTypeId: COST_A,
      },
    });
    await admin.budgetActual.create({
      data: {
        id: ACTUAL_A,
        organizationId: ORG_A,
        planId: PLAN_A,
        category: 'ZZ actual',
        costTypeId: COST_A,
      },
    });
    await admin.budgetForecastEntry.create({
      data: {
        id: ENTRY_A,
        organizationId: ORG_A,
        planId: PLAN_A,
        year: 2099,
        month: 1,
        category: 'ZZ forecast',
        costTypeId: COST_A,
      },
    });
    await admin.budgetDirectionTemplate.create({
      data: {
        id: TEMPLATE_A,
        organizationId: ORG_A,
        name: 'ZZ template',
        costTypeId: COST_A,
      },
    });
    await admin.expenseForecast.create({
      data: {
        id: EXPENSE_A,
        organizationId: ORG_A,
        costTypeId: COST_A,
        year: 2099,
        month: 1,
      },
    });
  });

  afterAll(async () => {
    await admin.organization.deleteMany({
      where: { id: { in: [ORG_A, ORG_B, ORG_C] } },
    });
    await app?.$disconnect();
    await adminPeer.$disconnect();
    await admin.$disconnect();
  });

  it('has exact policies, six fixed-path guards, and no app DELETE grant', async () => {
    const policies = await admin.$queryRawUnsafe<
      Array<{
        policyname: string;
        cmd: string;
        qual: string | null;
        with_check: string | null;
      }>
    >(
      `SELECT policyname, cmd, qual, with_check
       FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'budget_cost_types'
       ORDER BY policyname`,
    );
    expect(policies).toHaveLength(3);
    expect(policies.map((row) => row.cmd).sort()).toEqual([
      'INSERT',
      'SELECT',
      'UPDATE',
    ]);
    expect(
      policies.some((row) =>
        `${row.qual ?? ''} ${row.with_check ?? ''}`.includes(
          'app.bypass_rls',
        ),
      ),
    ).toBe(false);

    const guards = await admin.$queryRawUnsafe<
      Array<{ security_definer: boolean; config: string[] | null }>
    >(
      `SELECT procedure.prosecdef AS security_definer,
              procedure.proconfig AS config
       FROM pg_trigger AS trigger
       JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
       WHERE trigger.tgname IN (
         'budget_line_cost_type_guard_trg',
         'budget_actual_cost_type_guard_trg',
         'budget_forecast_entry_cost_type_guard_trg',
         'budget_direction_template_cost_type_guard_trg',
         'expense_forecast_cost_type_guard_trg',
         'budget_cost_type_reassignment_guard_trg'
       )
         AND NOT trigger.tgisinternal`,
    );
    expect(guards).toHaveLength(6);
    expect(
      guards.every(
        (guard) =>
          guard.security_definer &&
          guard.config?.[0] === 'search_path=pg_catalog, public',
      ),
    ).toBe(true);

    const [grants] = await app!.$queryRawUnsafe<
      Array<{
        can_select: boolean;
        can_insert: boolean;
        can_update: boolean;
        can_delete: boolean;
      }>
    >(
      `SELECT
         has_table_privilege(current_user, 'public.budget_cost_types', 'SELECT') AS can_select,
         has_table_privilege(current_user, 'public.budget_cost_types', 'INSERT') AS can_insert,
         has_table_privilege(current_user, 'public.budget_cost_types', 'UPDATE') AS can_update,
         has_table_privilege(current_user, 'public.budget_cost_types', 'DELETE') AS can_delete`,
    );
    expect(grants).toEqual({
      can_select: true,
      can_insert: true,
      can_update: true,
      can_delete: false,
    });
  });

  it('isolates reads, ignores app.bypass_rls, and allows tenant soft-delete', async () => {
    const own = await withOrgScope(
      ORG_A,
      (tx) => tx.budgetCostType.findMany(),
      scopeOpts,
    );
    expect(own.map((row) => row.id).sort()).toEqual([COST_A, COST_A2].sort());
    await expect(app!.budgetCostType.findMany()).resolves.toEqual([]);

    const bypassAttempt = await app!.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL "app.organization_id" = '${ORG_A}'`);
      await tx.$executeRawUnsafe(`SET LOCAL "app.bypass_rls" = 'true'`);
      return tx.budgetCostType.findMany();
    });
    expect(bypassAttempt).toHaveLength(2);
    expect(bypassAttempt.every((row) => row.organizationId === ORG_A)).toBe(
      true,
    );

    const changed = await withOrgScope(
      ORG_A,
      (tx) =>
        tx.budgetCostType.update({
          where: { id: COST_A2 },
          data: { isActive: false },
        }),
      scopeOpts,
    );
    expect(changed.isActive).toBe(false);
    await expect(
      withOrgScope(
        ORG_A,
        (tx) => tx.budgetCostType.delete({ where: { id: COST_A2 } }),
        scopeOpts,
      ),
    ).rejects.toThrow();
  });

  it('rejects cross-tenant catalog rows and all five cross-org references', async () => {
    await expect(
      withOrgScope(
        ORG_A,
        (tx) =>
          tx.budgetCostType.create({
            data: { organizationId: ORG_B, key: 'zz-cross', label: 'ZZ cross' },
          }),
        scopeOpts,
      ),
    ).rejects.toThrow();

    const attempts = [
      admin.budgetLine.update({
        where: { id: LINE_A },
        data: { costTypeId: COST_B },
      }),
      admin.budgetActual.update({
        where: { id: ACTUAL_A },
        data: { costTypeId: COST_B },
      }),
      admin.budgetForecastEntry.update({
        where: { id: ENTRY_A },
        data: { costTypeId: COST_B },
      }),
      admin.budgetDirectionTemplate.update({
        where: { id: TEMPLATE_A },
        data: { costTypeId: COST_B },
      }),
      admin.expenseForecast.update({
        where: { id: EXPENSE_A },
        data: { costTypeId: COST_B },
      }),
    ];
    for (const attempt of attempts) await expect(attempt).rejects.toThrow();
  });

  it('rejects referenced cost-type reassignment', async () => {
    await expect(
      admin.budgetCostType.update({
        where: { id: COST_A },
        data: { organizationId: ORG_C },
      }),
    ).rejects.toThrow(/cannot move across organizations/i);
  });

  it('serializes both consumer-insert and cost-type-move race directions', async () => {
    let releaseMove!: () => void;
    let reportMoveLock!: () => void;
    const moveGate = new Promise<void>((resolve) => {
      releaseMove = resolve;
    });
    const moveLocked = new Promise<void>((resolve) => {
      reportMoveLock = resolve;
    });
    const moveFirst = admin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtextextended('${COST_A2}', 1))`,
      );
      reportMoveLock();
      await moveGate;
      return tx.budgetCostType.update({
        where: { id: COST_A2 },
        data: { organizationId: ORG_B },
      });
    });
    await moveLocked;
    const insertAfterMove = (async () =>
      adminPeer.budgetDirectionTemplate.create({
        data: {
          id: 'zzcosttyperaceinsert001',
          organizationId: ORG_A,
          name: 'ZZ losing insert',
          costTypeId: COST_A2,
        },
      }))();
    void insertAfterMove.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseMove();
    await expect(moveFirst).resolves.toMatchObject({ organizationId: ORG_B });
    await expect(insertAfterMove).rejects.toThrow();

    await admin.budgetCostType.update({
      where: { id: COST_A2 },
      data: { organizationId: ORG_A },
    });

    let releaseInsert!: () => void;
    let reportInsert!: () => void;
    const insertGate = new Promise<void>((resolve) => {
      releaseInsert = resolve;
    });
    const insertReady = new Promise<void>((resolve) => {
      reportInsert = resolve;
    });
    const insertFirst = admin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtextextended('${COST_A2}', 1))`,
      );
      const row = await tx.budgetDirectionTemplate.create({
        data: {
          id: 'zzcosttyperacepersist01',
          organizationId: ORG_A,
          name: 'ZZ winning insert',
          costTypeId: COST_A2,
        },
      });
      reportInsert();
      await insertGate;
      return row;
    });
    await insertReady;
    const moveAfterInsert = (async () =>
      adminPeer.budgetCostType.update({
        where: { id: COST_A2 },
        data: { organizationId: ORG_B },
      }))();
    void moveAfterInsert.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseInsert();
    await expect(insertFirst).resolves.toMatchObject({ costTypeId: COST_A2 });
    await expect(moveAfterInsert).rejects.toThrow(
      /cannot move across organizations/i,
    );
    await admin.budgetDirectionTemplate.delete({
      where: { id: 'zzcosttyperacepersist01' },
    });
  }, 10_000);

  it('preserves native-admin SET NULL and CASCADE delete semantics', async () => {
    await admin.budgetCostType.delete({ where: { id: COST_A } });

    await expect(
      admin.budgetLine.findUnique({ where: { id: LINE_A } }),
    ).resolves.toMatchObject({ costTypeId: null });
    await expect(
      admin.budgetActual.findUnique({ where: { id: ACTUAL_A } }),
    ).resolves.toMatchObject({ costTypeId: null });
    await expect(
      admin.budgetForecastEntry.findUnique({ where: { id: ENTRY_A } }),
    ).resolves.toMatchObject({ costTypeId: null });
    await expect(
      admin.budgetDirectionTemplate.findUnique({ where: { id: TEMPLATE_A } }),
    ).resolves.toMatchObject({ costTypeId: null });
    await expect(
      admin.expenseForecast.findUnique({ where: { id: EXPENSE_A } }),
    ).resolves.toBeNull();
  });
});
