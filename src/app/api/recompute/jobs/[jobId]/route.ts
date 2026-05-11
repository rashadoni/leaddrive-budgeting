/**
 * Phase 6.1 — recompute job status endpoint.
 *
 * GET /api/recompute/jobs/[jobId] — returns current job state for the
 * caller's org. 404 on cross-tenant or unknown jobId (never leak existence).
 *
 * Used by the UI to poll a long-running async recompute kicked off via
 * POST /api/indicators.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { getJob } from "@/lib/recompute/job-runner"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const session = await requireAuth(request)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }

  const { jobId } = await params
  if (typeof jobId !== "string" || jobId.trim() === "") {
    return NextResponse.json({ error: "Invalid jobId" }, { status: 400 })
  }

  const job = getJob(jobId, session.orgId)
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  return NextResponse.json({
    jobId: job.jobId,
    status: job.status,
    total: job.total,
    processed: job.processed,
    ok: job.ok,
    unknown: job.unknown,
    errored: job.errored,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    errorMessage: job.errorMessage,
    recentResults: job.recentResults,
    progressPct: job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0,
  })
}
