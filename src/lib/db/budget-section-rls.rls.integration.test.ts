/**
 * Budget section RLS and plan-reference guards (LIVE DB).
 *
 * Opt in only on a disposable database with real-shaped app/admin roles:
 *   RLS_INTEGRATION=1 npx vitest run \
 *     src/lib/db/budget-section-rls.rls.integration.test.ts
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

const ORG_A = 'zzsectionguardorgaaaa01';
const ORG_B = 'zzsectionguardorgbbbb02';
const ORG_C = 'zzsectionguardorgcccc03';
const PLAN_A = 'zzsectionguardplanaaa01';
const PLAN_A2 = 'zzsectionguardplanaaa02';
const PLAN_B = 'zzsectionguardplanbbb02';
const PLAN_C = 'zzsectionguardplanccc03';
const SECTION_A = 'zzsectionguardrowaaaa01';
const SECTION_B = 'zzsectionguardrowbbbb02';
const SECTION_C = 'zzsectionguardrowcccc03';

function sectionData(
  id: string,
  organizationId: string,
  planId: string,
  name: string,
) {
  return {
    id,
    organizationId,
    planId,
    name,
    sectionType: 'expense',
  };
}

d('budget section RLS guards (live DB)', () => {
  beforeAll(async () => {
    if (!app || !APP_URL) {
      throw new Error(
        'DATABASE_URL_APP is required; section RLS tests must use budgetpro_app',
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

    const [adminRole] = await admin.$queryRawUnsafe<
      Array<{ role: string; rolsuper: boolean; rolbypassrls: boolean }>
    >(
      'SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(adminRole).toEqual({
      role: 'budgetpro_admin',
      rolsuper: false,
      rolbypassrls: true,
    });

    await admin.organization.deleteMany({
      where: { id: { in: [ORG_A, ORG_B, ORG_C] } },
    });
    await admin.organization.createMany({
      data: [
        { id: ORG_A, name: 'zz section guard A', slug: 'zz-section-guard-a' },
        { id: ORG_B, name: 'zz section guard B', slug: 'zz-section-guard-b' },
        { id: ORG_C, name: 'zz section guard C', slug: 'zz-section-guard-c' },
      ],
    });
    await admin.budgetPlan.createMany({
      data: [
        {
          id: PLAN_A,
          organizationId: ORG_A,
          name: 'ZZ plan A',
          year: 2099,
        },
        {
          id: PLAN_A2,
          organizationId: ORG_A,
          name: 'ZZ plan A2',
          year: 2099,
        },
        {
          id: PLAN_B,
          organizationId: ORG_B,
          name: 'ZZ plan B',
          year: 2099,
        },
        {
          id: PLAN_C,
          organizationId: ORG_C,
          name: 'ZZ plan C',
          year: 2099,
        },
      ],
    });
    await admin.budgetSection.createMany({
      data: [
        sectionData(SECTION_A, ORG_A, PLAN_A, 'ZZ section A'),
        sectionData(SECTION_B, ORG_B, PLAN_B, 'ZZ section B'),
        sectionData(SECTION_C, ORG_C, PLAN_C, 'ZZ section C'),
      ],
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

  it('has exact CRUD policies, both FKs/guards, and request CRUD grants', async () => {
    const policies = await admin.$queryRawUnsafe<
      Array<{
        policyname: string;
        cmd: string;
        qual: string | null;
        with_check: string | null;
      }>
    >(
      "SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'budget_sections' ORDER BY policyname",
    );
    expect(policies).toHaveLength(4);
    expect(policies.map((row) => row.cmd).sort()).toEqual([
      'DELETE',
      'INSERT',
      'SELECT',
      'UPDATE',
    ]);
    expect(
      policies.some((row) =>
        (String(row.qual ?? '') + String(row.with_check ?? '')).includes(
          'app.bypass_rls',
        ),
      ),
    ).toBe(false);

    const foreignKeys = await admin.$queryRawUnsafe<
      Array<{
        constraint_name: string;
        parent_table: string;
        update_action: string;
        delete_action: string;
        validated: boolean;
      }>
    >(
      "SELECT conname AS constraint_name, confrelid::regclass::text AS parent_table, confupdtype::text AS update_action, confdeltype::text AS delete_action, convalidated AS validated FROM pg_constraint WHERE conrelid = 'public.budget_sections'::regclass AND conname IN ('budget_sections_organizationId_fkey', 'budget_sections_planId_fkey') ORDER BY conname",
    );
    expect(foreignKeys).toEqual([
      {
        constraint_name: 'budget_sections_organizationId_fkey',
        parent_table: '"Organization"',
        update_action: 'c',
        delete_action: 'c',
        validated: true,
      },
      {
        constraint_name: 'budget_sections_planId_fkey',
        parent_table: 'budget_plans',
        update_action: 'c',
        delete_action: 'c',
        validated: true,
      },
    ]);

    const guards = await admin.$queryRawUnsafe<
      Array<{
        trigger_name: string;
        enabled: string;
        security_definer: boolean;
        config: string[] | null;
      }>
    >(
      "SELECT trigger.tgname AS trigger_name, trigger.tgenabled AS enabled, procedure.prosecdef AS security_definer, procedure.proconfig AS config FROM pg_trigger AS trigger JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid WHERE trigger.tgname IN ('budget_section_plan_write_guard_trg', 'budget_section_plan_reassignment_guard_trg') AND NOT trigger.tgisinternal ORDER BY trigger.tgname",
    );
    expect(guards).toHaveLength(2);
    expect(
      guards.every(
        (guard) =>
          guard.enabled === 'O' &&
          guard.security_definer &&
          guard.config?.[0] === 'search_path=pg_catalog, public',
      ),
    ).toBe(true);

    const [execute] = await app!.$queryRawUnsafe<
      Array<{ write_guard: boolean; reassignment_guard: boolean }>
    >(
      "SELECT has_function_privilege(current_user, 'public.guard_budget_section_plan_write()', 'EXECUTE') AS write_guard, has_function_privilege(current_user, 'public.guard_budget_section_plan_reassignment()', 'EXECUTE') AS reassignment_guard",
    );
    expect(execute).toEqual({
      write_guard: false,
      reassignment_guard: false,
    });

    const [grants] = await app!.$queryRawUnsafe<
      Array<{
        can_select: boolean;
        can_insert: boolean;
        can_update: boolean;
        can_delete: boolean;
      }>
    >(
      "SELECT has_table_privilege(current_user, 'public.budget_sections', 'SELECT') AS can_select, has_table_privilege(current_user, 'public.budget_sections', 'INSERT') AS can_insert, has_table_privilege(current_user, 'public.budget_sections', 'UPDATE') AS can_update, has_table_privilege(current_user, 'public.budget_sections', 'DELETE') AS can_delete",
    );
    expect(grants).toEqual({
      can_select: true,
      can_insert: true,
      can_update: true,
      can_delete: true,
    });
  });

  it('isolates reads, denies absent scope, and ignores app.bypass_rls', async () => {
    const own = await withOrgScope(
      ORG_A,
      (tx) => tx.budgetSection.findMany(),
      scopeOpts,
    );
    expect(own.map((row) => row.id)).toEqual([SECTION_A]);
    await expect(app!.budgetSection.findMany()).resolves.toEqual([]);

    const bypassAttempt = await app!.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SET LOCAL "app.organization_id" = ' + "'" + ORG_A + "'",
      );
      await tx.$executeRawUnsafe('SET LOCAL "app.bypass_rls" = ' + "'true'");
      return tx.budgetSection.findMany();
    });
    expect(bypassAttempt).toHaveLength(1);
    expect(bypassAttempt[0].organizationId).toBe(ORG_A);
    await expect(app!.budgetSection.findMany()).resolves.toEqual([]);
  });

  it('allows in-tenant create, update, and physical delete', async () => {
    const id = 'zzsectionguardrowcrud04';
    const created = await withOrgScope(
      ORG_A,
      (tx) =>
        tx.budgetSection.create({
          data: sectionData(id, ORG_A, PLAN_A, 'ZZ CRUD'),
        }),
      scopeOpts,
    );
    expect(created.organizationId).toBe(ORG_A);

    const updated = await withOrgScope(
      ORG_A,
      (tx) =>
        tx.budgetSection.update({
          where: { id },
          data: { name: 'ZZ CRUD updated', sortOrder: 4 },
        }),
      scopeOpts,
    );
    expect(updated).toMatchObject({
      name: 'ZZ CRUD updated',
      sortOrder: 4,
    });

    const removed = await withOrgScope(
      ORG_A,
      (tx) => tx.budgetSection.delete({ where: { id } }),
      scopeOpts,
    );
    expect(removed.id).toBe(id);
  });

  it('rejects cross-tenant rows and foreign-plan references for app and admin', async () => {
    await expect(
      withOrgScope(
        ORG_A,
        (tx) =>
          tx.budgetSection.create({
            data: sectionData(
              'zzsectionguardcross01',
              ORG_B,
              PLAN_B,
              'ZZ cross tenant',
            ),
          }),
        scopeOpts,
      ),
    ).rejects.toThrow();

    await expect(
      admin.budgetSection.create({
        data: sectionData(
          'zzsectionguardcross02',
          ORG_A,
          PLAN_B,
          'ZZ foreign plan',
        ),
      }),
    ).rejects.toThrow();

    await expect(
      admin.budgetSection.update({
        where: { id: SECTION_A },
        data: { planId: PLAN_B },
      }),
    ).rejects.toThrow();

    await expect(
      admin.budgetSection.update({
        where: { id: SECTION_A },
        data: { organizationId: ORG_B },
      }),
    ).rejects.toThrow();
  });

  it('blocks referenced plan moves and permits an unreferenced native-admin move', async () => {
    await expect(
      admin.budgetPlan.update({
        where: { id: PLAN_A },
        data: { organizationId: ORG_B },
      }),
    ).rejects.toThrow(/cannot move across organizations/i);

    const moved = await admin.budgetPlan.update({
      where: { id: PLAN_A2 },
      data: { organizationId: ORG_B },
    });
    expect(moved.organizationId).toBe(ORG_B);
    await admin.budgetPlan.update({
      where: { id: PLAN_A2 },
      data: { organizationId: ORG_A },
    });

    await expect(
      admin.organization.update({
        where: { id: ORG_A },
        data: { id: 'zzsectionguardorgrenamed' },
      }),
    ).rejects.toThrow();
  });

  it('serializes both plan-move and section-insert race directions', async () => {
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
        "SELECT pg_advisory_xact_lock(hashtextextended('" + PLAN_A2 + "', 2))",
      );
      reportMoveLock();
      await moveGate;
      return tx.budgetPlan.update({
        where: { id: PLAN_A2 },
        data: { organizationId: ORG_B },
      });
    });
    await moveLocked;
    const insertAfterMove = adminPeer.budgetSection.create({
      data: sectionData(
        'zzsectionguardracelose1',
        ORG_A,
        PLAN_A2,
        'ZZ losing insert',
      ),
    });
    void insertAfterMove.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseMove();
    await expect(moveFirst).resolves.toMatchObject({ organizationId: ORG_B });
    await expect(insertAfterMove).rejects.toThrow();

    await admin.budgetPlan.update({
      where: { id: PLAN_A2 },
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
        "SELECT pg_advisory_xact_lock(hashtextextended('" + PLAN_A2 + "', 2))",
      );
      const row = await tx.budgetSection.create({
        data: sectionData(
          'zzsectionguardracewin02',
          ORG_A,
          PLAN_A2,
          'ZZ winning insert',
        ),
      });
      reportInsert();
      await insertGate;
      return row;
    });
    await insertReady;
    const moveAfterInsert = adminPeer.budgetPlan.update({
      where: { id: PLAN_A2 },
      data: { organizationId: ORG_B },
    });
    void moveAfterInsert.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseInsert();
    await expect(insertFirst).resolves.toMatchObject({ planId: PLAN_A2 });
    await expect(moveAfterInsert).rejects.toThrow(
      /cannot move across organizations/i,
    );
    await admin.budgetSection.delete({
      where: { id: 'zzsectionguardracewin02' },
    });
  }, 10_000);

  it('preserves native-admin plan and Organization cascade deletion', async () => {
    await admin.budgetPlan.delete({ where: { id: PLAN_C } });
    await expect(
      admin.budgetSection.findUnique({ where: { id: SECTION_C } }),
    ).resolves.toBeNull();

    await admin.organization.delete({ where: { id: ORG_B } });
    await expect(
      admin.budgetPlan.findUnique({ where: { id: PLAN_B } }),
    ).resolves.toBeNull();
    await expect(
      admin.budgetSection.findUnique({ where: { id: SECTION_B } }),
    ).resolves.toBeNull();
  });
});
