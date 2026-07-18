/**
 * User layout preference RLS negative controls (LIVE DB).
 *
 * Opt in only on a disposable database with real-shaped app/admin roles:
 *   RLS_INTEGRATION=1 npx vitest run \
 *     src/lib/db/user-layout-preference-rls.rls.integration.test.ts
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

const ORG_A = 'zzlayoutorgaaaa00000001';
const ORG_B = 'zzlayoutorgbbbb00000002';
const ORG_C = 'zzlayoutorgcccc00000003';
const USER_A = 'zzlayoutuseraaa00000001';
const USER_A2 = 'zzlayoutuseraaa00000002';
const USER_B = 'zzlayoutuserbbb00000002';
const USER_C = 'zzlayoutuserccc00000003';
const USER_D = 'zzlayoutuserddd00000004';
const LAYOUT_A = 'zzlayoutrowaaaa00000001';
const LAYOUT_A2 = 'zzlayoutrowaaaa00000002';
const LAYOUT_B = 'zzlayoutrowbbbb00000002';
const LAYOUT_C = 'zzlayoutrowcccc00000003';

function layoutData(
  id: string,
  organizationId: string,
  userId: string,
  name: string,
) {
  return {
    id,
    organizationId,
    userId,
    name,
    sizes: { version: 1, test: true },
  };
}

d('user layout preference RLS guards (live DB)', () => {
  beforeAll(async () => {
    if (!app || !APP_URL) {
      throw new Error(
        'DATABASE_URL_APP is required; layout RLS tests must use budgetpro_app',
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
        { id: ORG_A, name: 'zz layout A', slug: 'zz-layout-a' },
        { id: ORG_B, name: 'zz layout B', slug: 'zz-layout-b' },
        { id: ORG_C, name: 'zz layout C', slug: 'zz-layout-c' },
      ],
    });
    await admin.user.createMany({
      data: [
        {
          id: USER_A,
          organizationId: ORG_A,
          email: 'zz-layout-a@example.test',
          name: 'zz layout A',
          passwordHash: 'zz-not-a-real-hash',
        },
        {
          id: USER_A2,
          organizationId: ORG_A,
          email: 'zz-layout-a2@example.test',
          name: 'zz layout A2',
          passwordHash: 'zz-not-a-real-hash',
        },
        {
          id: USER_B,
          organizationId: ORG_B,
          email: 'zz-layout-b@example.test',
          name: 'zz layout B',
          passwordHash: 'zz-not-a-real-hash',
        },
        {
          id: USER_C,
          organizationId: ORG_C,
          email: 'zz-layout-c@example.test',
          name: 'zz layout C',
          passwordHash: 'zz-not-a-real-hash',
        },
        {
          id: USER_D,
          organizationId: ORG_A,
          email: 'zz-layout-d@example.test',
          name: 'zz layout D',
          passwordHash: 'zz-not-a-real-hash',
        },
      ],
    });
    await admin.userLayoutPreference.createMany({
      data: [
        layoutData(LAYOUT_A, ORG_A, USER_A, 'layout-a'),
        layoutData(LAYOUT_A2, ORG_A, USER_A2, 'layout-a-second-user'),
        layoutData(LAYOUT_B, ORG_B, USER_B, 'layout-b'),
        layoutData(LAYOUT_C, ORG_C, USER_C, 'layout-c'),
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

  it('has exact tenant CRUD policies and both fixed-path ownership guards', async () => {
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
       WHERE schemaname = 'public' AND tablename = 'user_layout_preferences'
       ORDER BY policyname`,
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
        `${row.qual ?? ''} ${row.with_check ?? ''}`.includes('app.bypass_rls'),
      ),
    ).toBe(false);

    const guards = await admin.$queryRawUnsafe<
      Array<{
        trigger_name: string;
        trigger_enabled: string;
        security_definer: boolean;
        config: string[] | null;
      }>
    >(
      `SELECT trigger.tgname AS trigger_name,
              trigger.tgenabled AS trigger_enabled,
              procedure.prosecdef AS security_definer,
              procedure.proconfig AS config
       FROM pg_trigger AS trigger
       JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
       WHERE trigger.tgname IN (
         'user_layout_preference_write_guard_trg',
         'user_layout_user_reassignment_guard_trg'
       )
         AND NOT trigger.tgisinternal
       ORDER BY trigger.tgname`,
    );
    expect(guards).toEqual([
      {
        trigger_name: 'user_layout_preference_write_guard_trg',
        trigger_enabled: 'O',
        security_definer: true,
        config: ['search_path=pg_catalog, public'],
      },
      {
        trigger_name: 'user_layout_user_reassignment_guard_trg',
        trigger_enabled: 'O',
        security_definer: true,
        config: ['search_path=pg_catalog, public'],
      },
    ]);

    const [execute] = await app!.$queryRawUnsafe<
      Array<{ layout_guard: boolean; user_guard: boolean }>
    >(
      `SELECT
         has_function_privilege(
           current_user,
           'public.guard_user_layout_preference_write()',
           'EXECUTE'
         ) AS layout_guard,
         has_function_privilege(
           current_user,
           'public.guard_user_layout_user_reassignment()',
           'EXECUTE'
         ) AS user_guard`,
    );
    expect(execute).toEqual({ layout_guard: false, user_guard: false });
  });

  it('retains request-role CRUD privileges', async () => {
    const [grants] = await app!.$queryRawUnsafe<
      Array<{
        can_select: boolean;
        can_insert: boolean;
        can_update: boolean;
        can_delete: boolean;
      }>
    >(
      `SELECT
         has_table_privilege(current_user, 'public.user_layout_preferences', 'SELECT') AS can_select,
         has_table_privilege(current_user, 'public.user_layout_preferences', 'INSERT') AS can_insert,
         has_table_privilege(current_user, 'public.user_layout_preferences', 'UPDATE') AS can_update,
         has_table_privilege(current_user, 'public.user_layout_preferences', 'DELETE') AS can_delete`,
    );
    expect(grants).toEqual({
      can_select: true,
      can_insert: true,
      can_update: true,
      can_delete: true,
    });
  });

  it('shows only own tenant, denies absent scope, and ignores app.bypass_rls', async () => {
    const own = await withOrgScope(
      ORG_A,
      (tx) => tx.userLayoutPreference.findMany(),
      scopeOpts,
    );
    expect(own).toHaveLength(2);
    expect(own.every((row) => row.organizationId === ORG_A)).toBe(true);
    expect(own.map((row) => row.userId).sort()).toEqual(
      [USER_A, USER_A2].sort(),
    );
    await expect(app!.userLayoutPreference.findMany()).resolves.toEqual([]);

    const bypassAttempt = await app!.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL "app.organization_id" = '${ORG_A}'`);
      await tx.$executeRawUnsafe(`SET LOCAL "app.bypass_rls" = 'true'`);
      return tx.userLayoutPreference.findMany();
    });
    expect(bypassAttempt).toHaveLength(2);
    expect(bypassAttempt.every((row) => row.organizationId === ORG_A)).toBe(
      true,
    );
    await expect(app!.userLayoutPreference.findMany()).resolves.toEqual([]);
  });

  it('allows tenant CRUD and rejects cross-tenant rows', async () => {
    const ownId = 'zzlayoutrowaaaa00000003';
    const created = await withOrgScope(
      ORG_A,
      (tx) =>
        tx.userLayoutPreference.create({
          data: layoutData(ownId, ORG_A, USER_A, 'layout-a-2'),
        }),
      scopeOpts,
    );
    expect(created.organizationId).toBe(ORG_A);

    const updated = await withOrgScope(
      ORG_A,
      (tx) =>
        tx.userLayoutPreference.update({
          where: { id: ownId },
          data: { sizes: { version: 2, test: true } },
        }),
      scopeOpts,
    );
    expect(updated.sizes).toEqual({ version: 2, test: true });

    await expect(
      withOrgScope(
        ORG_A,
        (tx) =>
          tx.userLayoutPreference.create({
            data: layoutData(
              'zzlayoutrowbbbb00000003',
              ORG_B,
              USER_B,
              'cross-tenant',
            ),
          }),
        scopeOpts,
      ),
    ).rejects.toThrow();

    const removed = await withOrgScope(
      ORG_A,
      (tx) => tx.userLayoutPreference.delete({ where: { id: ownId } }),
      scopeOpts,
    );
    expect(removed.id).toBe(ownId);
  });

  it('rejects foreign users even when the row organization passes RLS', async () => {
    await expect(
      withOrgScope(
        ORG_A,
        (tx) =>
          tx.userLayoutPreference.create({
            data: layoutData(
              'zzlayoutrowcross0000001',
              ORG_A,
              USER_B,
              'foreign-user',
            ),
          }),
        scopeOpts,
      ),
    ).rejects.toThrow();

    await expect(
      withOrgScope(
        ORG_A,
        (tx) =>
          tx.userLayoutPreference.update({
            where: { id: LAYOUT_A },
            data: { userId: USER_B },
          }),
        scopeOpts,
      ),
    ).rejects.toThrow();
  });

  it('keeps native-admin CRUD but rejects cross-org ownership and user moves', async () => {
    const adminId = 'zzlayoutrowadmin00000001';
    await expect(
      admin.userLayoutPreference.create({
        data: layoutData(adminId, ORG_A, USER_B, 'admin-cross-org'),
      }),
    ).rejects.toThrow();

    await expect(
      admin.user.update({
        where: { id: USER_A },
        data: { organizationId: ORG_B },
      }),
    ).rejects.toThrow(/saved layouts cannot be moved/i);

    const changed = await admin.userLayoutPreference.update({
      where: { id: LAYOUT_A },
      data: { sizes: { version: 3, admin: true } },
    });
    expect(changed.sizes).toEqual({ version: 3, admin: true });
  });

  it('serializes a layout insert against a concurrent user organization move', async () => {
    const layoutId = 'zzlayoutrowrace00000001';
    let releaseInsert = () => {};
    let markInserted = () => {};
    const holdInsert = new Promise<void>((resolve) => {
      releaseInsert = resolve;
    });
    const inserted = new Promise<void>((resolve) => {
      markInserted = resolve;
    });

    const insertTransaction = admin.$transaction(async (tx) => {
      await tx.userLayoutPreference.create({
        data: layoutData(layoutId, ORG_A, USER_D, 'race-layout'),
      });
      markInserted();
      await holdInsert;
    });
    await inserted;

    let updateSettled = false;
    const updateAttempt = adminPeer.user
      .update({
        where: { id: USER_D },
        data: { organizationId: ORG_B },
      })
      .then(
        () => ({ ok: true as const, error: null }),
        (error: unknown) => ({ ok: false as const, error }),
      )
      .finally(() => {
        updateSettled = true;
      });

    await new Promise((resolve) => setTimeout(resolve, 100));
    const settledBeforeInsertCommit = updateSettled;
    releaseInsert();
    await insertTransaction;
    const result = await updateAttempt;

    expect(settledBeforeInsertCommit).toBe(false);
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/saved layouts cannot be moved/i);
    await expect(
      admin.user.findUnique({ where: { id: USER_D } }),
    ).resolves.toMatchObject({ organizationId: ORG_A });
  });

  it('preserves user cascade deletion', async () => {
    await admin.user.delete({ where: { id: USER_C } });
    await expect(
      admin.userLayoutPreference.findUnique({ where: { id: LAYOUT_C } }),
    ).resolves.toBeNull();
  });
});
