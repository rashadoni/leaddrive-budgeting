/**
 * Phase 6 — Typed job payloads for BullMQ queues.
 *
 * Each `*Job` interface is the shape passed to `queue.add(name, data)`.
 * Processors receive `Job<JobX>` and can destructure `job.data` with
 * full type safety. Keep payloads SMALL (Redis stores serialised) —
 * pass IDs, not whole rows. Resolvers in the processor fetch heavy
 * data fresh from the DB.
 */

/** Recompute one (companyId, year) pair. Used for the per-pair fan-out
 *  the indicator POST route performs above SYNC_THRESHOLD=50 pairs. */
export interface RecomputePairJob {
  organizationId: string
  companyId: string
  year: number
  /** Optional indicator code filter — when set, only that indicator
   *  recomputes for the pair. Omit to recompute all indicators. */
  indicatorCode?: string
  /** Audit context — surfaced in queue admin UI + DLQ row. */
  actorUserId?: string
  /** Tagged with reason for observability (e.g. "ai-multi-import"). */
  reason?: string
}

/** Bulk recompute for a list of companies + a year. Used by the
 *  multi-file orchestrator + the manual "Refresh all" admin action. */
export interface RecomputeBatchJob {
  organizationId: string
  /** List of (companyId, year) pairs to recompute. */
  targets: ReadonlyArray<{ companyId: string; year: number }>
  actorUserId?: string
  reason?: string
}

/** Multi-file AI import job — wraps the existing `runMultiFileImport`
 *  orchestrator behind the queue so progress streams to UI + restarts
 *  are durable. */
export interface ImportJob {
  organizationId: string
  /** File payloads serialised as base64 — the queue's job payload size
   *  limit is 512KB Redis-default, so callers MUST chunk if any file
   *  exceeds ~400KB. For now we assume small/medium files (typical
   *  AzerSheker workbooks ~50KB-2MB before base64). */
  files: ReadonlyArray<{ filename: string; base64: string }>
  year: number
  apply: boolean
  forceOverride?: boolean
  conflictResolutions?: Record<
    string,
    { mode: "pick"; filename: string } | { mode: "skip" }
  >
  actorUserId?: string
}

/** Sparkline backfill job — recomputes the 12-slot trailing sparkline
 *  on every IndicatorValue. Heavy operation, infrequent. */
export interface SparklineBackfillJob {
  organizationId: string
  actorUserId?: string
}

/** Phase 1.4 (2026-05-26) — daily cron that physically removes
 *  soft-deleted rows past the 30-day retention. Payload is empty for
 *  the scheduled run (helper defaults cover both cutoff + scope); the
 *  optional `cutoffMs` lets ad-hoc admin invocations override the
 *  retention. The optional `organizationId` is for the audit event
 *  (system runs use the first active org until a multi-org variant
 *  lands; see processor docstring). */
export interface CleanupSoftDeletedJob {
  cutoffMs?: number
  organizationId?: string
}

/** Discriminated union for the admin UI / DLQ rows that need to inspect
 *  job payloads without knowing the specific queue. */
export type AnyJob =
  | { kind: "recompute-pair"; data: RecomputePairJob }
  | { kind: "recompute-batch"; data: RecomputeBatchJob }
  | { kind: "import"; data: ImportJob }
  | { kind: "sparkline-backfill"; data: SparklineBackfillJob }
  | { kind: "cleanup-soft-deleted"; data: CleanupSoftDeletedJob }

/** Queue names — used as Redis key prefix. Keep stable for production
 *  durability (renaming abandons in-flight jobs). */
export const QUEUE_NAMES = {
  recomputePair: "recompute-pair",
  recomputeBatch: "recompute-batch",
  import: "import",
  sparkline: "sparkline-backfill",
  cleanupSoftDeleted: "cleanup-soft-deleted",
} as const

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]
