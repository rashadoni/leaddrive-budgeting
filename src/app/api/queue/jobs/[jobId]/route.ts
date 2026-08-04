/**
 * Phase 6 — BullMQ job status endpoint.
 *
 *   GET /api/queue/jobs/:jobId
 *
 * Mirrors the response shape of the legacy `/api/recompute/jobs/[jobId]`
 * route so the existing UI polling helper works against either backend
 * without code changes.
 *
 * Returns 404 when the job has been evicted from Redis (default
 * retention: 1000 completed, 5000 failed — see queues.ts).
 */
import { NextResponse, type NextRequest } from "next/server"
import { getSession } from "@/lib/api-auth"
import { isBullMqEnabled } from "@/lib/queue/feature-flag"
import { getQueues } from "@/lib/queue/queues"

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  const session = await getSession(req)
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { jobId } = await ctx.params
  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 })
  }
  // BullMQ off (prod default) → no Redis, so no job by this id exists.
  // Answering 404 here keeps a stray poll from opening a connection to a
  // Redis that isn't deployed; see the note in /api/admin/queue/route.ts.
  if (!isBullMqEnabled()) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }
  const queues = getQueues()
  // The same jobId might live on either recompute-pair or recompute-batch
  // queue (we don't know upfront). Probe both.
  const job =
    (await queues.recomputePair.getJob(jobId)) ??
    (await queues.recomputeBatch.getJob(jobId))
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }
  // Defence: ensure the job belongs to the caller's org. The org id is
  // embedded in the job payload (passed by callers in enqueueRecompute*).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // Phase 12 / A04 (2026-08-02) — FAIL CLOSED.
  //
  // This read `if (data.organizationId && data.organizationId !== orgId)`,
  // so a job whose payload happened to carry no organizationId was readable
  // by any authenticated user of any tenant. The guard's correctness rested
  // entirely on every enqueue site remembering the field — which the comment
  // above it admitted ("passed by callers in enqueueRecompute*").
  //
  // It matters more than it looks, because BullMQ job ids are guessable:
  // `recomputePair` builds them from org/company/year and `recomputeBatch`
  // takes Redis' sequential counter. The response carries `failedReason` and
  // `result`, which name companies and counts.
  //
  // Closing it costs nothing: both queues this route probes declare
  // `organizationId: string` as REQUIRED (`job-types.ts` —
  // RecomputePairJob, RecomputeBatchJob). The only optional-org payload is
  // CleanupSoftDeletedJob, which lives on a queue this route never touches.
  // So a job here with no org is malformed, and the honest answer to
  // "whose is this?" is to refuse rather than to guess it is yours.
  const data = job.data as { organizationId?: string }
  if (!data.organizationId || data.organizationId !== session.orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const state = await job.getState()
  return NextResponse.json({
    jobId: job.id,
    state, // "waiting" | "active" | "completed" | "failed" | "delayed" | "paused"
    progress: typeof job.progress === "number" ? job.progress : 0,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason ?? null,
    result: state === "completed" ? job.returnvalue : null,
    timestamp: job.timestamp,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
  })
}
