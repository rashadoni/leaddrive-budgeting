#!/usr/bin/env tsx
/**
 * Phase 6 — Worker process bootstrap.
 *
 * Long-running daemon that loads BullMQ workers and processes jobs
 * from Redis until SIGTERM. Run via:
 *
 *   npx tsx scripts/run-worker.ts
 *
 * Or via LaunchAgent — see `docs/QUEUE_RUNBOOK.md` for the plist.
 *
 * SIGTERM handling: workers gracefully close (allow in-flight jobs to
 * finish, then exit) so LaunchAgent restarts don't double-process.
 */
import "dotenv/config"
import { pingRedis, disconnectRedis } from "../src/lib/queue/redis-client"
import { buildAllWorkers } from "../src/lib/queue/worker-factory"
import { closeQueues } from "../src/lib/queue/queues"

async function main(): Promise<void> {
  console.log("[worker] starting…")
  const reachable = await pingRedis(5000)
  if (!reachable) {
    console.error(
      "[worker] FATAL: Redis not reachable at " +
        (process.env.REDIS_URL ?? "redis://127.0.0.1:6379"),
    )
    process.exit(1)
  }
  console.log("[worker] Redis OK — building workers")
  const workers = buildAllWorkers()
  console.log(
    `[worker] ${workers.length} workers running:`,
    workers.map((w) => w.name).join(", "),
  )

  // Graceful shutdown — let in-flight jobs finish (BullMQ Worker.close()
  // blocks until either the active job finishes OR the lockDuration
  // expires). Timeout after 60s so a stuck job doesn't pin the process.
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] received ${signal} — closing workers`)
    const closeAll = Promise.all(workers.map((w) => w.close()))
    const timeout = new Promise<void>((resolve) =>
      setTimeout(() => {
        console.warn("[worker] shutdown timeout (60s) — forcing exit")
        resolve()
      }, 60_000),
    )
    await Promise.race([closeAll, timeout])
    await closeQueues()
    await disconnectRedis()
    console.log("[worker] shutdown complete")
    process.exit(0)
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"))
  process.on("SIGINT", () => void shutdown("SIGINT"))

  // Keep the process alive — workers run on their own event loop but
  // node would exit if there's no other reference. Easiest pinning:
  // hourly health log.
  setInterval(() => {
    console.log(`[worker] heartbeat ${new Date().toISOString()}`)
  }, 60_000)
}

void main().catch((err) => {
  console.error("[worker] uncaught error:", err)
  process.exit(2)
})
