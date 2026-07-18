/**
 * Budget direction template RLS and tenant-parent guards (LIVE DB).
 *
 * Opt in only on a disposable database with real-shaped app/admin roles:
 *   RLS_INTEGRATION=1 npx vitest run \
 *     src/lib/db/budget-direction-template-rls.rls.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { withOrgScope } from "./with-org-scope";

const RUN = process.env.RLS_INTEGRATION === "1";
const d = RUN ? describe : describe.skip;
const APP_URL = process.env.DATABASE_URL_APP;
const admin = new PrismaClient();
const app = APP_URL
  ? new PrismaClient({ datasources: { db: { url: APP_URL } } })
  : null;
const scopeOpts = { client: app as unknown as PrismaClient };

const ORG_A = "zztemplateguardorgaaa01";
const ORG_B = "zztemplateguardorgbbb02";
const ORG_C = "zztemplateguardorgccc03";
const DEPT_A = "zztemplateguarddeptaa01";
const DEPT_B = "zztemplateguarddeptbb02";
const DEPT_NULL = "zztemplateguarddeptnull";
const COST_A = "zztemplateguardcostaa01";
const COST_B = "zztemplateguardcostbb02";
const COST_NULL = "zztemplateguardcostnull";
const TEMPLATE_A = "zztemplateguardrowaaa01";
const TEMPLATE_B = "zztemplateguardrowbbb02";
const TEMPLATE_NULL = "zztemplateguardrownul03";
const TEMPLATE_CASCADE = "zztemplateguardrowcas04";

function templateData(
  id: string,
  organizationId: string,
  name: string,
  departmentId?: string,
  costTypeId?: string,
) {
  return {
    id,
    organizationId,
    name,
    departmentId: departmentId ?? null,
    costTypeId: costTypeId ?? null,
  };
}

d("budget direction template RLS guards (live DB)", () => {
  beforeAll(async () => {
    if (!app || !APP_URL) {
      throw new Error(
        "DATABASE_URL_APP is required; template RLS tests must use budgetpro_app",
      );
    }

    const [appRole] = await app.$queryRawUnsafe<
      Array<{ role: string; rolsuper: boolean; rolbypassrls: boolean }>
    >(
      "SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    expect(appRole).toEqual({
      role: "budgetpro_app",
      rolsuper: false,
      rolbypassrls: false,
    });

    const [adminRole] = await admin.$queryRawUnsafe<
      Array<{ role: string; rolsuper: boolean; rolbypassrls: boolean }>
    >(
      "SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    expect(adminRole).toEqual({
      role: "budgetpro_admin",
      rolsuper: false,
      rolbypassrls: true,
    });

    await admin.organization.deleteMany({
      where: { id: { in: [ORG_A, ORG_B, ORG_C] } },
    });
    await admin.organization.createMany({
      data: [
        { id: ORG_A, name: "zz template guard A", slug: "zz-template-guard-a" },
        { id: ORG_B, name: "zz template guard B", slug: "zz-template-guard-b" },
        { id: ORG_C, name: "zz template guard C", slug: "zz-template-guard-c" },
      ],
    });
    await admin.budgetDepartment.createMany({
      data: [
        { id: DEPT_A, organizationId: ORG_A, key: "zz-a", label: "ZZ A" },
        { id: DEPT_B, organizationId: ORG_B, key: "zz-b", label: "ZZ B" },
        {
          id: DEPT_NULL,
          organizationId: ORG_A,
          key: "zz-null",
          label: "ZZ Null",
        },
      ],
    });
    await admin.budgetCostType.createMany({
      data: [
        { id: COST_A, organizationId: ORG_A, key: "zz-a", label: "ZZ A" },
        { id: COST_B, organizationId: ORG_B, key: "zz-b", label: "ZZ B" },
        {
          id: COST_NULL,
          organizationId: ORG_A,
          key: "zz-null",
          label: "ZZ Null",
        },
      ],
    });
    await admin.budgetDirectionTemplate.createMany({
      data: [
        templateData(TEMPLATE_A, ORG_A, "ZZ template A", DEPT_A, COST_A),
        templateData(TEMPLATE_B, ORG_B, "ZZ template B", DEPT_B, COST_B),
        templateData(
          TEMPLATE_NULL,
          ORG_A,
          "ZZ template null",
          DEPT_NULL,
          COST_NULL,
        ),
        templateData(TEMPLATE_CASCADE, ORG_C, "ZZ template cascade"),
      ],
    });
  });

  afterAll(async () => {
    await admin.organization.deleteMany({
      where: { id: { in: [ORG_A, ORG_B, ORG_C] } },
    });
    await app?.$disconnect();
    await admin.$disconnect();
  });

  it("has exact tenant CRUD, Organization FK, existing guards, and CRUD grants", async () => {
    const policies = await admin.$queryRawUnsafe<
      Array<{
        policyname: string;
        cmd: string;
        qual: string | null;
        with_check: string | null;
      }>
    >(
      "SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'budget_direction_templates' ORDER BY policyname",
    );
    expect(policies).toHaveLength(4);
    expect(policies.map((row) => row.cmd).sort()).toEqual([
      "DELETE",
      "INSERT",
      "SELECT",
      "UPDATE",
    ]);
    expect(
      policies.some((row) =>
        (String(row.qual ?? "") + String(row.with_check ?? "")).includes(
          "app.bypass_rls",
        ),
      ),
    ).toBe(false);

    const [foreignKey] = await admin.$queryRawUnsafe<
      Array<{
        update_action: string;
        delete_action: string;
        validated: boolean;
      }>
    >(
      "SELECT confupdtype::text AS update_action, confdeltype::text AS delete_action, convalidated AS validated FROM pg_constraint WHERE conrelid = 'public.budget_direction_templates'::regclass AND conname = 'budget_direction_templates_organizationId_fkey'",
    );
    expect(foreignKey).toEqual({
      update_action: "c",
      delete_action: "c",
      validated: true,
    });

    const guards = await admin.$queryRawUnsafe<
      Array<{
        trigger_name: string;
        enabled: string;
        security_definer: boolean;
        config: string[] | null;
      }>
    >(
      "SELECT trigger.tgname AS trigger_name, trigger.tgenabled AS enabled, procedure.prosecdef AS security_definer, procedure.proconfig AS config FROM pg_trigger AS trigger JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid WHERE trigger.tgrelid = 'public.budget_direction_templates'::regclass AND trigger.tgname IN ('budget_direction_template_department_guard_trg', 'budget_direction_template_cost_type_guard_trg') AND NOT trigger.tgisinternal ORDER BY trigger.tgname",
    );
    expect(guards).toHaveLength(2);
    expect(
      guards.every(
        (guard) =>
          guard.enabled === "O" &&
          guard.security_definer &&
          guard.config?.[0] === "search_path=pg_catalog, public",
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
      "SELECT has_table_privilege(current_user, 'public.budget_direction_templates', 'SELECT') AS can_select, has_table_privilege(current_user, 'public.budget_direction_templates', 'INSERT') AS can_insert, has_table_privilege(current_user, 'public.budget_direction_templates', 'UPDATE') AS can_update, has_table_privilege(current_user, 'public.budget_direction_templates', 'DELETE') AS can_delete",
    );
    expect(grants).toEqual({
      can_select: true,
      can_insert: true,
      can_update: true,
      can_delete: true,
    });
  });

  it("isolates reads, denies absent scope, and ignores app.bypass_rls", async () => {
    const own = await withOrgScope(
      ORG_A,
      (tx) => tx.budgetDirectionTemplate.findMany(),
      scopeOpts,
    );
    expect(own.map((row) => row.id).sort()).toEqual(
      [TEMPLATE_A, TEMPLATE_NULL].sort(),
    );
    await expect(app!.budgetDirectionTemplate.findMany()).resolves.toEqual([]);

    const bypassAttempt = await app!.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SET LOCAL "app.organization_id" = ' + "'" + ORG_A + "'",
      );
      await tx.$executeRawUnsafe('SET LOCAL "app.bypass_rls" = ' + "'true'");
      return tx.budgetDirectionTemplate.findMany();
    });
    expect(bypassAttempt).toHaveLength(2);
    expect(bypassAttempt.every((row) => row.organizationId === ORG_A)).toBe(
      true,
    );
    await expect(app!.budgetDirectionTemplate.findMany()).resolves.toEqual([]);
  });

  it("allows in-tenant create, update, and physical delete", async () => {
    const id = "zztemplateguardrowcrud05";
    const created = await withOrgScope(
      ORG_A,
      (tx) =>
        tx.budgetDirectionTemplate.create({
          data: templateData(id, ORG_A, "ZZ CRUD", DEPT_A, COST_A),
        }),
      scopeOpts,
    );
    expect(created.organizationId).toBe(ORG_A);

    const updated = await withOrgScope(
      ORG_A,
      (tx) =>
        tx.budgetDirectionTemplate.update({
          where: { id },
          data: { name: "ZZ CRUD updated", isActive: false },
        }),
      scopeOpts,
    );
    expect(updated).toMatchObject({
      name: "ZZ CRUD updated",
      isActive: false,
    });

    const removed = await withOrgScope(
      ORG_A,
      (tx) => tx.budgetDirectionTemplate.delete({ where: { id } }),
      scopeOpts,
    );
    expect(removed.id).toBe(id);
  });

  it("rejects cross-tenant rows and foreign department/cost-type references", async () => {
    await expect(
      withOrgScope(
        ORG_A,
        (tx) =>
          tx.budgetDirectionTemplate.create({
            data: templateData(
              "zztemplateguardcross01",
              ORG_B,
              "ZZ cross tenant",
              DEPT_B,
              COST_B,
            ),
          }),
        scopeOpts,
      ),
    ).rejects.toThrow();

    await expect(
      admin.budgetDirectionTemplate.create({
        data: templateData(
          "zztemplateguardcross02",
          ORG_A,
          "ZZ foreign department",
          DEPT_B,
          COST_A,
        ),
      }),
    ).rejects.toThrow();

    await expect(
      admin.budgetDirectionTemplate.create({
        data: templateData(
          "zztemplateguardcross03",
          ORG_A,
          "ZZ foreign cost type",
          DEPT_A,
          COST_B,
        ),
      }),
    ).rejects.toThrow();
  });

  it("preserves native-admin access, SET NULL, and Organization cascade", async () => {
    await expect(
      admin.budgetDirectionTemplate.findUnique({
        where: { id: TEMPLATE_B },
      }),
    ).resolves.toMatchObject({ organizationId: ORG_B });

    await admin.budgetDepartment.delete({ where: { id: DEPT_NULL } });
    await admin.budgetCostType.delete({ where: { id: COST_NULL } });
    await expect(
      admin.budgetDirectionTemplate.findUnique({
        where: { id: TEMPLATE_NULL },
      }),
    ).resolves.toMatchObject({
      departmentId: null,
      costTypeId: null,
    });

    await admin.organization.delete({ where: { id: ORG_C } });
    await expect(
      admin.budgetDirectionTemplate.findUnique({
        where: { id: TEMPLATE_CASCADE },
      }),
    ).resolves.toBeNull();
  });
});
