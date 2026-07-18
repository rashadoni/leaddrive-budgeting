/**
 * Phase 10 / Stage B5 — IndicatorValue lineage (LIVE DB).
 *
 * Opt-in via RLS_INTEGRATION=1, alongside the other RLS suites:
 *   set -a; source .env; set +a; RLS_INTEGRATION=1 npx vitest run \
 *     src/lib/risk/lineage.integration.test.ts
 *
 * The claim under test is narrow and worth stating exactly: a `revisionId`
 * proves an observation can name the source state it came from. It does **not**
 * make the value correct, reconciled or decision-grade. So these tests check
 * that lineage is *recorded honestly* — never invented, never cross-tenant,
 * never silently erased — and that its absence stays honest too.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaDataSource } from './recompute-data-source';
import { ensureDataRevision } from './data-revision-writer';
import { computeRevisionContentHash, type RevisionScope } from './data-revision';
import { classifyObservationGrade } from './decision-grade';

const RUN = process.env.RLS_INTEGRATION === '1';
const d = RUN ? describe : describe.skip;

const admin = new PrismaClient();

const ORG_A = 'zzlineagetestorgaaaaa001';
const ORG_B = 'zzlineagetestorgbbbbb002';
const CO_A = 'zzlineagetestcoaaaaaa001';
const CO_B = 'zzlineagetestcobbbbbb002';
const CO_SIBLING = 'zzlineagetestcosibbbb003';
const IND = 'zzlineagetestinddddd0001';

function scopeFor(organizationId: string, over: Partial<RevisionScope> = {}): RevisionScope {
  return {
    organizationId,
    companyIds: [CO_A],
    sourceArtifactIds: ['workbook.xlsx#PL'],
    mappingVersionIds: ['coa-v1'],
    periodFrom: '2026-01',
    periodTo: '2026-12',
    ...over,
  };
}

async function upsertIv(
  organizationId: string,
  revisionId: string | null | undefined,
  period = '2026',
) {
  const ds = createPrismaDataSource(admin);
  await ds.upsertIndicatorValue({
    organizationId,
    companyId: CO_A,
    indicatorId: IND,
    period,
    value: 42,
    status: 'green',
    inputs: {} as never,
    valueSource: 'computed',
    ...(revisionId !== undefined ? { revisionId } : {}),
  });
  return admin.indicatorValue.findFirstOrThrow({
    where: { companyId: CO_A, indicatorId: IND, period },
  });
}

d('IndicatorValue lineage (live DB)', () => {
  beforeAll(async () => {
    for (const [id, slug] of [
      [ORG_A, 'zz-lineage-a'],
      [ORG_B, 'zz-lineage-b'],
    ]) {
      await admin.organization.upsert({
        where: { id },
        create: { id, name: slug, slug },
        update: {},
      });
    }
    await admin.company.upsert({
      where: { id: CO_A },
      create: {
        id: CO_A,
        organizationId: ORG_A,
        name: 'zz lineage co',
        code: 'ZZLIN',
      },
      update: {},
    });
    await admin.company.upsert({
      where: { id: CO_B },
      create: {
        id: CO_B,
        organizationId: ORG_B,
        name: 'zz lineage foreign co',
        code: 'ZZLINB',
      },
      update: {},
    });
    await admin.company.upsert({
      where: { id: CO_SIBLING },
      create: {
        id: CO_SIBLING,
        organizationId: ORG_A,
        name: 'zz lineage sibling co',
        code: 'ZZLINS',
      },
      update: {},
    });
    await admin.indicatorDefinition.upsert({
      where: { id: IND },
      create: {
        id: IND,
        organizationId: ORG_A,
        code: 'ZZ_LINEAGE',
        nameEn: 'zz lineage indicator',
        category: 'operational',
        industries: [],
        unit: 'ratio',
        direction: 'higher_better',
        formula: '1',
        thresholds: {},
      },
      update: {},
    });
  });

  afterAll(async () => {
    await admin.indicatorValue.deleteMany({ where: { companyId: CO_A } });
    await admin.indicatorDefinition.deleteMany({ where: { id: IND } });
    await admin.company.deleteMany({
      where: { id: { in: [CO_A, CO_B, CO_SIBLING] } },
    });
    await admin.dataRevision.deleteMany({
      where: { organizationId: { in: [ORG_A, ORG_B] } },
    });
    await admin.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
    await admin.$disconnect();
  });

  it('legacy rows stay valid and untraced — no backfill, no invention', async () => {
    // The 1,269 pre-existing IVs are exactly this shape. A writer that omits a
    // revision must produce it too, not a fabricated pointer.
    const iv = await upsertIv(ORG_A, undefined);
    expect(iv.revisionId).toBeNull();
    expect(iv.value).toBe(42);
  });

  it('writes an observation carrying a valid revision', async () => {
    const rev = await ensureDataRevision(admin, {
      scope: scopeFor(ORG_A),
      reason: 'import',
    });
    expect(rev.created).toBe(true);
    const iv = await upsertIv(ORG_A, rev.id);
    expect(iv.revisionId).toBe(rev.id);

    const joined = await admin.indicatorValue.findFirstOrThrow({
      where: { id: iv.id },
      include: { revision: true },
    });
    expect(joined.revision?.organizationId).toBe(ORG_A);
    expect(joined.revision?.contentHash).toBe(
      computeRevisionContentHash({ scope: scopeFor(ORG_A), reason: 'import' }),
    );
  });

  it('rejects a revision belonging to another organization', async () => {
    // The load-bearing guard: a lineage pointer into another tenant would
    // render as evidence while being a leak — strictly worse than null.
    const foreign = await ensureDataRevision(admin, {
      scope: scopeFor(ORG_B, { companyIds: [CO_B] }),
      reason: 'import',
    });
    await expect(upsertIv(ORG_A, foreign.id)).rejects.toThrow(/not found in organization/);
  });

  it('rejects a same-organization revision that does not include the company', async () => {
    // Tenant equality is necessary but insufficient: a revision scoped to a
    // sibling company did not produce CO_A's value and must not be presented
    // as its provenance.
    const sibling = await ensureDataRevision(admin, {
      scope: scopeFor(ORG_A, {
        companyIds: [CO_SIBLING],
        sourceArtifactIds: ['sibling-only.xlsx'],
      }),
      reason: 'import',
    });
    await expect(upsertIv(ORG_A, sibling.id)).rejects.toThrow(
      /not found in organization/,
    );
  });

  it('rejects a revision that does not exist', async () => {
    await expect(upsertIv(ORG_A, 'zznosuchrevisionaaaa0001')).rejects.toThrow(
      /not found in organization/,
    );
  });

  it('does not reveal whether a rejected revision exists elsewhere', async () => {
    // Same message for "missing" and "another org's" — otherwise a caller
    // could probe another tenant's revision ids by diffing the errors.
    const foreign = await ensureDataRevision(admin, {
      scope: scopeFor(ORG_B, { companyIds: [CO_B] }),
      reason: 'correction',
    });
    const foreignErr = await upsertIv(ORG_A, foreign.id).catch((e) => String(e));
    const missingErr = await upsertIv(ORG_A, 'zznosuchrevisionbbbb0002').catch((e) =>
      String(e),
    );
    expect(String(foreignErr).replace(foreign.id, 'ID')).toBe(
      String(missingErr).replace('zznosuchrevisionbbbb0002', 'ID'),
    );
  });

  it('a failed write leaves no observation and no half-written lineage', async () => {
    const before = await admin.indicatorValue.count({ where: { companyId: CO_A } });
    await expect(upsertIv(ORG_A, 'zznosuchrevisioncccc0003', '2099')).rejects.toThrow();
    const after = await admin.indicatorValue.count({ where: { companyId: CO_A } });
    expect(after).toBe(before);
  });

  describe('idempotency', () => {
    it('re-running a traced write leaves one row with the same revision', async () => {
      const rev = await ensureDataRevision(admin, {
        scope: scopeFor(ORG_A, { sourceArtifactIds: ['idem.xlsx'] }),
        reason: 'import',
      });
      const first = await upsertIv(ORG_A, rev.id, '2025');
      const second = await upsertIv(ORG_A, rev.id, '2025');
      expect(second.id).toBe(first.id);
      expect(second.revisionId).toBe(rev.id);
      const count = await admin.indicatorValue.count({
        where: { companyId: CO_A, indicatorId: IND, period: '2025' },
      });
      expect(count).toBe(1);
    });

    it('ensureDataRevision returns the same row for an unchanged source state', async () => {
      const input = { scope: scopeFor(ORG_A, { mappingVersionIds: ['coa-v2'] }), reason: 'import' as const };
      const a = await ensureDataRevision(admin, input);
      const b = await ensureDataRevision(admin, input);
      expect(b.id).toBe(a.id);
      expect(b.created).toBe(false);
    });
  });

  it('an untraced recompute CLEARS lineage rather than inheriting it', async () => {
    // This test asserted the opposite until the B5 writer review, and the
    // inversion is the point — so the reasoning is worth keeping.
    //
    // The old rule ("`undefined` must not touch the column — the same rule
    // sparkline follows") modelled lineage on the sparkline, and the analogy is
    // wrong. A sparkline is independent data owned by another writer, so a
    // recompute that has none must leave it alone. A revisionId is a property
    // of the `value` written in the same statement: it asserts "this revision
    // produced this number".
    //
    // With the old rule, the nightly cron — which threads no revision — would
    // overwrite value/status/computedAt from a completely different source
    // state and leave the import's revision attached to it. The row would then
    // cite provenance for a number that provenance never produced. That is not
    // preserving lineage; it is manufacturing it, and a wrong pointer reads as
    // evidence where null reads as its absence.
    const rev = await ensureDataRevision(admin, {
      scope: scopeFor(ORG_A, { sourceArtifactIds: ['keep.xlsx'] }),
      reason: 'import',
    });
    const traced = await upsertIv(ORG_A, rev.id, '2024');
    expect(traced.revisionId).toBe(rev.id);

    // Now an untraced recompute rewrites the same row, as the cron does.
    const after = await upsertIv(ORG_A, undefined, '2024');
    expect(after.revisionId).toBeNull();
  });

  it('clears lineage when null is passed explicitly', async () => {
    const cleared = await upsertIv(ORG_A, null, '2024');
    expect(cleared.revisionId).toBeNull();
  });

  it('re-stamps lineage when a later traced write replaces the value', async () => {
    // The inverse of the above: presence must track the CURRENT writer, so a
    // second import re-establishes the pointer rather than being ignored.
    const first = await ensureDataRevision(admin, {
      scope: scopeFor(ORG_A, { sourceArtifactIds: ['first.xlsx'] }),
      reason: 'import',
    });
    const second = await ensureDataRevision(admin, {
      scope: scopeFor(ORG_A, { sourceArtifactIds: ['second.xlsx'] }),
      reason: 'import',
    });
    expect(second.id).not.toBe(first.id);

    await upsertIv(ORG_A, first.id, '2022');
    const after = await upsertIv(ORG_A, second.id, '2022');
    expect(after.revisionId).toBe(second.id);
  });

  it('refuses to delete a revision that observations still point at', async () => {
    // onDelete: Restrict. Deleting it would either destroy the observations or
    // orphan their lineage; revisions are superseded, never deleted (§5.2).
    const rev = await ensureDataRevision(admin, {
      scope: scopeFor(ORG_A, { sourceArtifactIds: ['restrict.xlsx'] }),
      reason: 'import',
    });
    await upsertIv(ORG_A, rev.id, '2023');
    await expect(admin.dataRevision.delete({ where: { id: rev.id } })).rejects.toThrow();
  });

  describe('lineage is evidence, not a verdict', () => {
    it('leaves a traced-but-unreconciled observation provisional', async () => {
      // The whole point. A revisionId answers "where did this come from?".
      // It does not answer "is it reconciled?", and A5's gate still withholds
      // decision-grade until lineage is REQUIRED and reconciliation exists.
      const rev = await ensureDataRevision(admin, {
        scope: scopeFor(ORG_A, { sourceArtifactIds: ['grade.xlsx'] }),
        reason: 'import',
      });
      const iv = await upsertIv(ORG_A, rev.id, '2022');
      expect(iv.revisionId).toBe(rev.id);
      expect(iv.lastReconciledAt).toBeNull();

      const verdict = classifyObservationGrade(
        {
          companyId: CO_A,
          indicatorId: IND,
          value: iv.value,
          status: 'green',
          computedAt: iv.computedAt.toISOString(),
          lastReconciledAt: undefined,
        },
        Date.now(),
        { requireLineage: true },
      );
      expect(verdict.grade).toBe('provisional');
      expect(verdict.reasons).toContain('no_lineage');
    });
  });
  describe('actor resolution honours the nullable/SetNull contract', () => {
    const ACTOR = 'zzlineageactoruser000001';

    it('records the author when they exist', async () => {
      await admin.user.upsert({
        where: { id: ACTOR },
        create: {
          id: ACTOR,
          email: 'zz-lineage-actor@example.test',
          name: 'zz lineage actor',
          passwordHash: 'x',
          organizationId: ORG_A,
          role: 'manager',
        },
        update: {},
      });
      const rev = await ensureDataRevision(admin, {
        scope: scopeFor(ORG_A, { sourceArtifactIds: ['actor-present.xlsx'] }),
        reason: 'import',
        createdById: ACTOR,
      });
      const row = await admin.dataRevision.findFirstOrThrow({ where: { id: rev.id } });
      expect(row.createdById).toBe(ACTOR);
      await admin.dataRevision.deleteMany({ where: { id: rev.id } });
      await admin.user.deleteMany({ where: { id: ACTOR } });
    });

    it('records null rather than throwing when the author has been deleted', async () => {
      // A vanished user is a fact about the user, not a reason to reject the
      // import. Without this resolution the insert would P2003 and roll back a
      // financial import because the person who started it was removed.
      const rev = await ensureDataRevision(admin, {
        scope: scopeFor(ORG_A, { sourceArtifactIds: ['actor-gone.xlsx'] }),
        reason: 'import',
        createdById: 'zzlineagedeletedactor001', // never inserted
      });
      const row = await admin.dataRevision.findFirstOrThrow({ where: { id: rev.id } });
      expect(row.createdById).toBeNull();
      await admin.dataRevision.deleteMany({ where: { id: rev.id } });
    });
  });

});
