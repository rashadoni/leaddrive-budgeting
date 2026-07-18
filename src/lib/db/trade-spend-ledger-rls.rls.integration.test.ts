/**
 * Trade spend ledger RLS negative controls (LIVE DB).
 *
 * Opt in only on a disposable database with real-shaped app/admin roles:
 *   RLS_INTEGRATION=1 npx vitest run \
 *     src/lib/db/trade-spend-ledger-rls.rls.integration.test.ts
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

const ORG_A = 'zztradeledgerorgaaa00001';
const ORG_B = 'zztradeledgerorgbbb00002';
const ORG_C = 'zztradeledgerorgccc00003';
const USER_A = 'zztradeledgeruseraa00001';
const USER_B = 'zztradeledgeruserbb00002';
const TYPE_A = 'zztradeledgertypeaa00001';
const TYPE_B = 'zztradeledgertypebb00002';
const TYPE_C = 'zztradeledgertypecc00003';
const ENTRY_A = 'zztradeledgerentrya00001';
const ENTRY_A2 = 'zztradeledgerentrya00002';
const ENTRY_B = 'zztradeledgerentryb00001';
const ENTRY_C = 'zztradeledgerentryc00001';

function ledgerData(
  id: string,
  organizationId: string,
  spendTypeId: string,
  createdBy: string,
) {
  return {
    id,
    organizationId,
    entryKind: 'actual' as const,
    spendTypeId,
    entryDate: new Date('2099-01-15T00:00:00.000Z'),
    year: 2099,
    month: 1,
    amount: 125,
    createdBy,
  };
}

d('trade spend ledger RLS guards (live DB)', () => {
  beforeAll(async () => {
    if (!app || !APP_URL) {
      throw new Error(
        'DATABASE_URL_APP is required; Trade ledger RLS tests must use budgetpro_app',
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

    await admin.tradeSpendLedger.deleteMany({
      where: { organizationId: { in: [ORG_A, ORG_B, ORG_C] } },
    });
    await admin.tradeSpendType.deleteMany({
      where: { organizationId: { in: [ORG_A, ORG_B, ORG_C] } },
    });
    await admin.organization.deleteMany({
      where: { id: { in: [ORG_A, ORG_B, ORG_C] } },
    });
    await admin.organization.createMany({
      data: [
        { id: ORG_A, name: 'zz trade ledger A', slug: 'zz-trade-ledger-a' },
        { id: ORG_B, name: 'zz trade ledger B', slug: 'zz-trade-ledger-b' },
      ],
    });
    await admin.user.createMany({
      data: [
        {
          id: USER_A,
          organizationId: ORG_A,
          email: 'zz-trade-ledger-a@example.test',
          name: 'zz trade ledger A',
          passwordHash: 'zz-not-a-real-hash',
        },
        {
          id: USER_B,
          organizationId: ORG_B,
          email: 'zz-trade-ledger-b@example.test',
          name: 'zz trade ledger B',
          passwordHash: 'zz-not-a-real-hash',
        },
      ],
    });
    await admin.tradeSpendType.createMany({
      data: [
        {
          id: TYPE_A,
          organizationId: ORG_A,
          key: 'zz-ledger-a',
          label: 'ZZ ledger A',
          accrualMethod: 'manual',
        },
        {
          id: TYPE_B,
          organizationId: ORG_B,
          key: 'zz-ledger-b',
          label: 'ZZ ledger B',
          accrualMethod: 'manual',
        },
      ],
    });
    await admin.tradeSpendLedger.createMany({
      data: [
        ledgerData(ENTRY_A, ORG_A, TYPE_A, USER_A),
        ledgerData(ENTRY_A2, ORG_A, TYPE_A, USER_A),
        ledgerData(ENTRY_B, ORG_B, TYPE_B, USER_B),
      ],
    });
  });

  afterAll(async () => {
    await admin.organization.deleteMany({
      where: { id: { in: [ORG_A, ORG_B, ORG_C] } },
    });
    await admin.tradeSpendType.deleteMany({
      where: { organizationId: { in: [ORG_A, ORG_B, ORG_C] } },
    });
    await app?.$disconnect();
    await admin.$disconnect();
  });

  it('has exact policies, organization FK, and an enabled write guard', async () => {
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
       WHERE schemaname = 'public' AND tablename = 'trade_spend_ledger'
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

    const [guard] = await admin.$queryRawUnsafe<
      Array<{
        trigger_enabled: string;
        security_definer: boolean;
        config: string[] | null;
        delete_action: string;
        update_action: string;
      }>
    >(
      `SELECT trigger.tgenabled AS trigger_enabled,
              procedure.prosecdef AS security_definer,
              procedure.proconfig AS config,
              organization_fk.confdeltype AS delete_action,
              organization_fk.confupdtype AS update_action
       FROM pg_trigger AS trigger
       JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
       JOIN pg_constraint AS organization_fk
         ON organization_fk.conrelid = trigger.tgrelid
        AND organization_fk.conname = 'trade_spend_ledger_organizationId_fkey'
       WHERE trigger.tgrelid = 'public.trade_spend_ledger'::regclass
         AND trigger.tgname = 'trade_spend_ledger_write_guard_trg'
         AND NOT trigger.tgisinternal`,
    );
    expect(guard).toEqual({
      trigger_enabled: 'O',
      security_definer: true,
      config: ['search_path=pg_catalog, public'],
      delete_action: 'c',
      update_action: 'r',
    });
  });

  it('keeps SELECT/INSERT but grants UPDATE only for void columns and denies DELETE', async () => {
    const [grants] = await app!.$queryRawUnsafe<
      Array<{
        can_select: boolean;
        can_insert: boolean;
        table_update: boolean;
        voided_at_update: boolean;
        voided_by_update: boolean;
        amount_update: boolean;
        can_delete: boolean;
      }>
    >(
      `SELECT
         has_table_privilege(current_user, 'public.trade_spend_ledger', 'SELECT') AS can_select,
         has_table_privilege(current_user, 'public.trade_spend_ledger', 'INSERT') AS can_insert,
         has_table_privilege(current_user, 'public.trade_spend_ledger', 'UPDATE') AS table_update,
         has_column_privilege(current_user, 'public.trade_spend_ledger', 'voidedAt', 'UPDATE') AS voided_at_update,
         has_column_privilege(current_user, 'public.trade_spend_ledger', 'voidedBy', 'UPDATE') AS voided_by_update,
         has_column_privilege(current_user, 'public.trade_spend_ledger', 'amount', 'UPDATE') AS amount_update,
         has_table_privilege(current_user, 'public.trade_spend_ledger', 'DELETE') AS can_delete`,
    );
    expect(grants).toEqual({
      can_select: true,
      can_insert: true,
      table_update: false,
      voided_at_update: true,
      voided_by_update: true,
      amount_update: false,
      can_delete: false,
    });
  });

  it('shows only own rows, denies absent scope, and ignores app.bypass_rls', async () => {
    const own = await withOrgScope(
      ORG_A,
      (tx) => tx.tradeSpendLedger.findMany({ orderBy: { id: 'asc' } }),
      scopeOpts,
    );
    expect(own).toHaveLength(2);
    expect(own.every((row) => row.organizationId === ORG_A)).toBe(true);
    await expect(app!.tradeSpendLedger.findMany()).resolves.toEqual([]);

    const bypassAttempt = await app!.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL "app.organization_id" = '${ORG_A}'`);
      await tx.$executeRawUnsafe(`SET LOCAL "app.bypass_rls" = 'true'`);
      return tx.tradeSpendLedger.findMany();
    });
    expect(bypassAttempt).toHaveLength(2);
    expect(bypassAttempt.every((row) => row.organizationId === ORG_A)).toBe(true);
    await expect(app!.tradeSpendLedger.findMany()).resolves.toEqual([]);
  });

  it('allows own unvoided insert but rejects cross-org and prevoided inserts', async () => {
    const ownId = 'zztradeledgerentrya00003';
    const own = await withOrgScope(
      ORG_A,
      (tx) =>
        tx.tradeSpendLedger.create({
          data: ledgerData(ownId, ORG_A, TYPE_A, USER_A),
        }),
      scopeOpts,
    );
    expect(own.organizationId).toBe(ORG_A);

    await expect(
      withOrgScope(
        ORG_A,
        (tx) =>
          tx.tradeSpendLedger.create({
            data: ledgerData('zztradeledgerentryb00002', ORG_B, TYPE_B, USER_B),
          }),
        scopeOpts,
      ),
    ).rejects.toThrow();
    await expect(
      admin.tradeSpendLedger.create({
        data: {
          ...ledgerData('zztradeledgerprevoid0001', ORG_A, TYPE_A, USER_A),
          voidedAt: new Date(),
          voidedBy: USER_A,
        },
      }),
    ).rejects.toThrow(/created unvoided/i);
  });

  it('rejects a foreign spend type even when the row organization passes RLS', async () => {
    const crossOrgId = 'zztradeledgercrossorg001';
    await expect(
      withOrgScope(
        ORG_A,
        (tx) =>
          tx.tradeSpendLedger.create({
            data: ledgerData(crossOrgId, ORG_A, TYPE_B, USER_A),
          }),
        scopeOpts,
      ),
    ).rejects.toThrow();
    await expect(
      admin.tradeSpendLedger.findUnique({ where: { id: crossOrgId } }),
    ).resolves.toBeNull();
  });

  it('allows the app one exact void and rejects field edits, revoid, unvoid, and partial void', async () => {
    const voidedAt = new Date('2099-02-01T00:00:00.000Z');
    const result = await withOrgScope(
      ORG_A,
      (tx) =>
        tx.tradeSpendLedger.updateMany({
          where: { id: ENTRY_A, organizationId: ORG_A, voidedAt: null },
          data: { voidedAt, voidedBy: USER_A },
        }),
      scopeOpts,
    );
    expect(result.count).toBe(1);

    await expect(
      withOrgScope(
        ORG_A,
        (tx) =>
          tx.tradeSpendLedger.update({
            where: { id: ENTRY_A2 },
            data: { amount: 999 },
          }),
        scopeOpts,
      ),
    ).rejects.toThrow();
    await expect(
      admin.tradeSpendLedger.update({
        where: { id: ENTRY_A },
        data: { voidedAt: new Date('2099-02-02T00:00:00.000Z'), voidedBy: USER_A },
      }),
    ).rejects.toThrow(/one-way void/i);
    await expect(
      admin.tradeSpendLedger.update({
        where: { id: ENTRY_A },
        data: { voidedAt: null, voidedBy: null },
      }),
    ).rejects.toThrow(/one-way void/i);
    await expect(
      admin.tradeSpendLedger.update({
        where: { id: ENTRY_A2 },
        data: { voidedAt },
      }),
    ).rejects.toThrow(/one-way void/i);
  });

  it('denies app deletion, permits native-admin deletion, and cascades organization deletion', async () => {
    await expect(
      withOrgScope(
        ORG_B,
        (tx) => tx.tradeSpendLedger.delete({ where: { id: ENTRY_B } }),
        scopeOpts,
      ),
    ).rejects.toThrow();
    await admin.tradeSpendLedger.delete({ where: { id: ENTRY_B } });
    await expect(
      admin.tradeSpendLedger.findUnique({ where: { id: ENTRY_B } }),
    ).resolves.toBeNull();

    await admin.organization.create({
      data: { id: ORG_C, name: 'zz trade ledger C', slug: 'zz-trade-ledger-c' },
    });
    await admin.tradeSpendType.create({
      data: {
        id: TYPE_C,
        organizationId: ORG_C,
        key: 'zz-ledger-c',
        label: 'ZZ ledger C',
        accrualMethod: 'manual',
      },
    });
    await admin.tradeSpendLedger.create({
      data: ledgerData(ENTRY_C, ORG_C, TYPE_C, USER_A),
    });
    await admin.organization.delete({ where: { id: ORG_C } });
    await expect(
      admin.tradeSpendLedger.findUnique({ where: { id: ENTRY_C } }),
    ).resolves.toBeNull();
    await admin.tradeSpendType.delete({ where: { id: TYPE_C } });
  });
});
