/**
 * Phase 10 / Stage F — provider-neutral external-source lineage contract.
 *
 * This module performs no network or database I/O. It turns evidence already
 * retrieved by a caller into an immutable SourceArtifact-shaped record and the
 * existing DataRevision input that can pin it. Every result is shadow-only;
 * there is intentionally no switch that can make external evidence
 * decision-grade.
 */

import { createHash } from 'node:crypto';
import type { RevisionScope } from './data-revision';
import { parsePeriodKey } from './period-context';

export type ExternalEvidenceUsage =
  | 'period_observation'
  | 'current_context';

export type HistoricalSnapshotCapability =
  | 'historical_snapshots'
  | 'current_only';

export interface BuildExternalSourceLineageInput {
  organizationId: string;
  /** Empty means organization-wide, matching RevisionScope. */
  companyIds: readonly string[];
  /** Provider-neutral stable source name, never a credential or URL. */
  sourceSystem: string;
  /** Stable dataset/feed name within the source system. */
  dataset: string;
  /** Public citation URL. Query strings, fragments and userinfo are rejected. */
  publicSourceUrl: string;
  /** SHA-256 of the exact response/file bytes retained by the caller. */
  contentSha256: string;
  /** Canonical UTC timestamp represented by the source observation/snapshot. */
  externalAsOf: string;
  /** Canonical UTC timestamp when the caller retrieved the evidence. */
  retrievedAt: string;
  usage: ExternalEvidenceUsage;
  historicalCapability: HistoricalSnapshotCapability;
  /** Stable adapter name and version; no implementation-specific secret data. */
  adapterId: string;
  adapterVersion: string;
  periodFrom: string;
  periodTo: string;
}

/**
 * SourceArtifact-shaped evidence. This is deliberately a pure contract: the
 * Prisma schema does not yet contain SourceArtifact, so this module must not
 * imply persistence that does not exist.
 */
export interface ExternalSourceArtifact {
  id: string;
  organizationId: string;
  companyIds: readonly string[];
  sourceSystem: string;
  dataset: string;
  publicSourceUrl: string;
  contentSha256: string;
  externalAsOf: string;
  retrievedAt: string;
  usage: ExternalEvidenceUsage;
  historicalCapability: HistoricalSnapshotCapability;
  shadowOnly: true;
  decisionEligible: false;
}

export interface ExternalSourceLineage {
  sourceArtifact: Readonly<ExternalSourceArtifact>;
  revision: Readonly<{
    scope: RevisionScope;
    reason: 'external_refresh';
  }>;
  /** Feed may enter shadow scoring; current-only context never may. */
  shadowScoringEligible: boolean;
  exclusionReason: 'current_context_only' | null;
  /** Pass verbatim to PeriodContext.externalAsOf. */
  externalAsOf: string;
  shadowOnly: true;
  decisionEligible: false;
}

const SHA256_RE = /^[a-f0-9]{64}$/;
const CANONICAL_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SAFE_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/**
 * Build a deterministic external artifact plus its existing DataRevision
 * scope. The artifact id hashes the public source identity, exact bytes and
 * externalAsOf, so refreshing changed evidence necessarily creates a new
 * revision without placing a URL (or any secret) in DataRevision arrays.
 */
export function buildExternalSourceLineage(
  input: BuildExternalSourceLineageInput,
): ExternalSourceLineage {
  const organizationId = requiredId('organizationId', input.organizationId);
  const companyIds = canonicalIds(input.companyIds);
  const sourceSystem = safeToken('sourceSystem', input.sourceSystem);
  const dataset = safeToken('dataset', input.dataset);
  const adapterId = safeToken('adapterId', input.adapterId);
  const adapterVersion = safeToken('adapterVersion', input.adapterVersion);
  const publicSourceUrl = safePublicUrl(input.publicSourceUrl);
  const contentSha256 = input.contentSha256.trim();
  if (!SHA256_RE.test(contentSha256)) {
    throw new Error('contentSha256 must be a lowercase 64-character SHA-256');
  }

  const externalAsOf = canonicalUtc('externalAsOf', input.externalAsOf);
  const retrievedAt = canonicalUtc('retrievedAt', input.retrievedAt);
  if (externalAsOf > retrievedAt) {
    throw new Error('externalAsOf cannot be later than retrievedAt');
  }

  const from = parsePeriodKey(input.periodFrom);
  const to = parsePeriodKey(input.periodTo);
  if (from.kind !== to.kind) {
    throw new Error('periodFrom and periodTo must use the same period kind');
  }
  if (from.start > to.start) {
    throw new Error('periodFrom must not be later than periodTo');
  }

  if (
    input.usage !== 'period_observation' &&
    input.usage !== 'current_context'
  ) {
    throw new Error('usage must be period_observation or current_context');
  }
  if (
    input.historicalCapability !== 'historical_snapshots' &&
    input.historicalCapability !== 'current_only'
  ) {
    throw new Error(
      'historicalCapability must be historical_snapshots or current_only',
    );
  }

  if (
    input.usage === 'period_observation' &&
    input.historicalCapability !== 'historical_snapshots'
  ) {
    throw new Error(
      'period_observation requires historical snapshot capability',
    );
  }
  if (
    input.usage === 'period_observation' &&
    new Date(externalAsOf) >= to.end
  ) {
    throw new Error('period observation externalAsOf falls after periodTo');
  }

  const artifactIdentity = JSON.stringify([
    ['organizationId', organizationId],
    ['companyIds', companyIds],
    ['sourceSystem', sourceSystem],
    ['dataset', dataset],
    ['publicSourceUrl', publicSourceUrl],
    ['contentSha256', contentSha256],
    ['externalAsOf', externalAsOf],
    ['usage', input.usage],
  ]);
  const artifactDigest = createHash('sha256')
    .update(artifactIdentity)
    .digest('hex');
  const artifactId = `external-artifact:${artifactDigest}`;
  const mappingVersionId = `external-adapter:${adapterId}@${adapterVersion}`;

  const sourceArtifact = Object.freeze({
    id: artifactId,
    organizationId,
    companyIds: Object.freeze([...companyIds]),
    sourceSystem,
    dataset,
    publicSourceUrl,
    contentSha256,
    externalAsOf,
    retrievedAt,
    usage: input.usage,
    historicalCapability: input.historicalCapability,
    shadowOnly: true as const,
    decisionEligible: false as const,
  });
  const scope = Object.freeze({
    organizationId,
    companyIds: sourceArtifact.companyIds,
    sourceArtifactIds: Object.freeze([artifactId]),
    mappingVersionIds: Object.freeze([mappingVersionId]),
    periodFrom: from.periodKey,
    periodTo: to.periodKey,
  });
  const revision = Object.freeze({
    scope,
    reason: 'external_refresh' as const,
  });
  const shadowScoringEligible = input.usage === 'period_observation';

  return Object.freeze({
    sourceArtifact,
    revision,
    shadowScoringEligible,
    exclusionReason: shadowScoringEligible
      ? null
      : ('current_context_only' as const),
    externalAsOf,
    shadowOnly: true as const,
    decisionEligible: false as const,
  });
}

function canonicalIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.map((id) => requiredId('companyId', id)))).sort();
}

function requiredId(name: string, raw: string): string {
  const value = raw.trim();
  if (!value || value.length > 191 || /\s/.test(value)) {
    throw new Error(`${name} must be a non-empty identifier without whitespace`);
  }
  return value;
}

function safeToken(name: string, raw: string): string {
  const value = raw.trim();
  if (!SAFE_TOKEN_RE.test(value)) {
    throw new Error(`${name} must be a stable credential-free token`);
  }
  return value;
}

function safePublicUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('publicSourceUrl must be an absolute HTTP(S) URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('publicSourceUrl must use HTTP(S)');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      'publicSourceUrl must not contain credentials, query strings or fragments',
    );
  }
  return url.toString();
}

function canonicalUtc(name: string, raw: string): string {
  if (!CANONICAL_UTC_RE.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new Error(`${name} must be a canonical UTC ISO timestamp`);
  }
  if (new Date(raw).toISOString() !== raw) {
    throw new Error(`${name} must be a real canonical UTC ISO timestamp`);
  }
  return raw;
}
