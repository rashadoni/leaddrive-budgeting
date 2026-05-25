/**
 * Phase 6 — BullMQ Queue singletons.
 *
 * One module-scoped Queue per logical task type. Importing this file
 * does NOT start any workers — Queue is producer-only and lightweight.
 * Workers live in `worker-factory.ts` and only run inside the
 * dedicated worker process (scripts/run-worker.ts), NOT inside the
 * Next.js HTTP runtime.
 *
 * Default job options:
 *   • removeOnComplete: keep last 1000 (admin UI history)
 *   • removeOnFail: keep last 5000 (DLQ visibility — failed jobs are
 *     more important to retain than completed ones)
 *   • attempts: 3 with exponential backoff (Phase 8 may tighten per-queue)
 */
import { Queue, type JobsOptions, type RepeatOptions } from "bullmq"
import { getRedis } from "./redis-client"
import {
  QUEUE_NAMES,
  type RecomputePairJob,
  type RecomputeBatchJob,
  type ImportJob,
  type SparklineBackfillJob,
  type CleanupSoftDeletedJob,
} from "./job-types"

/** Shared default options applied to every job. Per-queue overrides
 *  layer on top (e.g. import jobs use a longer attempt count). */
const DEFAULT_JOB_OPTIONS: JobsOptions = {
  removeOnComplete: { count: 1000, age: 7 * 24 * 60 * 60 }, // 7 days
  removeOnFail: { count: 5000, age: 30 * 24 * 60 * 60 }, // 30 days
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 5000, // 5s, 10s, 20s
  },
}

// Lazy-initialised so importing this module from a Next.js route during
// SSG/SSR doesn't open a Redis connection at build time.
let cached: {
  recomputePair: Queue<RecomputePairJob>
  recomputeBatch: Queue<RecomputeBatchJob>
  import: Queue<ImportJob>
  sparkline: Queue<SparklineBackfillJob>
  cleanupSoftDeleted: Queue<CleanupSoftDeletedJob>
} | null = null

export function getQueues(): {
  recomputePair: Queue<RecomputePairJob>
  recomputeBatch: Queue<RecomputeBatchJob>
  import: Queue<ImportJob>
  sparkline: Queue<SparklineBackfillJob>
  cleanupSoftDeleted: Queue<CleanupSoftDeletedJob>
} {
  if (cached) return cached
  const connection = getRedis()
  cached = {
    recomputePair: new Queue<RecomputePairJob>(QUEUE_NAMES.recomputePair, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    recomputeBatch: new Queue<RecomputeBatchJob>(QUEUE_NAMES.recomputeBatch, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    import: new Queue<ImportJob>(QUEUE_NAMES.import, {
      connection,
      defaultJobOptions: {
        ...DEFAULT_JOB_OPTIONS,
        // Import jobs are larger + user-initiated — fail loud after 2
        // attempts so the UI can surface the diff instead of retrying
        // for 20s while the user wonders what's happening.
        attempts: 2,
      },
    }),
    sparkline: new Queue<SparklineBackfillJob>(QUEUE_NAMES.sparkline, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    cleanupSoftDeleted: new Queue<CleanupSoftDeletedJob>(
      QUEUE_NAMES.cleanupSoftDeleted,
      {
        connection,
        defaultJobOptions: {
          ...DEFAULT_JOB_OPTIONS,
          // Cleanup is idempotent; one retry is enough. More would
          // spam audit log on persistent failure (DB down, etc.).
          attempts: 2,
        },
      },
    ),
  }
  return cached
}

/** Convenience: enqueue a single recompute pair. Returns the job id
 *  the caller can use to subscribe to progress via SSE. */
export async function enqueueRecomputePair(
  payload: RecomputePairJob,
): Promise<string> {
  const q = getQueues().recomputePair
  const job = await q.add("recompute-pair", payload, {
    // Idempotency: same (org, company, year, indicatorCode) → same jobId
    // → BullMQ de-dupes within the retention window. Prevents a UI
    // double-click from queueing two recomputes of the same pair.
    jobId: `${payload.organizationId}:${payload.companyId}:${payload.year}:${payload.indicatorCode ?? "all"}`,
  })
  return job.id ?? ""
}

/** Bulk batch enqueue — used by orchestrator + admin "Refresh all". */
export async function enqueueRecomputeBatch(
  payload: RecomputeBatchJob,
): Promise<string> {
  const q = getQueues().recomputeBatch
  const job = await q.add("recompute-batch", payload)
  return job.id ?? ""
}

/** Phase 1.4 — schedule the daily soft-delete physical-purge cron.
 *  Called from the worker bootstrap (NOT from HTTP routes) so the job
 *  is registered exactly once per worker process. BullMQ deduplicates
 *  via the repeat key, so re-calling on worker restart is safe.
 *
 *  Default schedule: 03:00 UTC daily (off-peak for AZ-business-hour
 *  tenants — Baku is UTC+4, so 07:00 local). Override via
 *  `CLEANUP_CRON` env var (standard 5-field cron) for ops tuning.
 */
export const CLEANUP_DEFAULT_CRON = "0 3 * * *"
export const CLEANUP_REPEAT_KEY = "cleanup-soft-deleted-daily"

export async function scheduleCleanupCron(opts?: {
  cron?: string
}): Promise<void> {
  const q = getQueues().cleanupSoftDeleted
  const cron = opts?.cron ?? process.env.CLEANUP_CRON ?? CLEANUP_DEFAULT_CRON
  const repeat: RepeatOptions = { pattern: cron, tz: "UTC" }
  // BullMQ generates a stable repeat job id from the pattern; passing a
  // jobId lets us upsert idempotently across worker restarts.
  await q.add(
    "cleanup-soft-deleted",
    {},
    { repeat, jobId: CLEANUP_REPEAT_KEY },
  )
}

/** Async cleanup — used in tests + worker SIGTERM handler. */
export async function closeQueues(): Promise<void> {
  if (!cached) return
  await Promise.all([
    cached.recomputePair.close(),
    cached.recomputeBatch.close(),
    cached.import.close(),
    cached.sparkline.close(),
    cached.cleanupSoftDeleted.close(),
  ])
  cached = null
}
