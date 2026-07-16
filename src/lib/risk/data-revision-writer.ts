/**
 * Phase 10 / Stage B5 — the one way a DataRevision is created.
 *
 * `ensureDataRevision` upserts on the revision's deterministic content hash, so
 * pinning the same source state twice returns the same row rather than a second
 * one (03-DATA-KPI-TRUST-SPEC §5.2 — "a source change creates a new revision",
 * read in its contrapositive: an unchanged source state creates nothing).
 *
 * **Transaction safety is the caller's to establish, and this helper's to
 * respect.** Pass the same client to `ensureDataRevision` and to
 * `createPrismaDataSource` inside one `withOrgScope`/`$transaction`, and the
 * revision and the observations it explains commit or roll back together —
 * there is no window where an IndicatorValue points at a revision that was
 * never committed, nor a revision left orphaned by a failed write.
 *
 * This helper does not write observations and knows nothing about values. The
 * `revisionId` is stamped onto an IndicatorValue in exactly one place —
 * `createPrismaDataSource().upsertIndicatorValue` — which independently
 * verifies the revision belongs to the caller's organization.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import {
  computeRevisionContentHash,
  type RevisionReason,
  type RevisionScope,
} from './data-revision';

export interface EnsureDataRevisionInput {
  scope: RevisionScope;
  reason: RevisionReason;
  /** User id, or null/undefined for a cron/script/system path. */
  createdById?: string | null;
}

export interface EnsuredRevision {
  id: string;
  contentHash: string;
  /** False when an identical revision already existed — i.e. nothing moved. */
  created: boolean;
}

/**
 * Find-or-create the revision pinning this source state.
 *
 * @param prisma A client or transaction client. Pass the caller's `tx` to keep
 *   the revision and its observations atomic.
 */
export async function ensureDataRevision(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: EnsureDataRevisionInput,
): Promise<EnsuredRevision> {
  const { scope, reason, createdById } = input;
  const contentHash = computeRevisionContentHash({ scope, reason });

  const existing = await prisma.dataRevision.findFirst({
    where: { organizationId: scope.organizationId, contentHash },
    select: { id: true },
  });
  if (existing) return { id: existing.id, contentHash, created: false };

  try {
    const created = await prisma.dataRevision.create({
      data: {
        organizationId: scope.organizationId,
        // Copy the id arrays: they are the writer's, and a revision is
        // immutable once written.
        companyIds: [...scope.companyIds],
        sourceArtifactIds: [...scope.sourceArtifactIds],
        mappingVersionIds: [...scope.mappingVersionIds],
        periodFrom: scope.periodFrom,
        periodTo: scope.periodTo,
        reason,
        createdById: createdById ?? null,
        contentHash,
      },
      select: { id: true },
    });
    return { id: created.id, contentHash, created: true };
  } catch (err) {
    // The find-then-create above is not atomic; a concurrent writer can land
    // between the two. The unique (organizationId, contentHash) index is what
    // actually arbitrates, and the loser reads the winner's row rather than
    // failing. Only P2002 is swallowed — any other error is a real fault.
    //
    // NOTE: inside a transaction this recovery cannot work — Postgres aborts
    // the whole tx on a constraint violation, so the re-read would fail too.
    // That is the correct outcome for a tx: it rolls back and the caller
    // retries. The recovery matters for non-transactional callers.
    if (isUniqueViolation(err)) {
      const won = await prisma.dataRevision.findFirst({
        where: { organizationId: scope.organizationId, contentHash },
        select: { id: true },
      });
      if (won) return { id: won.id, contentHash, created: false };
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2002'
  );
}
