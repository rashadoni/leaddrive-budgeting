/**
 * Phase 6 — Server-Sent Events stream for BullMQ job progress.
 *
 *   GET /api/queue/jobs/:jobId/progress
 *
 * Streams `event: progress\ndata: <0..100>\n\n` lines while the job
 * is active; closes with `event: complete` or `event: failed` once
 * the terminal state is reached.
 *
 * The frontend hook `useJobProgress(jobId)` consumes this — see
 * `src/hooks/useJobProgress.ts`.
 *
 * Implementation note: we use BullMQ's `QueueEvents` listener which
 * subscribes to Redis pub/sub for the queue. Per-request listener
 * binding is fine for the single-tenant volume here; for >100 concurrent
 * subscribers, switch to a shared QueueEvents singleton.
 */
import type { NextRequest } from "next/server"
import { QueueEvents } from "bullmq"
import { getSession } from "@/lib/api-auth"
import { getRedis } from "@/lib/queue/redis-client"
import { getQueues } from "@/lib/queue/queues"

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const session = await getSession(req)
  if (!session) return new Response("Unauthorized", { status: 401 })
  const { jobId } = await ctx.params
  if (!jobId) return new Response("jobId required", { status: 400 })

  // Probe both queues to find which one owns the job + locate its
  // QueueEvents stream.
  const queues = getQueues()
  let queueName: string | null = null
  for (const q of [queues.recomputePair, queues.recomputeBatch]) {
    const job = await q.getJob(jobId)
    if (job) {
      // Org-scope defence (mirrors GET sibling endpoint), and fails CLOSED
      // for the same reason — see the note there. A job with no tenant on its
      // payload is malformed on both of these queues, and this endpoint opens
      // a live SSE stream of its events, so guessing wrong is worse here than
      // on the one-shot GET.
      const data = job.data as { organizationId?: string }
      if (!data.organizationId || data.organizationId !== session.orgId) {
        return new Response("Forbidden", { status: 403 })
      }
      queueName = q.name
      break
    }
  }
  if (!queueName) return new Response("Job not found", { status: 404 })

  const events = new QueueEvents(queueName, { connection: getRedis() })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: string): void => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${data}\n\n`),
        )
      }
      // Emit an initial frame so the client doesn't think the stream is
      // dead before the first progress update.
      send("hello", JSON.stringify({ jobId }))

      const onProgress = (args: { jobId: string; data: unknown }): void => {
        if (args.jobId === jobId) {
          const v = typeof args.data === "number" ? args.data : 0
          send("progress", String(v))
        }
      }
      const onCompleted = ({
        jobId: jid,
        returnvalue,
      }: {
        jobId: string
        returnvalue: string
      }): void => {
        if (jid === jobId) {
          send("complete", returnvalue ?? "{}")
          cleanup()
        }
      }
      const onFailed = ({
        jobId: jid,
        failedReason,
      }: {
        jobId: string
        failedReason: string
      }): void => {
        if (jid === jobId) {
          send("failed", failedReason ?? "unknown error")
          cleanup()
        }
      }
      const cleanup = (): void => {
        events.off("progress", onProgress)
        events.off("completed", onCompleted)
        events.off("failed", onFailed)
        void events.close()
        controller.close()
      }
      events.on("progress", onProgress)
      events.on("completed", onCompleted)
      events.on("failed", onFailed)

      // Client disconnect: AbortSignal fires when the browser closes
      // the EventSource. Detach listeners so Redis pub/sub stops.
      req.signal.addEventListener("abort", cleanup)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
