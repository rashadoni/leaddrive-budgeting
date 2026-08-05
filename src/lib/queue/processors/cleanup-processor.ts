/**
 * Phase 1.4 (2026-05-26) — BullMQ adapter for the daily soft-delete
 * physical-purge cron.
 *
 * 2026-08-04: the work itself moved to `src/lib/cleanup/purge-run.ts`. This
 * file now only translates a BullMQ job payload into that call, because the
 * queue turned out to be the one thing production does not run — see the note
 * at the top of `purge-run.ts` and `/api/cron/cleanup-soft-deleted`.
 *
 * Failure behaviour is unchanged and lives in `runPurge`: a DB failure during
 * cleanup propagates (here, into BullMQ's attempts=2 retry policy per
 * queues.ts), while audit-log emission errors are swallowed so they cannot
 * reverse a cleanup that already happened.
 *
 * Multi-org note: today this runs as a single system-wide pass with
 * one audit event attributed to the first active organization (or the
 * explicit `organizationId` from job payload). When org-isolated
 * scheduling lands (Phase 6 multi-tenant scheduler), the payload's
 * `organizationId` becomes mandatory and the helper gains a `where`
 * clause.
 */

import type { Job } from "bullmq"
import type { CleanupSoftDeletedJob } from "../job-types"
import { runPurge, type PurgeRunResult } from "../../cleanup/purge-run"
import { prisma } from "../../prisma"

/** @deprecated Prefer `PurgeRunResult` — kept so existing callers/tests of
 *  this processor keep compiling. */
export type CleanupProcessorResult = PurgeRunResult

export async function processCleanupSoftDeleted(
  job: Job<CleanupSoftDeletedJob>,
): Promise<CleanupProcessorResult> {
  // 2026-08-04 — the work moved to `runPurge` so the HTTP cron route can
  // reach it without BullMQ. This wrapper is now only an adapter from a
  // BullMQ job payload; everything it used to do lives one call away.
  return runPurge(prisma, {
    cutoffMs: job.data.cutoffMs,
    organizationId: job.data.organizationId,
  })
}
