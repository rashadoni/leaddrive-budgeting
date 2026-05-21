/**
 * Phase 6 — Redis connection module.
 *
 * Single ioredis client reused across all queue + worker construction.
 * BullMQ requires `maxRetriesPerRequest: null` (otherwise blocking
 * commands like BRPOPLPUSH inside Worker get aborted after 20 retries
 * and the worker permanently dies — documented BullMQ requirement).
 *
 * URL precedence:
 *   1. `process.env.REDIS_URL` (e.g. redis://user:pass@host:6379)
 *   2. fallback `redis://127.0.0.1:6379` for local dev
 *
 * Singleton pattern so Queue + Worker + QueueScheduler instances share
 * one TCP connection per process. Tests should NOT import this — use
 * `ioredis-mock` directly to avoid leaking real connections.
 */
import IORedis, { type RedisOptions } from "ioredis"

let cached: IORedis | null = null

function buildConnection(): IORedis {
  const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379"
  // BullMQ-required overrides — see
  // https://docs.bullmq.io/guide/connections#blocking-operations
  const opts: RedisOptions = {
    // Don't auto-abort blocking commands (BullMQ uses BRPOPLPUSH on Workers)
    maxRetriesPerRequest: null,
    // Reconnect strategy: bounded exponential backoff so transient Redis
    // restarts don't pin CPU. Cap at 5s — anything longer means Redis is
    // genuinely down and we want loud monitoring to fire.
    retryStrategy: (times) => Math.min(times * 100, 5000),
    // Lazy connect — let BullMQ open the socket when it first needs it.
    // Removes startup-time crash class if Redis isn't yet running when
    // the Next.js process boots.
    lazyConnect: true,
    // Reasonable timeout — local dev should never need >2s; production
    // single-AZ should never need >5s. Anything slower = real outage.
    connectTimeout: 5000,
  }
  return new IORedis(url, opts)
}

/**
 * Get the shared Redis connection. Constructs on first call, returns
 * cached instance thereafter. Safe to call from anywhere — connection
 * is opened lazily on first command.
 */
export function getRedis(): IORedis {
  if (!cached) cached = buildConnection()
  return cached
}

/**
 * Health-check helper — returns `true` if Redis responds to PING within
 * the timeout. Used by `/api/health` + the worker bootstrap to fail
 * loud if Redis is down rather than queueing into a black hole.
 */
export async function pingRedis(timeoutMs = 2000): Promise<boolean> {
  const r = getRedis()
  return Promise.race([
    r.ping().then(() => true),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), timeoutMs),
    ),
  ])
}

/**
 * Graceful shutdown — called from worker process SIGTERM handler so
 * in-flight commands finish before the process exits. Next.js HTTP
 * route handlers don't need this (request lifecycle handles cleanup).
 */
export async function disconnectRedis(): Promise<void> {
  if (cached) {
    await cached.quit().catch(() => {
      /* swallow — connection may already be closed */
    })
    cached = null
  }
}
