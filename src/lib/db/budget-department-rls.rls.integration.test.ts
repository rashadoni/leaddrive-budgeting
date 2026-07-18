/**
 * Budget department RLS and same-organization guards (LIVE DB).
 *
 * Opt in only on a disposable database with real-shaped app/admin roles:
 *   RLS_INTEGRATION=1 npx vitest run \
 *     src/lib/db/budget-department-rls.rls.integration.test.ts
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

const ORG_A = 'zzbudgetdeptorgaaa00001';
const ORG_B = 'zzbudgetdeptorgbbb00002';
const ORG_C = 'zzbudgetdeptorgccc00003';
const USER_A = 'zzbudgetdeptuseraa00001';
const USER_B = 'zzbudgetdeptuserbb00002';
const DEPT_A = 'zzbudgetdeptrowaaa00001';
const DEPT_A2 = 'zzbudgetdeptrowaaa00002';
const DEPT_B = 'zzbudgetdeptrowbbb00001';
const PLAN_A = 'zzbudgetdeptplana000001';
const COST_A = 'zzbudgetdeptcosta000001';
const ACCOUNT_A = 'zzbudgetdeptaccounta0001';
const LINE_A = 'zzbudgetdeptlinea000001';
const ACTUAL_A = 'zzbudgetdeptactuala0001';
const ENTRY_A = 'zzbudgetdeptentrya00001';
const TEMPLATE_A = 'zzbudgetdepttemplatea001';
const SALES_A = 'zzbudgetdeptsalesa00001';
const EXPENSE_A = 'zzbudgetdeptexpensea001';
const OWNER_A = 'zzbudgetdeptownera00001';

d('budget department RLS guards (live DB)', () => {
  beforeAll(async () => {
    if (!app || !APP_URL) {
      throw new Error(
        'DATABASE_URL_APP is required; department RLS tests must use budgetpro_app',
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
        { id: ORG_A, name: 'zz budget department A', slug: 'zz-budget-dept-a' },
        { id: ORG_B, name: 'zz budget department B', slug: 'zz-budget-dept-b' },
        { id: ORG_C, name: 'zz budget department C', slug: 'zz-budget-dept-c' },
      ],
    });
    await admin.user.createMany({
      data: [
        {
          id: USER_A,
          organizationId: ORG_A,
          email: 'zz-budget-dept-a@example.test',
          name: 'zz budget department A',
          passwordHash: 'zz-not-a-real-hash',
        },
        {
          id: USER_B,
          organizationId: ORG_B,
          email: 'zz-budget-dept-b@example.test',
          name: 'zz budget department B',
          passwordHash: 'zz-not-a-real-hash',
        },
      ],
    });
    await admin.budgetDepartment.createMany({
      data: [
        { id: DEPT_A, organizationId: ORG_A, key: 'zz-a', label: 'ZZ A' },
        { id: DEPT_A2, organizationId: ORG_A, key: 'zz-a2', label: 'ZZ A2' },
        { id: DEPT_B, organizationId: ORG_B, key: 'zz-b', label: 'ZZ B' },
      ],
    });
    await admin.budgetPlan.create({
      data: { id: PLAN_A, organizationId: ORG_A, name: 'ZZ plan A', year: 2099 },
    });
    await admin.budgetCostType.create({
      data: { id: COST_A, organizationId: ORG_A, key: 'zz-cost-a', label: 'ZZ cost A' },
    });
    await admin.chartOfAccount.create({
      data: {
        id: ACCOUNT_A,
        organizationId: ORG_A,
        code: 'ZZ-001',
        name: 'ZZ account A',
        accountType: 'expense',
      },
    });
    await admin.budgetLine.create({
      data: {
        id: LINE_A,
        organizationId: ORG_A,
        planId: PLAN_A,
        accountId: ACCOUNT_A,
        departmentId: DEPT_A,
      },
    });
    await admin.budgetActual.create({
      data: {
        id: ACTUAL_A,
        organizationId: ORG_A,
        planId: PLAN_A,
        category: 'ZZ actual',
        departmentId: DEPT_A,
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
        departmentId: DEPT_A,
      },
    });
    await admin.budgetDirectionTemplate.create({
      data: {
        id: TEMPLATE_A,
        organizationId: ORG_A,
        name: 'ZZ template',
        departmentId: DEPT_A,
      },
    });
    await admin.salesForecast.create({
      data: {
        id: SALES_A,
        organizationId: ORG_A,
        departmentId: DEPT_A,
        year: 2099,
        month: 1,
      },
    });
    await admin.expenseForecast.create({
      data: {
        id: EXPENSE_A,
        organizationId: ORG_A,
        costTypeId: COST_A,
        departmentId: DEPT_A,
        year: 2099,
        month: 1,
      },
    });
    await admin.budgetDepartmentOwner.create({
      data: {
        id: OWNER_A,
        organizationId: ORG_A,
        departmentId: DEPT_A,
        userId: USER_A,
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

  it('has exact policies, nine fixed-path guards, and no app DELETE grant', async () => {
    const policies = await admin.$queryRawUnsafe<
      Array<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>
    >(
      `SELECT policyname, cmd, qual, with_check
       FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'budget_departments'
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
        `${row.qual ?? ''} ${row.with_check ?? ''}`.includes('app.bypass_rls'),
      ),
    ).toBe(false);

    const guards = await admin.$queryRawUnsafe<
      Array<{ trigger_name: string; security_definer: boolean; config: string[] | null }>
    >(
      `SELECT trigger.tgname AS trigger_name,
              procedure.prosecdef AS security_definer,
              procedure.proconfig AS config
       FROM pg_trigger AS trigger
       JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
       WHERE trigger.tgname LIKE '%department%guard_trg'
         AND trigger.tgname IN (
           'budget_line_department_guard_trg',
           'budget_actual_department_guard_trg',
           'budget_forecast_entry_department_guard_trg',
           'budget_direction_template_department_guard_trg',
           'sales_forecast_department_guard_trg',
           'expense_forecast_department_guard_trg',
           'budget_department_owner_write_guard_trg',
           'budget_department_reassignment_guard_trg',
           'budget_department_owner_user_reassignment_guard_trg'
         )
         AND NOT trigger.tgisinternal`,
    );
    expect(guards).toHaveLength(9);
    expect(
      guards.every(
        (guard) =>
          guard.security_definer &&
          guard.config?.[0] === 'search_path=pg_catalog, public',
      ),
    ).toBe(true);

    const [grants] = await app!.$queryRawUnsafe<
      Array<{ can_select: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean }>
    >(
      `SELECT
         has_table_privilege(current_user, 'public.budget_departments', 'SELECT') AS can_select,
         has_table_privilege(current_user, 'public.budget_departments', 'INSERT') AS can_insert,
         has_table_privilege(current_user, 'public.budget_departments', 'UPDATE') AS can_update,
         has_table_privilege(current_user, 'public.budget_departments', 'DELETE') AS can_delete`,
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
      (tx) => tx.budgetDepartment.findMany(),
      scopeOpts,
    );
    expect(own.map((row) => row.id).sort()).toEqual([DEPT_A, DEPT_A2].sort());
    await expect(app!.budgetDepartment.findMany()).resolves.toEqual([]);

    const bypassAttempt = await app!.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL "app.organization_id" = '${ORG_A}'`);
      await tx.$executeRawUnsafe(`SET LOCAL "app.bypass_rls" = 'true'`);
      return tx.budgetDepartment.findMany();
    });
    expect(bypassAttempt).toHaveLength(2);
    expect(bypassAttempt.every((row) => row.organizationId === ORG_A)).toBe(true);

    const changed = await withOrgScope(
      ORG_A,
      (tx) =>
        tx.budgetDepartment.update({
          where: { id: DEPT_A2 },
          data: { isActive: false },
        }),
      scopeOpts,
    );
    expect(changed.isActive).toBe(false);

    await expect(
      withOrgScope(
        ORG_A,
        (tx) => tx.budgetDepartment.delete({ where: { id: DEPT_A2 } }),
        scopeOpts,
      ),
    ).rejects.toThrow();
  });

  it('rejects cross-tenant department rows and all seven cross-org references', async () => {
    await expect(
      withOrgScope(
        ORG_A,
        (tx) =>
          tx.budgetDepartment.create({
            data: { organizationId: ORG_B, key: 'zz-cross', label: 'ZZ cross' },
          }),
        scopeOpts,
      ),
    ).rejects.toThrow();

    const attempts = [
      admin.budgetLine.update({ where: { id: LINE_A }, data: { departmentId: DEPT_B } }),
      admin.budgetActual.update({ where: { id: ACTUAL_A }, data: { departmentId: DEPT_B } }),
      admin.budgetForecastEntry.update({ where: { id: ENTRY_A }, data: { departmentId: DEPT_B } }),
      admin.budgetDirectionTemplate.update({ where: { id: TEMPLATE_A }, data: { departmentId: DEPT_B } }),
      admin.salesForecast.update({ where: { id: SALES_A }, data: { departmentId: DEPT_B } }),
      admin.expenseForecast.update({ where: { id: EXPENSE_A }, data: { departmentId: DEPT_B } }),
      admin.budgetDepartmentOwner.update({ where: { id: OWNER_A }, data: { departmentId: DEPT_B } }),
    ];
    for (const attempt of attempts) await expect(attempt).rejects.toThrow();

    await expect(
      admin.budgetDepartmentOwner.update({
        where: { id: OWNER_A },
        data: { userId: USER_B },
      }),
    ).rejects.toThrow();
  });

  it('rejects referenced department and owner-user reassignment', async () => {
    await expect(
      admin.budgetDepartment.update({
        where: { id: DEPT_A },
        data: { organizationId: ORG_C },
      }),
    ).rejects.toThrow(/cannot move across organizations/i);
    await expect(
      admin.user.update({
        where: { id: USER_A },
        data: { organizationId: ORG_C },
      }),
    ).rejects.toThrow(/cannot move across organizations/i);
  });

  it('serializes both consumer-insert and department-move race directions', async () => {
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
        `SELECT pg_advisory_xact_lock(hashtextextended('${DEPT_A2}', 0))`,
      );
      reportMoveLock();
      await moveGate;
      return tx.budgetDepartment.update({
        where: { id: DEPT_A2 },
        data: { organizationId: ORG_B },
      });
    });
    await moveLocked;
    const insertAfterMove = (async () =>
      adminPeer.budgetDirectionTemplate.create({
        data: {
          id: 'zzbudgetdeptraceinsert001',
          organizationId: ORG_A,
          name: 'ZZ losing insert',
          departmentId: DEPT_A2,
        },
      }))();
    void insertAfterMove.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseMove();
    await expect(moveFirst).resolves.toMatchObject({ organizationId: ORG_B });
    await expect(insertAfterMove).rejects.toThrow();

    await admin.budgetDepartment.update({
      where: { id: DEPT_A2 },
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
        `SELECT pg_advisory_xact_lock(hashtextextended('${DEPT_A2}', 0))`,
      );
      const row = await tx.budgetDirectionTemplate.create({
        data: {
          id: 'zzbudgetdeptracepersist01',
          organizationId: ORG_A,
          name: 'ZZ winning insert',
          departmentId: DEPT_A2,
        },
      });
      reportInsert();
      await insertGate;
      return row;
    });
    await insertReady;
    const moveAfterInsert = (async () =>
      adminPeer.budgetDepartment.update({
        where: { id: DEPT_A2 },
        data: { organizationId: ORG_B },
      }))();
    void moveAfterInsert.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseInsert();
    await expect(insertFirst).resolves.toMatchObject({ departmentId: DEPT_A2 });
    await expect(moveAfterInsert).rejects.toThrow(/cannot move across organizations/i);
    await admin.budgetDirectionTemplate.delete({
      where: { id: 'zzbudgetdeptracepersist01' },
    });
  }, 10_000);

  it('preserves native-admin SET NULL and CASCADE delete semantics', async () => {
    await admin.budgetDepartment.delete({ where: { id: DEPT_A } });

    await expect(
      admin.budgetLine.findUnique({ where: { id: LINE_A } }),
    ).resolves.toMatchObject({ departmentId: null });
    await expect(
      admin.budgetActual.findUnique({ where: { id: ACTUAL_A } }),
    ).resolves.toMatchObject({ departmentId: null });
    await expect(
      admin.budgetForecastEntry.findUnique({ where: { id: ENTRY_A } }),
    ).resolves.toMatchObject({ departmentId: null });
    await expect(
      admin.budgetDirectionTemplate.findUnique({ where: { id: TEMPLATE_A } }),
    ).resolves.toMatchObject({ departmentId: null });
    await expect(
      admin.salesForecast.findUnique({ where: { id: SALES_A } }),
    ).resolves.toBeNull();
    await expect(
      admin.expenseForecast.findUnique({ where: { id: EXPENSE_A } }),
    ).resolves.toBeNull();
    await expect(
      admin.budgetDepartmentOwner.findUnique({ where: { id: OWNER_A } }),
    ).resolves.toBeNull();
  });
});
