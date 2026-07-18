/**
 * Global-catalog RLS negative controls (LIVE DB).
 *
 * Opt in only on a disposable database:
 *   RLS_INTEGRATION=1 npx vitest run \
 *     src/lib/db/global-catalog-rls.rls.integration.test.ts
 *
 * The suite creates throwaway orgs/catalog rows and removes them in afterAll.
 * Never point it at a shared or production database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { withOrgScope } from './with-org-scope';

const RUN = process.env.RLS_INTEGRATION === '1';
const d = RUN ? describe : describe.skip;
const APP_URL = process.env.DATABASE_URL_APP;
const admin = new PrismaClient();
const app = APP_URL
  ? new PrismaClient({ datasources: { db: { url: APP_URL } } })
  : null;
const scopeOpts = { client: app as unknown as PrismaClient };

const ORG_A = 'zzcatalogrlsorgaaaa00001';
const ORG_B = 'zzcatalogrlsorgbbbb00002';
const GLOBAL_CODE = 'ZZ_CATALOG_RLS_GLOBAL';
const OWN_A_CODE = 'ZZ_CATALOG_RLS_OWN_A';
const OWN_B_CODE = 'ZZ_CATALOG_RLS_OWN_B';
const INDUSTRY_CODE = 'zz_catalog_rls_industry';

function definitionData(code: string, organizationId: string | null) {
  return {
    organizationId,
    code,
    nameEn: code,
    category: 'test',
    industries: [] as string[],
    unit: '%',
    direction: 'lower_better',
    formula: '0',
    thresholds: {},
    requiredInputs: [] as string[],
  };
}

d('global catalog RLS guards (live DB)', () => {
  beforeAll(async () => {
    if (!app || !APP_URL) {
      throw new Error(
        'DATABASE_URL_APP is required; global-catalog RLS tests are meaningless under an owner/superuser client',
      );
    }

    const [appRole] = await app.$queryRawUnsafe<
      Array<{ role: string; rolsuper: boolean; rolbypassrls: boolean }>
    >(
      'SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(appRole?.role).toBe('budgetpro_app');
    expect(appRole?.rolsuper).toBe(false);
    expect(appRole?.rolbypassrls).toBe(false);

    const adminRole = await admin.$queryRawUnsafe<
      Array<{ rolsuper: boolean; rolbypassrls: boolean }>
    >(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'budgetpro_admin'",
    );
    expect(adminRole).toEqual([{ rolsuper: false, rolbypassrls: true }]);

    await admin.indicatorDefinition.deleteMany({
      where: { code: { startsWith: 'ZZ_CATALOG_RLS_' } },
    });
    await admin.industry.deleteMany({
      where: { code: { startsWith: 'zz_catalog_rls_' } },
    });
    await admin.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });

    await admin.organization.createMany({
      data: [
        { id: ORG_A, name: 'zz catalog RLS A', slug: 'zz-catalog-rls-a' },
        { id: ORG_B, name: 'zz catalog RLS B', slug: 'zz-catalog-rls-b' },
      ],
    });
    await admin.indicatorDefinition.createMany({
      data: [
        definitionData(GLOBAL_CODE, null),
        definitionData(OWN_A_CODE, ORG_A),
        definitionData(OWN_B_CODE, ORG_B),
      ],
    });
    await admin.industry.create({
      data: { code: INDUSTRY_CODE, nameEn: 'zz catalog RLS industry' },
    });
  });

  afterAll(async () => {
    await admin.indicatorDefinition.deleteMany({
      where: { code: { startsWith: 'ZZ_CATALOG_RLS_' } },
    });
    await admin.industry.deleteMany({
      where: { code: { startsWith: 'zz_catalog_rls_' } },
    });
    await admin.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
    await app?.$disconnect();
    await admin.$disconnect();
  });

  it('catalog contains the reviewed policy split and no custom-GUC clause', async () => {
    const rows = await admin.$queryRawUnsafe<
      Array<{ tablename: string; policyname: string; cmd: string; qual: string | null }>
    >(
      `SELECT tablename, policyname, cmd, qual
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename IN ('indicator_definitions', 'industries')
       ORDER BY tablename, policyname`,
    );

    expect(rows.filter((row) => row.tablename === 'indicator_definitions')).toHaveLength(4);
    expect(rows.filter((row) => row.tablename === 'industries')).toEqual([
      expect.objectContaining({ policyname: 'tenant_isolation', cmd: 'SELECT' }),
    ]);
    expect(rows.some((row) => row.qual?.includes('app.bypass_rls'))).toBe(false);
  });

  it('org A reads global + own definitions but not org B', async () => {
    const rows = await withOrgScope(
      ORG_A,
      (tx) =>
        tx.indicatorDefinition.findMany({
          where: { code: { in: [GLOBAL_CODE, OWN_A_CODE, OWN_B_CODE] } },
          select: { code: true, organizationId: true },
          orderBy: { code: 'asc' },
        }),
      scopeOpts,
    );

    expect(rows).toEqual([
      { code: GLOBAL_CODE, organizationId: null },
      { code: OWN_A_CODE, organizationId: ORG_A },
    ]);
  });

  it('SET LOCAL app.bypass_rls=true does not reveal another tenant override', async () => {
    const rows = await app!.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL "app.organization_id" = '${ORG_A}'`,
      );
      await tx.$executeRawUnsafe(`SET LOCAL "app.bypass_rls" = 'true'`);
      return tx.indicatorDefinition.findMany({
        where: { code: { in: [GLOBAL_CODE, OWN_A_CODE, OWN_B_CODE] } },
        select: { code: true },
        orderBy: { code: 'asc' },
      });
    });

    expect(rows).toEqual([{ code: GLOBAL_CODE }, { code: OWN_A_CODE }]);
  });

  it('request role cannot create, update or delete a global definition', async () => {
    await expect(
      withOrgScope(
        ORG_A,
        (tx) =>
          tx.indicatorDefinition.create({
            data: definitionData('ZZ_CATALOG_RLS_GLOBAL_DENIED', null),
          }),
        scopeOpts,
      ),
    ).rejects.toThrow();

    const global = await admin.indicatorDefinition.findFirstOrThrow({
      where: { code: GLOBAL_CODE, organizationId: null },
    });
    await expect(
      withOrgScope(
        ORG_A,
        (tx) =>
          tx.indicatorDefinition.update({
            where: { id: global.id },
            data: { nameEn: 'denied' },
          }),
        scopeOpts,
      ),
    ).rejects.toThrow();

    await expect(
      withOrgScope(
        ORG_A,
        (tx) => tx.indicatorDefinition.delete({ where: { id: global.id } }),
        scopeOpts,
      ),
    ).rejects.toThrow();
  });

  it('request role can CRUD its own tenant override', async () => {
    const code = 'ZZ_CATALOG_RLS_APP_CRUD';
    try {
      const created = await withOrgScope(
        ORG_A,
        (tx) =>
          tx.indicatorDefinition.create({
            data: definitionData(code, ORG_A),
          }),
        scopeOpts,
      );
      expect(created.organizationId).toBe(ORG_A);

      const updated = await withOrgScope(
        ORG_A,
        (tx) =>
          tx.indicatorDefinition.update({
            where: { id: created.id },
            data: { nameEn: 'updated own override' },
          }),
        scopeOpts,
      );
      expect(updated.nameEn).toBe('updated own override');

      await expect(
        withOrgScope(
          ORG_A,
          (tx) =>
            tx.indicatorDefinition.update({
              where: { id: created.id },
              data: { organizationId: ORG_B },
            }),
          scopeOpts,
        ),
      ).rejects.toThrow();

      await withOrgScope(
        ORG_A,
        (tx) => tx.indicatorDefinition.delete({ where: { id: created.id } }),
        scopeOpts,
      );
    } finally {
      await admin.indicatorDefinition.deleteMany({ where: { code } });
    }
  });

  it('industries is readable but has no request-role DML privilege', async () => {
    const privilege = await app!.$queryRawUnsafe<
      Array<{ can_insert: boolean; can_update: boolean; can_delete: boolean }>
    >(
      `SELECT
         has_table_privilege(current_user, 'public.industries', 'INSERT') AS can_insert,
         has_table_privilege(current_user, 'public.industries', 'UPDATE') AS can_update,
         has_table_privilege(current_user, 'public.industries', 'DELETE') AS can_delete`,
    );
    expect(privilege).toEqual([
      { can_insert: false, can_update: false, can_delete: false },
    ]);

    await expect(app!.industry.findUnique({ where: { code: INDUSTRY_CODE } }))
      .resolves.toMatchObject({ code: INDUSTRY_CODE });
    await expect(
      app!.industry.create({
        data: { code: 'zz_catalog_rls_denied', nameEn: 'denied' },
      }),
    ).rejects.toThrow();
    await expect(
      app!.industry.update({
        where: { code: INDUSTRY_CODE },
        data: { nameEn: 'denied' },
      }),
    ).rejects.toThrow();
    await expect(
      app!.industry.delete({ where: { code: INDUSTRY_CODE } }),
    ).rejects.toThrow();
  });
});
