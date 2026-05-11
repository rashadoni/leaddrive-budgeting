/**
 * Phase 6.1 — in-process async job runner for recompute fan-outs.
 *
 * BullMQ-style API without the Redis dep: a module-level Map tracks
 * job state, `enqueue()` returns a jobId immediately, the worker
 * function runs in setImmediate and reports progress via callback.
 *
 * Why in-process (not Redis/BullMQ): one client + one dev server +
 * one prod LaunchAgent + low-concurrency recompute (a CFO clicks
 * "Recompute" maybe 5 times/day) — the operational complexity of
 * running Redis is not yet justified. Migrate to BullMQ when:
 *   - Multiple Node processes need to share a job queue, OR
 *   - Job persistence across restarts becomes a customer requirement, OR
 *   - Scheduled / delayed / cron jobs land on the roadmap
 *
 * Trade-offs accepted:
 *   - Jobs lost on server restart (in-flight jobs orphaned). The
 *     IVs they already wrote are persisted in DB; the user just sees
 *     a stuck "running" status that times out. Acceptable for MVP.
 *   - Single-process worker — concurrent jobs run interleaved on
 *     the Node event loop (Prisma queries, not pure CPU, so this
 *     yields nicely under load).
 */

import { randomBytes } from "crypto"

export type JobStatus = "pending" | "running" | "succeeded" | "failed"

export interface JobState {
  jobId: string
  organizationId: string
  status: JobStatus
  total: number
  processed: number
  ok: number
  unknown: number
  errored: number
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  errorMessage: string | null
  /** Last 5 result lines, for tail display. */
  recentResults: Array<{
    companyCode: string
    indicatorCode: string
    status: string
    error?: string
  }>
}

export interface JobProgress {
  processed: number
  total: number
  result: {
    companyCode: string
    indicatorCode: string
    status: string
    error?: string
  }
}

/** Worker function signature. Reports per-pair progress; throws on
 *  unrecoverable errors (job marked failed). */
export type JobWorker = (
  state: JobState,
  reportProgress: (p: JobProgress) => void,
) => Promise<void>

const JOBS = new Map<string, JobState>()
/** Garbage-collect job state 1h after completion to bound memory. */
const RETAIN_MS = 60 * 60 * 1000

function newJobId(): string {
  return "job_" + randomBytes(6).toString("base64url")
}

export function enqueue(
  organizationId: string,
  total: number,
  worker: JobWorker,
): JobState {
  const job: JobState = {
    jobId: newJobId(),
    organizationId,
    status: "pending",
    total,
    processed: 0,
    ok: 0,
    unknown: 0,
    errored: 0,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
    recentResults: [],
  }
  JOBS.set(job.jobId, job)

  setImmediate(async () => {
    job.status = "running"
    job.startedAt = Date.now()
    try {
      await worker(job, (p) => {
        job.processed = p.processed
        if (p.result.status === "ok") job.ok += 1
        else if (p.result.status === "unknown") job.unknown += 1
        else if (p.result.status === "error") job.errored += 1
        job.recentResults.push(p.result)
        if (job.recentResults.length > 5) job.recentResults.shift()
      })
      job.status = "succeeded"
    } catch (err) {
      job.status = "failed"
      job.errorMessage = err instanceof Error ? err.message : String(err)
    } finally {
      job.finishedAt = Date.now()
      // Schedule GC.
      setTimeout(() => JOBS.delete(job.jobId), RETAIN_MS)
    }
  })

  return job
}

export function getJob(jobId: string, organizationId: string): JobState | null {
  const job = JOBS.get(jobId)
  if (!job) return null
  // Org-scope check: jobs are isolated per tenant.
  if (job.organizationId !== organizationId) return null
  return job
}

/** Test-only utility: clear all jobs. */
export function _clearAllJobsForTests(): void {
  JOBS.clear()
}
