/**
 * Phase 6 — Worker factory.
 *
 * Constructs BullMQ Worker instances bound to a processor function.
 * Workers are ONLY instantiated by the dedicated worker process
 * (scripts/run-worker.ts) — never by Next.js HTTP routes. Importing
 * this file from a route is harmless (constructors lazy); calling
 * `buildAllWorkers()` from a route is a bug (would spawn workers in
 * the Next.js process and double-process jobs).
 */
import { Worker, type WorkerOptions } from "bullmq"
import { getRedis } from "./redis-client"
import { QUEUE_NAMES } from "./job-types"
import {
  processRecomputePair,
  processRecomputeBatch,
} from "./processors/recompute-processor"
import { processCleanupSoftDeleted } from "./processors/cleanup-processor"
import { scheduleCleanupCron } from "./queues"
import { getLogger } from "@/lib/log"

const logger = getLogger("worker:factory")

/** Default per-worker concurrency. 4 = matches our 60-company target
 *  scale without saturating the Postgres pool (Prisma defaults to 10
 *  connections; recompute can run 2-3 queries in parallel internally). */
const DEFAULT_CONCURRENCY = 4

/** Default WorkerOptions applied to every worker. */
function baseOpts(): WorkerOptions {
  return {
    connection: getRedis(),
    concurrency: DEFAULT_CONCURRENCY,
    // Lock auto-renewal: extend the lock every 15s so long recomputes
    // (~30s) don't lose their lock and trigger a duplicate run.
    lockDuration: 30_000,
    lockRenewTime: 15_000,
  }
}

/** Build and return all workers. Caller is responsible for awaiting
 *  `worker.close()` on SIGTERM. */
export function buildAllWorkers(): Worker[] {
  const workers: Worker[] = [
    new Worker(QUEUE_NAMES.recomputePair, processRecomputePair, baseOpts()),
    new Worker(QUEUE_NAMES.recomputeBatch, processRecomputeBatch, baseOpts()),
    // Phase 1.4 — daily soft-delete physical-purge worker. Concurrency
    // 1 (job is idempotent + infrequent; one runner is enough). The
    // scheduled job is enqueued separately via `scheduleCleanupCron`
    // below — registering the Worker just makes Redis-side dispatch
    // route the repeating job to a processor.
    new Worker(QUEUE_NAMES.cleanupSoftDeleted, processCleanupSoftDeleted, {
      ...baseOpts(),
      concurrency: 1,
    }),
    // import + sparkline workers wire up in Phase 5+
  ]
  // Attach lightweight event logging so operators see job lifecycle
  // in stdout (LaunchAgent log). Detailed admin UI lives in Phase 9.
  for (const w of workers) {
    w.on("completed", (job) =>
      logger.info("job completed", {
        worker: w.name,
        jobId: job.id,
        durationMs: Date.now() - job.timestamp,
      }),
    )
    w.on("failed", (job, err) =>
      logger.error("job failed", {
        worker: w.name,
        jobId: job?.id,
        reason: err.message,
      }),
    )
    w.on("error", (err) =>
      logger.error("worker error", {
        worker: w.name,
        reason: err.message,
      }),
    )
  }

  // Phase 1.4 — register the daily 03:00-UTC cleanup repeat job. Safe
  // to call on every worker restart: BullMQ upserts by repeat key.
  // Fire-and-forget — a Redis blip during bootstrap shouldn't crash
  // the whole worker process; the next restart will re-register.
  void scheduleCleanupCron().catch((err: unknown) => {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error("failed to schedule daily cleanup cron", { reason })
  })

  return workers
}
