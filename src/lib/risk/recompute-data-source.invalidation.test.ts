/**
 * Phase 11.86 — two rules at the single place an IndicatorValue is written.
 *
 * 1. **External evidence can never become observation lineage.**
 *    `external-source-lineage.ts` marks every feed artifact `shadowOnly: true,
 *    decisionEligible: false` and states there is "intentionally no switch that
 *    can make external evidence decision-grade". `revisionId` IS that switch —
 *    it is the one field A5's gate reads for `no_lineage` — so the writer has
 *    to refuse an `external_refresh` revision outright. Without this, a
 *    commodity feed could be handed the exact property that module denies it.
 *
 * 2. **A reconciliation stamp must not outlive the number it certified.**
 *    `revisionId` has always been cleared by an untraced update, with the
 *    argument that carrying it forward "would not be preserving lineage, it
 *    would be fabricating it". `lastReconciledAt` answers the neighbouring
 *    question about the same `value` and was never touched, so any stamp
 *    survived an unbounded number of value-changing recomputes.
 */

import { describe, expect, it, vi } from 'vitest';
import { createPrismaDataSource } from './recompute-data-source';

const WRITE = {
  organizationId: 'org_1',
  companyId: 'co_1',
  indicatorId: 'ind_1',
  period: '2026-04',
  value: 140,
  status: 'green' as const,
  inputs: { resolved: {}, aggregates: {}, derived: {} },
  valueSource: 'computed' as const,
};

function harness(revision: { id: string; reason: string } | null) {
  const companyFindFirst = vi.fn().mockResolvedValue({ id: 'co_1' });
  const findFirst = vi.fn().mockResolvedValue(revision);
  const upsert = vi.fn().mockResolvedValue({});
  const prisma = {
    company: { findFirst: companyFindFirst },
    dataRevision: { findFirst },
    indicatorValue: { upsert },
  } as unknown as Parameters<typeof createPrismaDataSource>[0];
  return { dataSource: createPrismaDataSource(prisma), findFirst, upsert };
}

describe('upsertIndicatorValue — shadow-only revisions', () => {
  it('refuses an external_refresh revision', async () => {
    const { dataSource, upsert } = harness({
      id: 'rev_feed',
      reason: 'external_refresh',
    });

    await expect(
      dataSource.upsertIndicatorValue({ ...WRITE, revisionId: 'rev_feed' }),
    ).rejects.toThrow(
      /revision rev_feed is external_refresh — external evidence is shadow-only/,
    );

    // Nothing written. A refusal that still wrote the row would leave the
    // value untraced but present, which is survivable; failing loudly is what
    // turns a false-provenance bug into a caught one.
    expect(upsert).not.toHaveBeenCalled();
  });

  it('accepts every reason that describes the client own source state', async () => {
    for (const reason of [
      'import',
      'correction',
      'mapping_change',
      'late_adjustment',
      'manual_override',
    ]) {
      const { dataSource, upsert } = harness({ id: 'rev_x', reason });
      await dataSource.upsertIndicatorValue({ ...WRITE, revisionId: 'rev_x' });
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(upsert.mock.calls[0][0].update.revisionId).toBe('rev_x');
    }
  });
});

describe('upsertIndicatorValue — reconciliation invalidation', () => {
  it('clears the reconciliation stamp on every update, traced or not', async () => {
    // The value being written here is 140. If an earlier audit run stamped the
    // row while it read 100, "Audited 01 Aug 2026" now sits over a number
    // nobody checked.
    for (const revisionId of [undefined, 'rev_import_1']) {
      const { dataSource, upsert } = harness({ id: 'rev_import_1', reason: 'import' });
      await dataSource.upsertIndicatorValue({ ...WRITE, revisionId });
      const update = upsert.mock.calls[0][0].update;
      expect(update.lastReconciledAt).toBeNull();
      expect(update.reconciledBy).toBeNull();
      expect(update.sanityBand).toBeNull();
    }
  });

  it('does not invent a reconciliation on create either', async () => {
    // Recompute is not a reconciliation and must never write one. A fresh row
    // is unreconciled by omission, which is what the column default already
    // says — asserted so a future "helpful" default cannot appear unnoticed.
    const { dataSource, upsert } = harness(null);
    await dataSource.upsertIndicatorValue(WRITE);
    expect(upsert.mock.calls[0][0].create.lastReconciledAt).toBeUndefined();
    expect(upsert.mock.calls[0][0].create.reconciledBy).toBeUndefined();
  });

  it('leaves the sparkline alone while clearing reconciliation — they are opposites', async () => {
    // A sparkline is independent data owned by the offline worker, so a
    // recompute that has none must not clobber it. A reconciliation stamp is a
    // property of the value this write just replaced. Both rules live three
    // lines apart and pull in opposite directions; this pins that they do.
    const { dataSource, upsert } = harness(null);
    await dataSource.upsertIndicatorValue(WRITE);
    const update = upsert.mock.calls[0][0].update;
    expect(update.sparkline).toBeUndefined();
    expect(update.lastReconciledAt).toBeNull();
  });
});
