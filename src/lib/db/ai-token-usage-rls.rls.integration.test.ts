/**
 * AI token usage RLS negative controls (LIVE DB).
 *
 * Opt in only on a disposable database with real-shaped app/admin roles:
 *   RLS_INTEGRATION=1 npx vitest run \
 *     src/lib/db/ai-token-usage-rls.rls.integration.test.ts
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

const ORG_A = 'zzaiusageorgaaaa000001';
const ORG_B = 'zzaiusageorgbbbb000002';
const ORG_C = 'zzaiusageorgcccc000003';
const ROW_A = 'zzaiusagerowaaaa000001';
const ROW_B = 'zzaiusagerowbbbb000002';
const ROW_C = 'zzaiusagerowcccc000003';

d('AI token usage RLS guards (live DB)', () => {
  beforeAll(async () => {
    if (!app || !APP_URL) {
      throw new Error(
        'DATABASE_URL_APP is required; AI usage RLS tests must use budgetpro_app',
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
        { id: ORG_A, name: 'zz AI usage A', slug: 'zz-ai-usage-a' },
        { id: ORG_B, name: 'zz AI usage B', slug: 'zz-ai-usage-b' },
      ],
    });
    await admin.aITokenUsage.createMany({
      data: [
        {
          id: ROW_A,
          organizationId: ORG_A,
          date: '2099-01-01',
          tokensIn: 100,
          tokensOut: 40,
          calls: 2,
        },
        {
          id: ROW_B,
          organizationId: ORG_B,
          date: '2099-01-01',
          tokensIn: 200,
          tokensOut: 60,
          calls: 3,
        },
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

  it('has exactly tenant SELECT and a validated non-negative constraint', async () => {
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
       WHERE schemaname = 'public' AND tablename = 'ai_token_usage'`,
    );
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatchObject({
      policyname: 'tenant_select',
      cmd: 'SELECT',
      with_check: null,
    });
    expect(policies[0].qual).toContain('app.organization_id');
    expect(policies[0].qual).not.toContain('app.bypass_rls');

    const [constraint] = await admin.$queryRawUnsafe<
      Array<{ validated: boolean; definition: string }>
    >(
      `SELECT convalidated AS validated,
              pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'public.ai_token_usage'::regclass
         AND conname = 'ai_token_usage_nonnegative_counters_check'`,
    );
    expect(constraint.validated).toBe(true);
    expect(constraint.definition).toContain('tokensIn');
    expect(constraint.definition).toContain('tokensOut');
    expect(constraint.definition).toContain('calls');
  });

  it('keeps request SELECT and denies every request-role DML privilege', async () => {
    const [grants] = await app!.$queryRawUnsafe<
      Array<{
        can_select: boolean;
        can_insert: boolean;
        can_update: boolean;
        can_delete: boolean;
      }>
    >(
      `SELECT
         has_table_privilege(current_user, 'public.ai_token_usage', 'SELECT') AS can_select,
         has_table_privilege(current_user, 'public.ai_token_usage', 'INSERT') AS can_insert,
         has_table_privilege(current_user, 'public.ai_token_usage', 'UPDATE') AS can_update,
         has_table_privilege(current_user, 'public.ai_token_usage', 'DELETE') AS can_delete`,
    );
    expect(grants).toEqual({
      can_select: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
    });
  });

  it('shows only own usage, denies absent scope, and ignores app.bypass_rls', async () => {
    const own = await withOrgScope(
      ORG_A,
      (tx) => tx.aITokenUsage.findMany(),
      scopeOpts,
    );
    expect(own).toHaveLength(1);
    expect(own[0].organizationId).toBe(ORG_A);
    await expect(app!.aITokenUsage.findMany()).resolves.toEqual([]);

    const bypassAttempt = await app!.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL "app.organization_id" = '${ORG_A}'`);
      await tx.$executeRawUnsafe(`SET LOCAL "app.bypass_rls" = 'true'`);
      return tx.aITokenUsage.findMany();
    });
    expect(bypassAttempt).toHaveLength(1);
    expect(bypassAttempt[0].organizationId).toBe(ORG_A);
    await expect(app!.aITokenUsage.findMany()).resolves.toEqual([]);
  });

  it('rejects request-role INSERT, UPDATE, and DELETE', async () => {
    await expect(
      withOrgScope(
        ORG_A,
        (tx) =>
          tx.aITokenUsage.create({
            data: {
              organizationId: ORG_A,
              date: '2099-01-02',
              tokensIn: 1,
              tokensOut: 1,
              calls: 1,
            },
          }),
        scopeOpts,
      ),
    ).rejects.toThrow();
    await expect(
      withOrgScope(
        ORG_A,
        (tx) =>
          tx.aITokenUsage.update({
            where: { id: ROW_A },
            data: { tokensIn: 101 },
          }),
        scopeOpts,
      ),
    ).rejects.toThrow();
    await expect(
      withOrgScope(
        ORG_A,
        (tx) => tx.aITokenUsage.delete({ where: { id: ROW_A } }),
        scopeOpts,
      ),
    ).rejects.toThrow();
  });

  it('allows native-admin upsert/correction but rejects a negative total', async () => {
    const corrected = await admin.aITokenUsage.update({
      where: { id: ROW_A },
      data: { tokensIn: 80, tokensOut: 30, calls: 1 },
    });
    expect(corrected).toMatchObject({ tokensIn: 80, tokensOut: 30, calls: 1 });

    const incremented = await admin.aITokenUsage.upsert({
      where: {
        organizationId_date: { organizationId: ORG_A, date: '2099-01-01' },
      },
      create: {
        organizationId: ORG_A,
        date: '2099-01-01',
        tokensIn: 5,
        tokensOut: 2,
        calls: 1,
      },
      update: {
        tokensIn: { increment: 5 },
        tokensOut: { increment: 2 },
        calls: { increment: 1 },
      },
    });
    expect(incremented).toMatchObject({ tokensIn: 85, tokensOut: 32, calls: 2 });

    await expect(
      admin.aITokenUsage.update({
        where: { id: ROW_A },
        data: { tokensIn: -1 },
      }),
    ).rejects.toThrow();
  });

  it('preserves Organization cascade for native tenant erasure', async () => {
    await admin.organization.create({
      data: { id: ORG_C, name: 'zz AI usage C', slug: 'zz-ai-usage-c' },
    });
    await admin.aITokenUsage.create({
      data: {
        id: ROW_C,
        organizationId: ORG_C,
        date: '2099-01-01',
        tokensIn: 10,
        tokensOut: 5,
        calls: 1,
      },
    });
    await admin.organization.delete({ where: { id: ORG_C } });
    await expect(
      admin.aITokenUsage.findUnique({ where: { id: ROW_C } }),
    ).resolves.toBeNull();
  });
});
