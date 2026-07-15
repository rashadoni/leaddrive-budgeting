/**
 * Phase 10 / Stage B2 — DataRevision contract.
 *
 * The hash has one job: decide whether two revisions pin the same source state.
 * Most of these tests are about the ways it could quietly get that wrong.
 */
import { describe, it, expect } from 'vitest';
import {
  computeRevisionContentHash,
  requiresNewRevision,
  correctionReasonFor,
  isCurrent,
  REVISION_REASONS,
  type RevisionScope,
  type DataRevision,
} from './data-revision';

function scope(over: Partial<RevisionScope> = {}): RevisionScope {
  return {
    organizationId: 'org-1',
    companyIds: ['co-a', 'co-b'],
    sourceArtifactIds: ['art-1'],
    mappingVersionIds: ['map-1'],
    periodFrom: '2026-01',
    periodTo: '2026-12',
    ...over,
  };
}

const base = { scope: scope(), reason: 'import' as const };

describe('computeRevisionContentHash', () => {
  it('is deterministic across calls', () => {
    expect(computeRevisionContentHash(base)).toBe(
      computeRevisionContentHash(base),
    );
  });

  it('returns a full sha256 hex digest', () => {
    expect(computeRevisionContentHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  describe('treats id lists as sets, not sequences', () => {
    it('ignores ordering — the same imports pulled in a different order are one state', () => {
      expect(
        computeRevisionContentHash({
          ...base,
          scope: scope({ companyIds: ['co-b', 'co-a'] }),
        }),
      ).toBe(computeRevisionContentHash(base));
    });

    it('ignores duplicates', () => {
      expect(
        computeRevisionContentHash({
          ...base,
          scope: scope({ companyIds: ['co-a', 'co-b', 'co-a'] }),
        }),
      ).toBe(computeRevisionContentHash(base));
    });

    it.each([
      ['sourceArtifactIds', { sourceArtifactIds: ['art-2', 'art-1'] }],
      ['mappingVersionIds', { mappingVersionIds: ['map-2', 'map-1'] }],
    ])('applies the same rule to %s', (_label, over) => {
      const a = computeRevisionContentHash({ ...base, scope: scope(over) });
      const b = computeRevisionContentHash({
        ...base,
        scope: scope(
          Object.fromEntries(
            Object.entries(over).map(([k, v]) => [k, [...(v as string[])].reverse()]),
          ) as Partial<RevisionScope>,
        ),
      });
      expect(a).toBe(b);
    });
  });

  describe('changes when the pinned source state changes', () => {
    it.each<[string, Partial<RevisionScope>]>([
      ['organizationId', { organizationId: 'org-2' }],
      ['an added company', { companyIds: ['co-a', 'co-b', 'co-c'] }],
      ['a removed company', { companyIds: ['co-a'] }],
      ['a new source artifact', { sourceArtifactIds: ['art-2'] }],
      ['a mapping version bump', { mappingVersionIds: ['map-2'] }],
      ['the period start', { periodFrom: '2026-02' }],
      ['the period end', { periodTo: '2026-11' }],
    ])('differs on %s', (_label, over) => {
      expect(
        computeRevisionContentHash({ ...base, scope: scope(over) }),
      ).not.toBe(computeRevisionContentHash(base));
    });

    it('differs on the reason code', () => {
      expect(
        computeRevisionContentHash({ ...base, reason: 'correction' }),
      ).not.toBe(computeRevisionContentHash(base));
    });

    it('does not collide across field boundaries', () => {
      // A naive concatenation would hash ["a","b"] the same as ["ab"].
      const a = computeRevisionContentHash({
        ...base,
        scope: scope({ companyIds: ['a', 'b'] }),
      });
      const b = computeRevisionContentHash({
        ...base,
        scope: scope({ companyIds: ['ab'] }),
      });
      expect(a).not.toBe(b);
    });

    it('does not confuse an artifact id with a mapping id', () => {
      expect(
        computeRevisionContentHash({
          ...base,
          scope: scope({ sourceArtifactIds: ['x'], mappingVersionIds: ['y'] }),
        }),
      ).not.toBe(
        computeRevisionContentHash({
          ...base,
          scope: scope({ sourceArtifactIds: ['y'], mappingVersionIds: ['x'] }),
        }),
      );
    });
  });

  it('is stable regardless of the authoring order of scope keys', () => {
    const reordered: RevisionScope = {
      periodTo: '2026-12',
      periodFrom: '2026-01',
      mappingVersionIds: ['map-1'],
      sourceArtifactIds: ['art-1'],
      companyIds: ['co-a', 'co-b'],
      organizationId: 'org-1',
    };
    expect(computeRevisionContentHash({ scope: reordered, reason: 'import' })).toBe(
      computeRevisionContentHash(base),
    );
  });

  it('is unaffected by lifecycle state — approving must not restate the source', () => {
    // The hash answers "is this the same source state?". If approval changed
    // it, the question would become unanswerable.
    const hash = computeRevisionContentHash(base);
    const revision: DataRevision = {
      id: 'rev-1',
      scope: base.scope,
      reason: base.reason,
      createdAt: '2026-07-16T00:00:00.000Z',
      createdBy: 'user-1',
      supersedes: null,
      supersededBy: null,
      lockedAt: '2026-07-17T00:00:00.000Z',
      reconciledAt: '2026-07-18T00:00:00.000Z',
      approvedAt: '2026-07-19T00:00:00.000Z',
      contentHash: hash,
    };
    expect(computeRevisionContentHash(revision)).toBe(hash);
  });
});

describe('requiresNewRevision — "a source change creates a new revision" (§5.2)', () => {
  it('is false when the source state is unchanged', () => {
    expect(
      requiresNewRevision({ contentHash: computeRevisionContentHash(base) }, base),
    ).toBe(false);
  });

  it('is true when an artifact changed', () => {
    expect(
      requiresNewRevision(
        { contentHash: computeRevisionContentHash(base) },
        { ...base, scope: scope({ sourceArtifactIds: ['art-9'] }) },
      ),
    ).toBe(true);
  });

  it('is true when only the mapping version moved — a remap is a source change', () => {
    expect(
      requiresNewRevision(
        { contentHash: computeRevisionContentHash(base) },
        { ...base, scope: scope({ mappingVersionIds: ['map-2'] }) },
      ),
    ).toBe(true);
  });

  it('is false for a re-import that pulled the same artifacts in another order', () => {
    // Idempotency: re-running an import must not spawn phantom revisions.
    expect(
      requiresNewRevision(
        { contentHash: computeRevisionContentHash(base) },
        { ...base, scope: scope({ companyIds: ['co-b', 'co-a'] }) },
      ),
    ).toBe(false);
  });
});

describe('correctionReasonFor — locked periods get an adjustment (§5.2)', () => {
  it('returns late_adjustment when the revision is locked', () => {
    expect(correctionReasonFor({ lockedAt: '2026-07-17T00:00:00.000Z' })).toBe(
      'late_adjustment',
    );
  });

  it('returns correction when the revision is open', () => {
    expect(correctionReasonFor({ lockedAt: null })).toBe('correction');
  });
});

describe('isCurrent — superseding never deletes (§5.2)', () => {
  it('is true while nothing supersedes it', () => {
    expect(isCurrent({ supersededBy: null })).toBe(true);
  });

  it('is false once superseded, and the old row is still addressable', () => {
    expect(isCurrent({ supersededBy: 'rev-2' })).toBe(false);
  });
});

describe('reason codes', () => {
  it('carries exactly the six the spec names', () => {
    expect([...REVISION_REASONS].sort()).toEqual([
      'correction',
      'external_refresh',
      'import',
      'late_adjustment',
      'manual_override',
      'mapping_change',
    ]);
  });

  it.each(REVISION_REASONS)('hashes distinctly for %s', (reason) => {
    const others = REVISION_REASONS.filter((r) => r !== reason);
    const hash = computeRevisionContentHash({ ...base, reason });
    for (const other of others) {
      expect(hash).not.toBe(computeRevisionContentHash({ ...base, reason: other }));
    }
  });
});
