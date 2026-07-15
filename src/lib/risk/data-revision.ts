/**
 * Phase 10 / Stage B2 — the DataRevision contract.
 *
 * 03-DATA-KPI-TRUST-SPEC §5: a revision is the exact source/mapping state a
 * downstream calculation used. ADR Trust Core §4: DataRevision is immutable and
 * recompute is exact and idempotent.
 *
 * The point of a revision is to make one question answerable: *given this
 * number on screen, exactly which sources and mappings produced it, and has
 * anything moved since?* Today that question has no answer — 0 of 1,269
 * `IndicatorValue` rows carry any lineage (measured 2026-07-16, see A5), which
 * is why every coloured cell is `provisional`. This contract is the shape of
 * the answer.
 *
 * **Scope: contract + hash only.** There is deliberately no Prisma model here.
 * Persisting revisions is additive schema work, and every sibling table in this
 * database carries RLS policies — adding one without them would risk exactly
 * the cross-org exposure the rollout doc lists as an immediate rollback
 * trigger. That belongs in its own reviewed slice, not appended to this one.
 *
 * Nothing here computes money. A revision describes provenance.
 */

import { createHash } from 'node:crypto';

/**
 * §5.1's reason codes, verbatim. A revision always says *why* it exists —
 * "the number changed" is not an acceptable audit answer; "a late adjustment
 * landed against a locked period" is.
 */
export type RevisionReason =
  | 'import'
  | 'correction'
  | 'mapping_change'
  | 'late_adjustment'
  | 'external_refresh'
  | 'manual_override';

export const REVISION_REASONS: readonly RevisionReason[] = [
  'import',
  'correction',
  'mapping_change',
  'late_adjustment',
  'external_refresh',
  'manual_override',
] as const;

/**
 * The identifiers a revision pins. Everything here is an opaque id supplied by
 * the writer — this module never infers provenance, per the ADR's rule that the
 * writer declares and the reader never guesses.
 */
export interface RevisionScope {
  organizationId: string;
  /** Companies in scope. Empty means org-wide. Order is not significant. */
  companyIds: readonly string[];
  /** Source batch / artifact ids (import batches, uploaded workbooks, feeds). */
  sourceArtifactIds: readonly string[];
  /** Mapping / CoA / adapter version identifiers in force for this revision. */
  mappingVersionIds: readonly string[];
  /** Inclusive period range this revision speaks for, as period keys. */
  periodFrom: string;
  periodTo: string;
}

/** §5.1's required fields. */
export interface DataRevision {
  id: string;
  scope: RevisionScope;
  reason: RevisionReason;
  createdAt: string;
  /** User id, or null when a cron/script/system path created it. */
  createdBy: string | null;
  /** Revision this one replaces, if any. */
  supersedes: string | null;
  /** Set when a later revision replaced this one. Null means current. */
  supersededBy: string | null;
  lockedAt: string | null;
  reconciledAt: string | null;
  approvedAt: string | null;
  /** Deterministic fingerprint of `scope` + `reason`. See below. */
  contentHash: string;
}

/**
 * Deterministic content hash — SHA-256 over a canonical serialization.
 *
 * Strategy deliberately matches `src/lib/budgeting/period-snapshot.ts`
 * (sorted-key canonical JSON → SHA-256) so this database has **one** hashing
 * convention rather than two that drift apart.
 *
 * Canonicalisation rules, and why each exists:
 * - **Id arrays are sorted and de-duplicated.** Two imports that pulled the
 *   same artifacts in a different order are the same source state; a hash that
 *   disagreed would spawn phantom revisions on every run.
 * - **Field order is fixed by construction**, not by `JSON.stringify` of an
 *   object literal — key order would otherwise silently encode authoring order.
 * - **Identity fields are excluded**: `id`, `createdAt`, `createdBy`,
 *   `supersedes`/`supersededBy` and the lock/reconcile/approve timestamps are
 *   *about* the revision, not the source state it pins. Including them would
 *   make the hash unable to answer its one question — "is this the same source
 *   state?" — because approving a revision would change its content hash.
 *
 * Consequence, stated plainly: two revisions with an identical hash pin an
 * identical source/mapping state. They may still be distinct rows (a
 * re-import that changed nothing is a real event worth recording); the hash is
 * how you know nothing moved.
 */
export function computeRevisionContentHash(
  input: Pick<DataRevision, 'scope' | 'reason'>,
): string {
  const { scope, reason } = input;
  const canonical = JSON.stringify([
    ['organizationId', scope.organizationId],
    ['companyIds', normalizeIds(scope.companyIds)],
    ['sourceArtifactIds', normalizeIds(scope.sourceArtifactIds)],
    ['mappingVersionIds', normalizeIds(scope.mappingVersionIds)],
    ['periodFrom', scope.periodFrom],
    ['periodTo', scope.periodTo],
    ['reason', reason],
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** Sorted + de-duplicated: set semantics, not list semantics. */
function normalizeIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids)).sort();
}

/**
 * §5.2: "A source change creates a new revision." True exactly when the pinned
 * source state differs — which is what the content hash exists to decide.
 */
export function requiresNewRevision(
  current: Pick<DataRevision, 'contentHash'>,
  next: Pick<DataRevision, 'scope' | 'reason'>,
): boolean {
  return current.contentHash !== computeRevisionContentHash(next);
}

/**
 * §5.2: "A locked-period correction creates an adjustment revision. They do not
 * silently mutate the approved snapshot."
 *
 * Returns the reason a correction against this revision must carry. A locked
 * revision cannot be edited in place, so its correction is a `late_adjustment`
 * — a new revision that supersedes it and leaves the approved snapshot intact
 * and queryable.
 */
export function correctionReasonFor(
  revision: Pick<DataRevision, 'lockedAt'>,
): RevisionReason {
  return revision.lockedAt ? 'late_adjustment' : 'correction';
}

/**
 * §5.2: "Old observations remain queryable." A revision is current only while
 * nothing has superseded it; superseding never deletes.
 */
export function isCurrent(
  revision: Pick<DataRevision, 'supersededBy'>,
): boolean {
  return revision.supersededBy === null;
}
