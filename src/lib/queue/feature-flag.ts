/**
 * Phase 6 — runtime feature flag for the queue backend.
 *
 *   QUEUE_BACKEND=bullmq    → BullMQ + Redis (production target)
 *   QUEUE_BACKEND=inprocess → legacy in-process job-runner (default)
 *
 * Default is INPROCESS so the in-flight production path (FO Holding,
 * single-tenant) keeps working unchanged. Toggle to bullmq only after
 * the worker daemon is running (`scripts/run-worker.ts` + LaunchAgent).
 *
 * Read once per request — env var lookup is cheap but a top-level
 * constant would freeze at module-load time, breaking hot-reload in
 * dev when you change `.env`.
 */
export type QueueBackend = "bullmq" | "inprocess"

export function getQueueBackend(): QueueBackend {
  const v = String(process.env.QUEUE_BACKEND ?? "").toLowerCase()
  return v === "bullmq" ? "bullmq" : "inprocess"
}

/** Convenience for routes that need a single check rather than the
 *  enum. Mirrors the pattern in `cost-budget.ts`. */
export function isBullMqEnabled(): boolean {
  return getQueueBackend() === "bullmq"
}
