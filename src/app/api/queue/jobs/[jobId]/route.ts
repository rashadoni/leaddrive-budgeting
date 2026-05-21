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
  const data = job.data as { organizationId?: string }
  if (data.organizationId && data.organizationId !== session.orgId) {
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
