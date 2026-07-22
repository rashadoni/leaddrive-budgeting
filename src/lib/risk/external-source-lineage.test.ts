import { describe, expect, it } from 'vitest';
import { computeRevisionContentHash } from './data-revision';
import {
  buildExternalSourceLineage,
  type BuildExternalSourceLineageInput,
  type ExternalEvidenceUsage,
  type HistoricalSnapshotCapability,
} from './external-source-lineage';

const HASH_A = 'a'.repeat(64);

function input(
  over: Partial<BuildExternalSourceLineageInput> = {},
): BuildExternalSourceLineageInput {
  return {
    organizationId: 'org_1',
    companyIds: ['company_b', 'company_a'],
    sourceSystem: 'public-market-data',
    dataset: 'commodity-monthly-close',
    publicSourceUrl: 'https://example.com/public/history',
    contentSha256: HASH_A,
    externalAsOf: '2025-12-31T23:59:59.000Z',
    retrievedAt: '2026-07-21T12:00:00.000Z',
    usage: 'period_observation',
    historicalCapability: 'historical_snapshots',
    adapterId: 'commodity-history',
    adapterVersion: 'v1',
    periodFrom: '2025-01',
    periodTo: '2025-12',
    ...over,
  };
}

describe('buildExternalSourceLineage', () => {
  it('builds a frozen, tenant-scoped, shadow-only revision input', () => {
    const result = buildExternalSourceLineage(input());

    expect(result).toMatchObject({
      externalAsOf: '2025-12-31T23:59:59.000Z',
      shadowOnly: true,
      decisionEligible: false,
      shadowScoringEligible: true,
      exclusionReason: null,
      revision: { reason: 'external_refresh' },
    });
    expect(result.sourceArtifact).toMatchObject({
      organizationId: 'org_1',
      companyIds: ['company_a', 'company_b'],
      shadowOnly: true,
      decisionEligible: false,
    });
    expect(result.revision.scope).toEqual({
      organizationId: 'org_1',
      companyIds: ['company_a', 'company_b'],
      sourceArtifactIds: [result.sourceArtifact.id],
      mappingVersionIds: ['external-adapter:commodity-history@v1'],
      periodFrom: '2025-01',
      periodTo: '2025-12',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sourceArtifact)).toBe(true);
    expect(Object.isFrozen(result.revision.scope.companyIds)).toBe(true);

    expect(
      computeRevisionContentHash({
        scope: result.revision.scope,
        reason: result.revision.reason,
      }),
    ).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic under company order and duplicates', () => {
    const a = buildExternalSourceLineage(input());
    const b = buildExternalSourceLineage(
      input({ companyIds: ['company_a', 'company_b', 'company_a'] }),
    );
    expect(b.sourceArtifact.id).toBe(a.sourceArtifact.id);
    expect(b.revision.scope).toEqual(a.revision.scope);
  });

  it.each([
    ['changed bytes', { contentSha256: 'b'.repeat(64) }],
    ['changed external as-of', { externalAsOf: '2025-12-30T23:59:59.000Z' }],
    ['changed tenant', { organizationId: 'org_2' }],
    ['changed dataset', { dataset: 'weather-history' }],
  ] satisfies Array<[string, Partial<BuildExternalSourceLineageInput>]>) (
    'creates a different artifact for %s',
    (_label, change) => {
      const a = buildExternalSourceLineage(input());
      const b = buildExternalSourceLineage(input(change));
      expect(b.sourceArtifact.id).not.toBe(a.sourceArtifact.id);
    },
  );

  it('keeps current-only data as context and out of shadow scoring', () => {
    const result = buildExternalSourceLineage(
      input({
        usage: 'current_context',
        historicalCapability: 'current_only',
        externalAsOf: '2026-07-21T11:59:00.000Z',
      }),
    );
    expect(result.shadowScoringEligible).toBe(false);
    expect(result.exclusionReason).toBe('current_context_only');
    expect(result.decisionEligible).toBe(false);
  });

  it('rejects current-only evidence presented as a period observation', () => {
    expect(() =>
      buildExternalSourceLineage(
        input({ historicalCapability: 'current_only' }),
      ),
    ).toThrow('period_observation requires historical snapshot capability');
  });

  it('rejects a period observation whose external as-of is after the period', () => {
    expect(() =>
      buildExternalSourceLineage(
        input({ externalAsOf: '2026-01-01T00:00:00.000Z' }),
      ),
    ).toThrow('period observation externalAsOf falls after periodTo');
  });

  it.each([
    ['uppercase hash', { contentSha256: 'A'.repeat(64) }],
    ['future evidence', { externalAsOf: '2026-07-22T00:00:00.000Z' }],
    ['non-canonical time', { externalAsOf: '2025-12-31T23:59:59Z' }],
    ['URL credentials', { publicSourceUrl: 'https://user:pass@example.com/data' }],
    ['URL query secret', { publicSourceUrl: 'https://example.com/data?key=secret' }],
    ['credential-like token', { sourceSystem: 'feed key' }],
    ['reverse period', { periodFrom: '2026', periodTo: '2025' }],
    ['reverse overlapping period', { periodFrom: '2026', periodTo: '2026-01' }],
    ['unknown usage', { usage: 'confirmed' as ExternalEvidenceUsage }],
    [
      'unknown historical capability',
      { historicalCapability: 'sometimes' as HistoricalSnapshotCapability },
    ],
  ] satisfies Array<[string, Partial<BuildExternalSourceLineageInput>]>) (
    'fails closed for %s',
    (_label, change) => {
      expect(() => buildExternalSourceLineage(input(change))).toThrow();
    },
  );
});
