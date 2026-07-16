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
  const { scope, reason } = input;
  const contentHash = computeRevisionContentHash({ scope, reason });

  const existing = await prisma.dataRevision.findFirst({
    where: { organizationId: scope.organizationId, contentHash },
    select: { id: true },
  });
  if (existing) return { id: existing.id, contentHash, created: false };

  // Resolve the actor only on the create path — an existing revision already
  // recorded its author, and a re-import must never rewrite it (a revision is
  // immutable). This also spares the dedup path a `users` lookup.
  const createdById = await resolveActor(prisma, input.createdById);

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
        // Resolved against the nullable/SetNull contract just above.
        createdById,
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

/**
 * Resolve the actor to record, honouring `createdById`'s nullable/SetNull
 * contract instead of quietly turning it into a mandatory FK.
 *
 * The schema says a revision may have no author: `createdById String?` with
 * `onDelete: SetNull`, because cron and script paths legitimately have none.
 * But an insert naming a user who no longer exists is a P2003 — and since the
 * revision is written inside the import's transaction, that would roll back a
 * financial import because the person who started it was deleted mid-request.
 * A vanished author is a fact about the author, not a reason to reject the
 * data, and the schema already says how to record it: null.
 *
 * So an author is recorded when the author still exists, and dropped when they
 * do not — which is precisely what `SetNull` would do a moment later anyway.
 *
 * **Residual race, stated rather than papered over:** the user could be deleted
 * between this check and the insert. The window is one statement inside a
 * transaction, and the outcome if it lost would be the pre-existing behaviour
 * (P2003 → rollback), not a corrupt revision. Closing it entirely needs an FK
 * lock on `users`, which would make imports contend on user rows — a worse
 * trade than the window it removes.
 */
async function resolveActor(
  prisma: PrismaClient | Prisma.TransactionClient,
  createdById: string | null | undefined,
): Promise<string | null> {
  if (!createdById) return null;
  const actor = await prisma.user.findUnique({
    where: { id: createdById },
    select: { id: true },
  });
  return actor ? actor.id : null;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2002'
  );
}
