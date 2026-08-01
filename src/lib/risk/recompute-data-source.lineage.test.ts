import { describe, expect, it, vi } from 'vitest';
import { createPrismaDataSource } from './recompute-data-source';

const WRITE = {
  organizationId: 'org_1',
  companyId: 'co_1',
  indicatorId: 'ind_1',
  period: '2026-04',
  value: 42,
  status: 'green' as const,
  inputs: { resolved: {}, aggregates: {}, derived: {} },
  valueSource: 'computed' as const,
};

function harness(revision: { id: string } | null) {
  const companyFindFirst = vi.fn().mockResolvedValue({ id: 'co_1' });
  const findFirst = vi.fn().mockResolvedValue(revision);
  const upsert = vi.fn().mockResolvedValue({});
  const prisma = {
    company: { findFirst: companyFindFirst },
    dataRevision: { findFirst },
    indicatorValue: { upsert },
  } as unknown as Parameters<typeof createPrismaDataSource>[0];

  return {
    dataSource: createPrismaDataSource(prisma),
    companyFindFirst,
    findFirst,
    upsert,
  };
}

describe('createPrismaDataSource.upsertIndicatorValue — revision scope guard', () => {
  it('requires the revision to match both organization and company', async () => {
    const { dataSource, companyFindFirst, findFirst, upsert } = harness({ id: 'rev_1' });

    await dataSource.upsertIndicatorValue({ ...WRITE, revisionId: 'rev_1' });

    expect(companyFindFirst).toHaveBeenCalledWith({
      where: { id: 'co_1', organizationId: 'org_1' },
      select: { id: true },
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'rev_1',
        organizationId: 'org_1',
        OR: [
          { companyIds: { isEmpty: true } },
          { companyIds: { has: 'co_1' } },
        ],
      },
      // `reason` is projected because the guard also refuses `external_refresh`
      // revisions (11.86) — external evidence is shadow-only by construction
      // and must never become an observation's lineage.
      select: { id: true, reason: true },
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].create.revisionId).toBe('rev_1');
    expect(upsert.mock.calls[0][0].update.revisionId).toBe('rev_1');
  });

  it('rejects an out-of-scope revision before writing', async () => {
    const { dataSource, findFirst, upsert } = harness(null);

    await expect(
      dataSource.upsertIndicatorValue({ ...WRITE, revisionId: 'rev_sibling' }),
    ).rejects.toThrow(
      'upsertIndicatorValue: revision rev_sibling not found in organization org_1',
    );

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'rev_sibling',
          organizationId: 'org_1',
          OR: [
            { companyIds: { isEmpty: true } },
            { companyIds: { has: 'co_1' } },
          ],
        }),
      }),
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each([undefined, null])(
    'does not query a revision when revisionId is %s',
    async (revisionId) => {
      const { dataSource, findFirst, upsert } = harness(null);

      await dataSource.upsertIndicatorValue({ ...WRITE, revisionId });

      expect(findFirst).not.toHaveBeenCalled();
      expect(upsert).toHaveBeenCalledTimes(1);
    },
  );

  it('accepts an org-wide revision only after verifying the company belongs to the org', async () => {
    const { dataSource, companyFindFirst, findFirst, upsert } = harness({
      id: 'rev_org_wide',
    });

    await dataSource.upsertIndicatorValue({
      ...WRITE,
      revisionId: 'rev_org_wide',
    });

    expect(companyFindFirst).toHaveBeenCalledOnce();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([{ companyIds: { isEmpty: true } }]),
        }),
      }),
    );
    expect(upsert).toHaveBeenCalledOnce();
  });

  it('rejects a foreign company before looking up even an org-wide revision', async () => {
    const h = harness({ id: 'rev_org_wide' });
    h.companyFindFirst.mockResolvedValue(null);

    await expect(
      h.dataSource.upsertIndicatorValue({
        ...WRITE,
        revisionId: 'rev_org_wide',
      }),
    ).rejects.toThrow(/not found in organization/);

    expect(h.findFirst).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
  });
});
