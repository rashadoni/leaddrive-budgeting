/**
 * Phase 6 — Queue admin REST.
 *
 *   GET /api/admin/queue?state=active|completed|failed|waiting
 *
 * Returns a flat list of jobs across all configured queues with state
 * + progress + timestamps + failedReason. Admin-only (manager+ rejected;
 * queues hold credentials-adjacent payloads via reason strings).
 *
 * 2026-08-04 — this route must never touch Redis unless BullMQ is
 * actually the configured backend. Production runs QUEUE_BACKEND unset
 * (→ `inprocess`) and its compose stack has no Redis service, so
 * `getQueues()` dialled 127.0.0.1:6379, ECONNREFUSED bubbled out of the
 * handler and every admin who opened /budgeting/admin/queue got a bare
 * HTTP 500. Worse than the 500: the ioredis singleton is module-scoped
 * with an unbounded retryStrategy, so one page visit pinned the app
 * process to a permanent reconnect loop that spammed the container log.
 * With the backend off there are no BullMQ jobs to list — say so.
 */
import { NextResponse, type NextRequest } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { getLogger } from "@/lib/log"
import { isBullMqEnabled } from "@/lib/queue/feature-flag"
import { getQueues } from "@/lib/queue/queues"

const logger = getLogger("api:admin-queue")

type QueueState = "waiting" | "active" | "completed" | "failed" | "delayed"

const ALLOWED_STATES: QueueState[] = [
  "waiting",
  "active",
  "completed",
  "failed",
  "delayed",
]

/** ioredis errors usually read `connect ECONNREFUSED host:port`, but an auth
 *  or DNS failure can echo the configured URL back — and REDIS_URL may carry
 *  `user:password@`. Strip the userinfo before it reaches a response body. */
function redactCredentials(message: string): string {
  return message.replace(/\/\/[^/@\s]*@/g, "//***@")
}

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

  // Backend off → answer without opening a Redis connection. 200 with an
  // empty list is the honest answer ("no BullMQ jobs exist"); `backend`
  // lets the UI explain why rather than render a bare empty table.
  if (!isBullMqEnabled()) {
    return NextResponse.json({
      state: stateParam,
      backend: "inprocess",
      count: 0,
      jobs: [],
    })
  }

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
  try {
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
  } catch (err) {
    // Redis is down / unreachable while BullMQ is switched on. That is an
    // infrastructure outage, not a bug in the request — 503 with the reason
    // beats a 500 the operator has to go read container logs to decode.
    const reason = err instanceof Error ? err.message : String(err)
    logger.error("queue read failed", { reason })
    return NextResponse.json(
      {
        error: "queue backend unavailable",
        backend: "bullmq",
        // Admin-only route, and the reason is the whole point of surfacing
        // it — but scrub any credentials a connection-string error carries.
        detail: redactCredentials(reason),
      },
      { status: 503 },
    )
  }
  // Newest first.
  rows.sort((a, b) => b.timestamp - a.timestamp)
  return NextResponse.json({
    state: stateParam,
    backend: "bullmq",
    count: rows.length,
    jobs: rows.slice(0, limit),
  })
}
