/**
 * Phase 10 / Stage B2 — DataRevision persistence: isolation, immutability,
 * idempotency (LIVE DB).
 *
 * Opt-in via RLS_INTEGRATION=1 — the same gate as
 * `src/lib/db/rls-leak.integration.test.ts`, so this runs alongside the
 * existing RLS safety net rather than inventing a second switch.
 *
 * Run:
 *   set -a; source .env; set +a; RLS_INTEGRATION=1 npx vitest run \
 *     src/lib/risk/data-revision.rls.integration.test.ts
 *
 * **Why the client is passed explicitly.** `getPrismaApp()` deliberately hands
 * back the default client under vitest (so unit tests that mock `@/lib/prisma`
 * never get a real one), and the dev `DATABASE_URL` connects as a superuser
 * with BYPASSRLS — which silently ignores every policy. A test that used
 * either would pass with the policy deleted. So `withOrgScope` is given a
 * client built on DATABASE_URL_APP (budgetpro_app: non-superuser, NOBYPASSRLS),
 * exactly as rls-leak.integration.test.ts does.
 *
 * These assertions are the reason the table was allowed to exist at all. A
 * revision names which sources produced a number; if one org could read or
 * rewrite another's, the lineage would be worse than absent — it would be
 * misleading. So: cross-org reads return nothing, cross-org writes are
 * rejected, a missing org context denies by default, and the pinned state
 * cannot be UPDATEd.
 *
 * The suite creates two throwaway organizations and deletes them in `finally`.
 * It writes nothing to any pre-existing org.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { withOrgScope } from '@/lib/db/with-org-scope';
import { computeRevisionContentHash, type RevisionScope } from './data-revision';

const RUN = process.env.RLS_INTEGRATION === '1';
const d = RUN ? describe : describe.skip;

/** Owner connection — superuser/BYPASSRLS. Setup, teardown and trigger checks only. */
const admin = new PrismaClient();

/**
 * The RLS-enforcing connection. Without DATABASE_URL_APP this test is
 * meaningless rather than merely skipped, so it fails loudly instead of
 * quietly asserting nothing against the superuser client.
 */
const APP_URL = process.env.DATABASE_URL_APP;
const prismaApp = APP_URL
  ? new PrismaClient({ datasources: { db: { url: APP_URL } } })
  : null;
const scopeOpts = { client: prismaApp as unknown as PrismaClient };

/** cuid-shaped ids: withOrgScope enforces /^[a-z0-9]{20,32}$/ at its boundary. */
const ORG_A = 'zzdatarevtestorgaaaa0001';
const ORG_B = 'zzdatarevtestorgbbbb0002';

function scopeFor(organizationId: string, over: Partial<RevisionScope> = {}): RevisionScope {
  return {
    organizationId,
    companyIds: ['co-a'],
    sourceArtifactIds: ['artifact-1'],
    mappingVersionIds: ['map-1'],
    periodFrom: '2026-01',
    periodTo: '2026-12',
    ...over,
  };
}

function revisionData(organizationId: string, over: Partial<RevisionScope> = {}) {
  const scope = scopeFor(organizationId, over);
  return {
    organizationId,
    companyIds: [...scope.companyIds],
    sourceArtifactIds: [...scope.sourceArtifactIds],
    mappingVersionIds: [...scope.mappingVersionIds],
    periodFrom: scope.periodFrom,
    periodTo: scope.periodTo,
    reason: 'import' as const,
    contentHash: computeRevisionContentHash({ scope, reason: 'import' }),
  };
}

d('DataRevision persistence (live DB)', () => {
  beforeAll(async () => {
    if (!prismaApp) {
      throw new Error(
        'DATABASE_URL_APP is required: without the NOBYPASSRLS role these ' +
          'assertions would pass even with the policy deleted.',
      );
    }
    for (const id of [ORG_A, ORG_B]) {
      await admin.organization.upsert({
        where: { id },
        create: {
          id,
          name: `zz-datarev-test-${id.slice(-4)}`,
          slug: `zz-datarev-test-${id.slice(-4)}`,
        },
        update: {},
      });
    }
    await admin.dataRevision.deleteMany({
      where: { organizationId: { in: [ORG_A, ORG_B] } },
    });
  });

  afterAll(async () => {
    // Cascade removes the revisions with the org.
    await admin.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
    await admin.$disconnect();
    await prismaApp?.$disconnect();
  });

  it('creates a revision inside its own organization', async () => {
    const created = await withOrgScope(
      ORG_A,
      (tx) => tx.dataRevision.create({ data: revisionData(ORG_A) }),
      scopeOpts,
    );
    expect(created.id).toBeTruthy();
    expect(created.organizationId).toBe(ORG_A);
    expect(created.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.supersedesId).toBeNull();
    expect(created.lockedAt).toBeNull();
  });

  it('reads back its own organization’s revision', async () => {
    const rows = await withOrgScope(
      ORG_A,
      (tx) => tx.dataRevision.findMany({ where: { organizationId: ORG_A } }),
      scopeOpts,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].organizationId).toBe(ORG_A);
  });

  it('cannot read another organization’s revision', async () => {
    // ORG_B asks for everything it can see. RLS must filter A's row out —
    // note the query carries NO org filter, so only the policy is protecting it.
    const rows = await withOrgScope(
      ORG_B,
      (tx) => tx.dataRevision.findMany({}),
      scopeOpts,
    );
    expect(rows).toHaveLength(0);
  });

  it('cannot read another organization’s revision even by explicit id', async () => {
    const a = await admin.dataRevision.findFirst({ where: { organizationId: ORG_A } });
    expect(a).not.toBeNull();
    const leaked = await withOrgScope(
      ORG_B,
      (tx) => tx.dataRevision.findUnique({ where: { id: a!.id } }),
      scopeOpts,
    );
    expect(leaked).toBeNull();
  });

  it('cannot write a revision into another organization', async () => {
    // The policy has no explicit WITH CHECK, so USING governs writes: an
    // INSERT stamped with ORG_A while scoped to ORG_B must be rejected.
    await expect(
      withOrgScope(
        ORG_B,
        (tx) => tx.dataRevision.create({ data: revisionData(ORG_A) }),
        scopeOpts,
      ),
    ).rejects.toThrow();
  });

  it('denies by default when the org context is absent', async () => {
    // No SET LOCAL app.organization_id → current_setting returns NULL →
    // "organizationId" = NULL is NULL, not TRUE → zero rows. Absence of a
    // context must never mean "see everything".
    // Straight off the app client, with no withOrgScope wrapper and therefore
    // no SET LOCAL at all.
    const rows = await prismaApp!.dataRevision.findMany({});
    expect(rows).toHaveLength(0);
  });

  it('rejects a malformed org context at the helper boundary', async () => {
    await expect(withOrgScope('', async () => null, scopeOpts)).rejects.toThrow(
      /organizationId is required/,
    );
    await expect(withOrgScope('x', async () => null, scopeOpts)).rejects.toThrow(
      /cuid-shaped/,
    );
  });

  describe('immutability (§5.2 / ADR §4)', () => {
    it('rejects an update to the pinned source state', async () => {
      const row = await admin.dataRevision.findFirstOrThrow({
        where: { organizationId: ORG_A },
      });
      await expect(
        admin.dataRevision.update({
          where: { id: row.id },
          data: { contentHash: 'f'.repeat(64) },
        }),
      ).rejects.toThrow(/immutable/i);
    });

    it.each([
      ['reason', { reason: 'correction' as const }],
      ['periodTo', { periodTo: '2026-06' }],
      ['companyIds', { companyIds: ['co-z'] }],
      ['organizationId', { organizationId: ORG_B }],
      ['sourceArtifactIds', { sourceArtifactIds: ['artifact-9'] }],
    ])('rejects an update to %s', async (_label, data) => {
      const row = await admin.dataRevision.findFirstOrThrow({
        where: { organizationId: ORG_A },
      });
      await expect(
        admin.dataRevision.update({ where: { id: row.id }, data }),
      ).rejects.toThrow(/immutable/i);
    });

    it('allows the lifecycle columns to move — §5.1 requires them to', async () => {
      const row = await admin.dataRevision.findFirstOrThrow({
        where: { organizationId: ORG_A },
      });
      const updated = await admin.dataRevision.update({
        where: { id: row.id },
        data: {
          lockedAt: new Date('2026-07-17T00:00:00.000Z'),
          reconciledAt: new Date('2026-07-18T00:00:00.000Z'),
          approvedAt: new Date('2026-07-19T00:00:00.000Z'),
        },
      });
      expect(updated.lockedAt).not.toBeNull();
      expect(updated.contentHash).toBe(row.contentHash);
    });

    it('lets a user deletion null the actor without tripping the trigger', async () => {
      // ON DELETE SET NULL is an UPDATE under the hood. If the trigger banned
      // every createdById change, deleting a User would fail outright.
      const user = await admin.user.create({
        data: {
          id: 'zzdatarevtestuseraaaa001',
          organizationId: ORG_A,
          email: `zz-datarev-${Date.now()}@example.test`,
          name: 'zz datarev test',
          passwordHash: 'zz-not-a-real-hash',
        },
      });
      const rev = await admin.dataRevision.create({
        data: {
          ...revisionData(ORG_A, { sourceArtifactIds: ['artifact-actor'] }),
          createdById: user.id,
        },
      });
      await admin.user.delete({ where: { id: user.id } });
      const after = await admin.dataRevision.findUniqueOrThrow({ where: { id: rev.id } });
      expect(after.createdById).toBeNull();
      await admin.dataRevision.delete({ where: { id: rev.id } });
    });
  });

  describe('idempotency and duplicate protection (§5.2)', () => {
    it('rejects a second revision pinning an identical source state', async () => {
      // "A source change creates a new revision" — so an unchanged source
      // state must not. Re-running an import is a no-op, not a phantom row.
      await expect(
        withOrgScope(
          ORG_A,
          (tx) => tx.dataRevision.create({ data: revisionData(ORG_A) }),
          scopeOpts,
        ),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('is idempotent under a repeated request via upsert on the hash', async () => {
      const data = revisionData(ORG_A);
      const run = () =>
        withOrgScope(
          ORG_A,
          (tx) =>
            tx.dataRevision.upsert({
            where: {
              organizationId_contentHash: {
                organizationId: ORG_A,
                contentHash: data.contentHash,
              },
            },
              create: data,
              update: {},
            }),
          scopeOpts,
        );
      const first = await run();
      const second = await run();
      expect(second.id).toBe(first.id);
      const count = await admin.dataRevision.count({
        where: { organizationId: ORG_A, contentHash: data.contentHash },
      });
      expect(count).toBe(1);
    });

    it('serializes concurrent writers of the same source state to one row', async () => {
      // The race the unique key exists for: N importers firing at once must
      // leave exactly one revision, not N. Postgres arbitrates; the losers
      // surface as P2002 rather than as a second row. A caller that treats
      // P2002 as "already recorded" is therefore idempotent under concurrency.
      const data = revisionData(ORG_A, { sourceArtifactIds: ['artifact-race'] });
      const attempts = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          withOrgScope(
            ORG_A,
            (tx) => tx.dataRevision.create({ data }),
            scopeOpts,
          ),
        ),
      );
      const created = await admin.dataRevision.findMany({
        where: { organizationId: ORG_A, contentHash: data.contentHash },
      });
      expect(created).toHaveLength(1);
      expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
      for (const a of attempts.filter((r) => r.status === 'rejected')) {
        expect((a as PromiseRejectedResult).reason).toMatchObject({ code: 'P2002' });
      }
      await admin.dataRevision.delete({ where: { id: created[0].id } });
    });

    it('allows the same source state in a different organization', async () => {
      // The unique key is org-scoped: two tenants importing identical
      // artifacts must not collide with each other.
      const created = await withOrgScope(
        ORG_B,
        (tx) => tx.dataRevision.create({ data: revisionData(ORG_B) }),
        scopeOpts,
      );
      expect(created.organizationId).toBe(ORG_B);
      await admin.dataRevision.delete({ where: { id: created.id } });
    });

    it('admits a genuinely different source state', async () => {
      const created = await withOrgScope(
        ORG_A,
        (tx) =>
          tx.dataRevision.create({
            data: revisionData(ORG_A, { sourceArtifactIds: ['artifact-2'] }),
          }),
        scopeOpts,
      );
      expect(created.id).toBeTruthy();
      await admin.dataRevision.delete({ where: { id: created.id } });
    });
  });

  describe('transactions', () => {
    it('rolls back the revision when the surrounding transaction throws', async () => {
      const before = await admin.dataRevision.count({ where: { organizationId: ORG_A } });
      await expect(
        withOrgScope(
          ORG_A,
          async (tx) => {
            await tx.dataRevision.create({
              data: revisionData(ORG_A, { sourceArtifactIds: ['artifact-rollback'] }),
            });
            throw new Error('forced rollback');
          },
          scopeOpts,
        ),
      ).rejects.toThrow('forced rollback');
      const after = await admin.dataRevision.count({ where: { organizationId: ORG_A } });
      expect(after).toBe(before);
    });

    it('leaves no orphan when the org is deleted — cascade, not orphan rows', async () => {
      const tmp = 'zzdatarevtestorgcccc0003';
      await admin.organization.create({
        data: { id: tmp, name: 'zz-datarev-tmp', slug: 'zz-datarev-tmp' },
      });
      await admin.dataRevision.create({ data: revisionData(tmp) });
      await admin.organization.delete({ where: { id: tmp } });
      const left = await admin.dataRevision.count({ where: { organizationId: tmp } });
      expect(left).toBe(0);
    });
  });

  it('supersedes without deleting — old revisions stay queryable (§5.2)', async () => {
    const first = await admin.dataRevision.findFirstOrThrow({
      where: { organizationId: ORG_A },
    });
    const next = await admin.dataRevision.create({
      data: {
        ...revisionData(ORG_A, { sourceArtifactIds: ['artifact-superseding'] }),
        reason: 'correction',
        supersedesId: first.id,
      },
    });
    // The predecessor is untouched and still readable.
    const predecessor = await admin.dataRevision.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(predecessor.id).toBe(first.id);
    expect(predecessor.contentHash).toBe(first.contentHash);
    const link = await admin.dataRevision.findUniqueOrThrow({
      where: { id: first.id },
      include: { supersededBy: true },
    });
    expect(link.supersededBy?.id).toBe(next.id);
    await admin.dataRevision.delete({ where: { id: next.id } });
  });
});

// Keeps the Prisma namespace import honest under noUnusedLocals.
export type _P2002 = Prisma.PrismaClientKnownRequestError;
