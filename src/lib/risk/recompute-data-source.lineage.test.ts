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
  const findFirst = vi.fn().mockResolvedValue(revision);
  const upsert = vi.fn().mockResolvedValue({});
  const prisma = {
    dataRevision: { findFirst },
    indicatorValue: { upsert },
  } as unknown as Parameters<typeof createPrismaDataSource>[0];

  return {
    dataSource: createPrismaDataSource(prisma),
    findFirst,
    upsert,
  };
}

describe('createPrismaDataSource.upsertIndicatorValue — revision scope guard', () => {
  it('requires the revision to match both organization and company', async () => {
    const { dataSource, findFirst, upsert } = harness({ id: 'rev_1' });

    await dataSource.upsertIndicatorValue({ ...WRITE, revisionId: 'rev_1' });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'rev_1',
        organizationId: 'org_1',
        companyIds: { has: 'co_1' },
      },
      select: { id: true },
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
          companyIds: { has: 'co_1' },
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
});
