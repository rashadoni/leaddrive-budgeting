/**
 * Phase 6 — Queue admin REST.
 *
 *   GET /api/admin/queue?state=active|completed|failed|waiting
 *
 * Returns a flat list of jobs across all configured queues with state
 * + progress + timestamps + failedReason. Admin-only (manager+ rejected;
 * queues hold credentials-adjacent payloads via reason strings).
 */
import { NextResponse, type NextRequest } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { getQueues } from "@/lib/queue/queues"

type QueueState = "waiting" | "active" | "completed" | "failed" | "delayed"

const ALLOWED_STATES: QueueState[] = [
  "waiting",
  "active",
  "completed",
  "failed",
  "delayed",
]

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await requireRole(req, "admin")
  if (isAuthError(session)) return session

  const url = new URL(req.url)
  const stateParam = (url.searchParams.get("state") ?? "active") as QueueState
  if (!ALLOWED_STATES.includes(stateParam)) {
    return NextResponse.json(
      { error: `state must be one of ${ALLOWED_STATES.join(", ")}` },
      { status: 400 },
    )
  }
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)),
  )

  const queues = getQueues()
  const allQueues = [
    queues.recomputePair,
    queues.recomputeBatch,
    queues.import,
    queues.sparkline,
  ]
  const rows: Array<{
    queue: string
    jobId: string
    state: QueueState
    progress: number
    attemptsMade: number
    failedReason: string | null
    timestamp: number
    processedOn: number | null
    finishedOn: number | null
    organizationId: string | null
  }> = []
  for (const q of allQueues) {
    const jobs = await q.getJobs([stateParam], 0, limit - 1, false)
    for (const j of jobs) {
      const data = (j.data ?? {}) as { organizationId?: string }
      // Per-org filter: admin sees only their own org's jobs unless
      // explicitly cross-org (we don't expose cross-org today).
      if (data.organizationId && data.organizationId !== session.orgId) {
        continue
      }
      rows.push({
        queue: q.name,
        jobId: j.id ?? "",
        state: stateParam,
        progress: typeof j.progress === "number" ? j.progress : 0,
        attemptsMade: j.attemptsMade,
        failedReason: j.failedReason ?? null,
        timestamp: j.timestamp,
        processedOn: j.processedOn ?? null,
        finishedOn: j.finishedOn ?? null,
        organizationId: data.organizationId ?? null,
      })
    }
  }
  // Newest first.
  rows.sort((a, b) => b.timestamp - a.timestamp)
  return NextResponse.json({
    state: stateParam,
    count: rows.length,
    jobs: rows.slice(0, limit),
  })
}
