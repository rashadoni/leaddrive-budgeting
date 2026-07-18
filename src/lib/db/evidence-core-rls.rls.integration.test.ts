/**
 * Evidence-core RLS negative controls (LIVE DB).
 *
 * Opt in only on a disposable database with real-shaped app/admin roles:
 *   RLS_INTEGRATION=1 npx vitest run \
 *     src/lib/db/evidence-core-rls.rls.integration.test.ts
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

const ORG_A = 'zzevidenceorgaaaa000001';
const ORG_B = 'zzevidenceorgbbbb000002';
const USER_A = 'zzevidenceuseraaa000001';
const USER_B = 'zzevidenceuserbbb000002';
const ENTITY_PREFIX = 'ZZEvidenceRLS';

function auditData(organizationId: string, actorUserId: string | null, entityId: string) {
  return {
    organizationId,
    actorUserId,
    action: 'budget_plan_create' as const,
    entityType: ENTITY_PREFIX,
    entityId,
    metadata: { source: 'evidence-core-live-test' },
  };
}

function snapshotData(organizationId: string, signedBy: string, period: string) {
  return {
    organizationId,
    period,
    signedBy,
    ivHash: 'a'.repeat(64),
    budgetHash: 'b'.repeat(64),
    aggregates: { ivCount: 0, budgetLineCount: 0 },
    signoffNote: 'evidence-core-live-test',
  };
}

d('evidence-core RLS guards (live DB)', () => {
  beforeAll(async () => {
    if (!app || !APP_URL) {
      throw new Error(
        'DATABASE_URL_APP is required; evidence-core RLS tests must use budgetpro_app',
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

    await admin.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
    await admin.organization.createMany({
      data: [
        { id: ORG_A, name: 'zz evidence A', slug: 'zz-evidence-a' },
        { id: ORG_B, name: 'zz evidence B', slug: 'zz-evidence-b' },
      ],
    });
    await admin.user.createMany({
      data: [
        {
          id: USER_A,
          organizationId: ORG_A,
          email: 'zz-evidence-a@example.test',
          name: 'zz evidence A',
          passwordHash: 'zz-not-a-real-hash',
        },
        {
          id: USER_B,
          organizationId: ORG_B,
          email: 'zz-evidence-b@example.test',
          name: 'zz evidence B',
          passwordHash: 'zz-not-a-real-hash',
        },
      ],
    });
    await admin.auditEvent.createMany({
      data: [
        auditData(ORG_A, USER_A, 'seed-a'),
        auditData(ORG_B, USER_B, 'seed-b'),
      ],
    });
    await admin.periodSnapshot.createMany({
      data: [
        snapshotData(ORG_A, USER_A, '2099-01'),
        snapshotData(ORG_B, USER_B, '2099-01'),
      ],
    });
  });

  afterAll(async () => {
    await admin.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
    await app?.$disconnect();
    await admin.$disconnect();
  });

  it('has exact SELECT/INSERT policies, preserved notify, and no custom GUC', async () => {
    const policies = await admin.$queryRawUnsafe<
      Array<{
        tablename: string;
        policyname: string;
        cmd: string;
        qual: string | null;
        with_check: string | null;
      }>
    >(
      `SELECT tablename, policyname, cmd, qual, with_check
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename IN ('audit_events', 'period_snapshots')
       ORDER BY tablename, policyname`,
    );
    for (const table of ['audit_events', 'period_snapshots']) {
      const own = policies.filter((row) => row.tablename === table);
      expect(own).toHaveLength(2);
      expect(own.map((row) => row.cmd).sort()).toEqual(['INSERT', 'SELECT']);
      expect(
        own.some((row) =>
          `${row.qual ?? ''} ${row.with_check ?? ''}`.includes('app.bypass_rls'),
        ),
      ).toBe(false);
    }

    const triggers = await admin.$queryRawUnsafe<Array<{ tgname: string }>>(
      `SELECT tgname FROM pg_trigger
       WHERE NOT tgisinternal
         AND tgrelid IN ('public.audit_events'::regclass, 'public.period_snapshots'::regclass)
       ORDER BY tgname`,
    );
    expect(triggers.map((row) => row.tgname)).toEqual([
      'audit_events_notify_trg',
      'period_snapshots_immutable_trg',
    ]);
  });

  it('revokes request-role UPDATE and DELETE while retaining SELECT and INSERT', async () => {
    const grants = await app!.$queryRawUnsafe<
      Array<{
        table_name: string;
        can_select: boolean;
        can_insert: boolean;
        can_update: boolean;
        can_delete: boolean;
      }>
    >(
      `SELECT table_name,
              has_table_privilege(current_user, 'public.' || table_name, 'SELECT') AS can_select,
              has_table_privilege(current_user, 'public.' || table_name, 'INSERT') AS can_insert,
              has_table_privilege(current_user, 'public.' || table_name, 'UPDATE') AS can_update,
              has_table_privilege(current_user, 'public.' || table_name, 'DELETE') AS can_delete
       FROM (VALUES ('audit_events'), ('period_snapshots')) AS t(table_name)
       ORDER BY table_name`,
    );
    expect(grants).toEqual([
      {
        table_name: 'audit_events',
        can_select: true,
        can_insert: true,
        can_update: false,
        can_delete: false,
      },
      {
        table_name: 'period_snapshots',
        can_select: true,
        can_insert: true,
        can_update: false,
        can_delete: false,
      },
    ]);
  });

  it('shows only own evidence and denies absent scope', async () => {
    const own = await withOrgScope(
      ORG_A,
      async (tx) => ({
        audits: await tx.auditEvent.findMany({ where: { entityType: ENTITY_PREFIX } }),
        snapshots: await tx.periodSnapshot.findMany({ where: { period: '2099-01' } }),
      }),
      scopeOpts,
    );
    expect(own.audits).toHaveLength(1);
    expect(own.audits[0].organizationId).toBe(ORG_A);
    expect(own.snapshots).toHaveLength(1);
    expect(own.snapshots[0].organizationId).toBe(ORG_A);

    await expect(app!.auditEvent.findMany({ where: { entityType: ENTITY_PREFIX } }))
      .resolves.toEqual([]);
    await expect(app!.periodSnapshot.findMany({ where: { period: '2099-01' } }))
      .resolves.toEqual([]);
  });

  it('ignores app.bypass_rls and resets scope with the transaction', async () => {
    const result = await app!.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL "app.organization_id" = '${ORG_A}'`);
      await tx.$executeRawUnsafe(`SET LOCAL "app.bypass_rls" = 'true'`);
      return Promise.all([
        tx.auditEvent.findMany({ where: { entityType: ENTITY_PREFIX } }),
        tx.periodSnapshot.findMany({ where: { period: '2099-01' } }),
      ]);
    });
    expect(result[0]).toHaveLength(1);
    expect(result[1]).toHaveLength(1);
    expect(result[0][0].organizationId).toBe(ORG_A);
    expect(result[1][0].organizationId).toBe(ORG_A);
    await expect(app!.auditEvent.findMany({ where: { entityType: ENTITY_PREFIX } }))
      .resolves.toEqual([]);
  });

  it('allows own inserts and a second sign-off row', async () => {
    const created = await withOrgScope(
      ORG_A,
      async (tx) => {
        const audit = await tx.auditEvent.create({
          data: auditData(ORG_A, USER_A, 'app-own'),
        });
        const first = await tx.periodSnapshot.create({
          data: snapshotData(ORG_A, USER_A, '2099-02'),
        });
        const second = await tx.periodSnapshot.create({
          data: snapshotData(ORG_A, USER_A, '2099-02'),
        });
        return { audit, first, second };
      },
      scopeOpts,
    );
    expect(created.audit.organizationId).toBe(ORG_A);
    expect(created.first.id).not.toBe(created.second.id);
    await expect(
      admin.periodSnapshot.count({ where: { organizationId: ORG_A, period: '2099-02' } }),
    ).resolves.toBe(2);
  });

  it('rejects cross-org and missing-scope inserts', async () => {
    await expect(
      withOrgScope(
        ORG_A,
        (tx) => tx.auditEvent.create({ data: auditData(ORG_B, USER_B, 'foreign') }),
        scopeOpts,
      ),
    ).rejects.toThrow();
    await expect(
      withOrgScope(
        ORG_A,
        (tx) => tx.periodSnapshot.create({ data: snapshotData(ORG_B, USER_B, '2099-03') }),
        scopeOpts,
      ),
    ).rejects.toThrow();
    await expect(
      app!.auditEvent.create({ data: auditData(ORG_A, USER_A, 'missing-scope') }),
    ).rejects.toThrow();
    await expect(
      app!.periodSnapshot.create({
        data: snapshotData(ORG_A, USER_A, '2099-04'),
      }),
    ).rejects.toThrow();
  });

  it('denies app UPDATE/DELETE and rejects snapshot UPDATE even for native admin', async () => {
    const audit = await admin.auditEvent.findFirstOrThrow({
      where: { organizationId: ORG_A, entityType: ENTITY_PREFIX },
    });
    const snapshot = await admin.periodSnapshot.findFirstOrThrow({
      where: { organizationId: ORG_A },
    });
    await expect(
      withOrgScope(
        ORG_A,
        (tx) => tx.auditEvent.update({ where: { id: audit.id }, data: { entityId: 'changed' } }),
        scopeOpts,
      ),
    ).rejects.toThrow();
    await expect(
      withOrgScope(
        ORG_A,
        (tx) => tx.auditEvent.delete({ where: { id: audit.id } }),
        scopeOpts,
      ),
    ).rejects.toThrow();
    await expect(
      withOrgScope(
        ORG_A,
        (tx) => tx.periodSnapshot.delete({ where: { id: snapshot.id } }),
        scopeOpts,
      ),
    ).rejects.toThrow();
    await expect(
      admin.periodSnapshot.update({
        where: { id: snapshot.id },
        data: { signoffNote: 'changed' },
      }),
    ).rejects.toThrow(/immutable/i);
  });

  it('preserves audit row when its actor is deleted and lets native admin retain/delete', async () => {
    const actor = await admin.user.create({
      data: {
        id: 'zzevidenceactor000000001',
        organizationId: ORG_A,
        email: 'zz-evidence-actor@example.test',
        name: 'zz evidence actor',
        passwordHash: 'zz-not-a-real-hash',
      },
    });
    const event = await withOrgScope(
      ORG_A,
      (tx) =>
        tx.auditEvent.create({
          data: auditData(ORG_A, actor.id, 'actor-delete'),
        }),
      scopeOpts,
    );
    await admin.user.delete({ where: { id: actor.id } });
    await expect(admin.auditEvent.findUniqueOrThrow({ where: { id: event.id } }))
      .resolves.toMatchObject({ actorUserId: null });
    await admin.auditEvent.delete({ where: { id: event.id } });
    await expect(admin.auditEvent.findUnique({ where: { id: event.id } }))
      .resolves.toBeNull();
  });
});
