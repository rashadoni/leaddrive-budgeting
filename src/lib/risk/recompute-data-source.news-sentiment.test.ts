/**
 * getNewsSentimentRolling30d — holding-tag inheritance.
 *
 * Regression cover for the production bug found 2026-08-04: the crawler tagged
 * portfolio news with the holding's code ("AZSEKER") while the indicator lives
 * on the operating companies ("AZSEKER-AZSF", …). An exact-code lookup meant
 * every subsidiary read `unknown` — 204 values, all zero — with a working feed
 * one table away.
 */
import { describe, expect, it, vi } from 'vitest';
import { createPrismaDataSource } from './recompute-data-source';

type Co = { code: string; parentCompanyId: string | null };

/** `chain` maps company id → {code, parent}. `items` is what the query returns. */
type Item = {
  sentimentScore: number;
  relevanceScore?: number;
  publishedAt?: Date | null;
  fetchedAt?: Date;
};

const DAY = 24 * 60 * 60 * 1000;
/** Fully-relevant item published `ageDays` ago. */
const fresh = (sentimentScore: number, ageDays = 0, relevanceScore = 1): Item => ({
  sentimentScore,
  relevanceScore,
  publishedAt: new Date(Date.now() - ageDays * DAY),
  fetchedAt: new Date(),
});

function harness(chain: Record<string, Co>, items: Item[]) {
  const companyFindFirst = vi.fn(async ({ where }: { where: { id: string } }) =>
    chain[where.id] ?? null,
  );
  const intelFindMany = vi.fn().mockResolvedValue(items);
  const prisma = {
    company: { findFirst: companyFindFirst },
    intelItem: { findMany: intelFindMany },
  } as unknown as Parameters<typeof createPrismaDataSource>[0];
  return { dataSource: createPrismaDataSource(prisma), companyFindFirst, intelFindMany };
}

describe('getNewsSentimentRolling30d — holding tag inheritance', () => {
  it('looks up the company code AND every ancestor code', async () => {
    const { dataSource, intelFindMany } = harness(
      {
        co_sub: { code: 'AZSEKER-AZSF', parentCompanyId: 'co_holding' },
        co_holding: { code: 'AZSEKER', parentCompanyId: null },
      },
      [fresh(0.8), fresh(0.7)],
    );

    const avg = await dataSource.getNewsSentimentRolling30d({
      organizationId: 'org_1',
      companyId: 'co_sub',
    });

    const where = intelFindMany.mock.calls[0][0].where;
    expect(where.companyTags).toEqual({ hasSome: ['AZSEKER-AZSF', 'AZSEKER'] });
    // Plain mean, unchanged by this fix.
    expect(avg).toBeCloseTo(0.75);
  });

  it('walks more than one level up', async () => {
    const { dataSource, intelFindMany } = harness(
      {
        co_leaf: { code: 'LEAF', parentCompanyId: 'co_mid' },
        co_mid: { code: 'MID', parentCompanyId: 'co_top' },
        co_top: { code: 'TOP', parentCompanyId: null },
      },
      [fresh(0.1)],
    );

    await dataSource.getNewsSentimentRolling30d({
      organizationId: 'org_1',
      companyId: 'co_leaf',
    });

    expect(intelFindMany.mock.calls[0][0].where.companyTags).toEqual({
      hasSome: ['LEAF', 'MID', 'TOP'],
    });
  });

  it('a root company still queries only its own code', async () => {
    const { dataSource, intelFindMany } = harness(
      { co_root: { code: 'AZSEKER', parentCompanyId: null } },
      [fresh(0.5)],
    );

    await dataSource.getNewsSentimentRolling30d({
      organizationId: 'org_1',
      companyId: 'co_root',
    });

    expect(intelFindMany.mock.calls[0][0].where.companyTags).toEqual({
      hasSome: ['AZSEKER'],
    });
  });

  it('does not spin on a cyclic parent chain', async () => {
    const { dataSource, intelFindMany, companyFindFirst } = harness(
      {
        co_a: { code: 'A', parentCompanyId: 'co_b' },
        co_b: { code: 'B', parentCompanyId: 'co_a' },
      },
      [fresh(0.2)],
    );

    await dataSource.getNewsSentimentRolling30d({
      organizationId: 'org_1',
      companyId: 'co_a',
    });

    expect(intelFindMany.mock.calls[0][0].where.companyTags).toEqual({ hasSome: ['A', 'B'] });
    // co_a (self) + co_b, then the cycle back to co_a is refused.
    expect(companyFindFirst).toHaveBeenCalledTimes(2);
  });

  it('still returns null when nothing matches', async () => {
    const { dataSource } = harness(
      { co_sub: { code: 'AZSEKER-AZSF', parentCompanyId: 'co_holding' },
        co_holding: { code: 'AZSEKER', parentCompanyId: null } },
      [],
    );

    expect(
      await dataSource.getNewsSentimentRolling30d({
        organizationId: 'org_1',
        companyId: 'co_sub',
      }),
    ).toBeNull();
  });

  it('weights by relevance — a 1.00 item outweighs a 0.50 one', async () => {
    const { dataSource } = harness(
      { co: { code: 'C', parentCompanyId: null } },
      [fresh(1.0, 0, 1.0), fresh(0.0, 0, 0.5)],
    );
    const avg = await dataSource.getNewsSentimentRolling30d({
      organizationId: 'org_1',
      companyId: 'co',
    });
    // Flat mean would be 0.5; weighted by 1.0 vs 0.5 → 0.667.
    expect(avg).toBeCloseTo(2 / 3, 3);
  });

  it('decays with age — an old item yields to a fresh one', async () => {
    const { dataSource } = harness(
      { co: { code: 'C', parentCompanyId: null } },
      [fresh(1.0, 0), fresh(-1.0, 28)],
    );
    const avg = await dataSource.getNewsSentimentRolling30d({
      organizationId: 'org_1',
      companyId: 'co',
    });
    // Flat mean would be 0. Two half-lives (28d / 14d) → old weight 0.25.
    expect(avg).toBeCloseTo((1 - 0.25) / 1.25, 3);
  });

  it('ages by publishedAt, not by when we happened to fetch it', async () => {
    const { dataSource } = harness(
      { co: { code: 'C', parentCompanyId: null } },
      [
        // Fetched today, published four months ago — must NOT count as fresh.
        { sentimentScore: 1, relevanceScore: 1, publishedAt: new Date(Date.now() - 120 * DAY), fetchedAt: new Date() },
        { sentimentScore: -1, relevanceScore: 1, publishedAt: new Date(), fetchedAt: new Date() },
      ],
    );
    const avg = await dataSource.getNewsSentimentRolling30d({
      organizationId: 'org_1',
      companyId: 'co',
    });
    // The 120-day-old item is ~2^-8.6 of the fresh one, so the answer is the
    // fresh item's sentiment almost exactly.
    expect(avg).toBeLessThan(-0.99);
  });

  it('falls back to fetchedAt when the source had no publish date', async () => {
    const { dataSource } = harness(
      { co: { code: 'C', parentCompanyId: null } },
      [{ sentimentScore: 0.4, relevanceScore: 1, publishedAt: null, fetchedAt: new Date() }],
    );
    expect(
      await dataSource.getNewsSentimentRolling30d({ organizationId: 'org_1', companyId: 'co' }),
    ).toBeCloseTo(0.4, 5);
  });

  it('returns null rather than dressing up an all-stale sample as a signal', async () => {
    const { dataSource } = harness(
      { co: { code: 'C', parentCompanyId: null } },
      [fresh(0.9, 200), fresh(0.8, 240)],
    );
    expect(
      await dataSource.getNewsSentimentRolling30d({ organizationId: 'org_1', companyId: 'co' }),
    ).toBeNull();
  });
});
