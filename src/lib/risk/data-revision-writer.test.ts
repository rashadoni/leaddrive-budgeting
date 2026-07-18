import { describe, expect, it, vi } from 'vitest';
import { ensureDataRevision } from './data-revision-writer';
import type { RevisionScope } from './data-revision';

function scope(over: Partial<RevisionScope> = {}): RevisionScope {
  return {
    organizationId: 'org_1',
    companyIds: ['co_b', 'co_a', 'co_a'],
    sourceArtifactIds: ['file_b', 'file_a', 'file_a'],
    mappingVersionIds: ['map_b', 'map_a', 'map_a'],
    periodFrom: '2026-01',
    periodTo: '2026-12',
    ...over,
  };
}

function harness() {
  const companyFindMany = vi.fn().mockResolvedValue([
    { id: 'co_a' },
    { id: 'co_b' },
  ]);
  const revisionFindFirst = vi.fn().mockResolvedValue(null);
  const revisionCreate = vi.fn().mockResolvedValue({ id: 'rev_1' });
  const userFindFirst = vi.fn().mockResolvedValue({ id: 'user_1' });
  const prisma = {
    company: { findMany: companyFindMany },
    dataRevision: {
      findFirst: revisionFindFirst,
      create: revisionCreate,
    },
    user: { findFirst: userFindFirst },
  } as unknown as Parameters<typeof ensureDataRevision>[0];

  return {
    prisma,
    companyFindMany,
    revisionFindFirst,
    revisionCreate,
    userFindFirst,
  };
}

describe('ensureDataRevision — canonical scope boundary', () => {
  it('validates every company in the organization and stores canonical sets', async () => {
    const h = harness();

    await expect(
      ensureDataRevision(h.prisma, {
        scope: scope(),
        reason: 'import',
        createdById: 'user_1',
      }),
    ).resolves.toMatchObject({ id: 'rev_1', created: true });

    expect(h.companyFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org_1',
        id: { in: ['co_a', 'co_b'] },
      },
      select: { id: true },
    });
    expect(h.userFindFirst).toHaveBeenCalledWith({
      where: { id: 'user_1', organizationId: 'org_1' },
      select: { id: true },
    });
    expect(h.revisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyIds: ['co_a', 'co_b'],
          sourceArtifactIds: ['file_a', 'file_b'],
          mappingVersionIds: ['map_a', 'map_b'],
          createdById: 'user_1',
        }),
      }),
    );
  });

  it('rejects missing or foreign companies before reading or creating a revision', async () => {
    const h = harness();
    h.companyFindMany.mockResolvedValue([{ id: 'co_a' }]);

    await expect(
      ensureDataRevision(h.prisma, { scope: scope(), reason: 'import' }),
    ).rejects.toThrow('DataRevision scope contains an unknown company');

    expect(h.revisionFindFirst).not.toHaveBeenCalled();
    expect(h.revisionCreate).not.toHaveBeenCalled();
  });

  it('keeps an empty company list as the documented org-wide scope', async () => {
    const h = harness();

    await ensureDataRevision(h.prisma, {
      scope: scope({ companyIds: [] }),
      reason: 'external_refresh',
    });

    expect(h.companyFindMany).not.toHaveBeenCalled();
    expect(h.revisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ companyIds: [] }),
      }),
    );
  });

  it('drops a foreign or missing actor instead of creating a cross-org attribution', async () => {
    const h = harness();
    h.userFindFirst.mockResolvedValue(null);

    await ensureDataRevision(h.prisma, {
      scope: scope(),
      reason: 'import',
      createdById: 'user_foreign',
    });

    expect(h.userFindFirst).toHaveBeenCalledWith({
      where: { id: 'user_foreign', organizationId: 'org_1' },
      select: { id: true },
    });
    expect(h.revisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ createdById: null }),
      }),
    );
  });

  it('matches the canonical stored scope as well as the dedupe hash', async () => {
    const h = harness();
    h.revisionFindFirst.mockResolvedValue({ id: 'rev_existing' });

    await expect(
      ensureDataRevision(h.prisma, { scope: scope(), reason: 'import' }),
    ).resolves.toMatchObject({ id: 'rev_existing', created: false });

    expect(h.revisionFindFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: 'org_1',
        companyIds: { equals: ['co_a', 'co_b'] },
        sourceArtifactIds: { equals: ['file_a', 'file_b'] },
        mappingVersionIds: { equals: ['map_a', 'map_b'] },
        periodFrom: '2026-01',
        periodTo: '2026-12',
        reason: 'import',
        contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
      select: { id: true },
    });
    expect(h.revisionCreate).not.toHaveBeenCalled();
  });
});
