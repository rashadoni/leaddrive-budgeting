/**
 * In-memory sliding-window rate limiter.
 *
 * Single-process only — fine for dev and single-instance prod.
 * For horizontal scaling (multiple pods), swap to Redis-backed implementation
 * (planned in Phase 6 Scale). The public API (`checkRateLimit`) stays the same.
 */

import { NextRequest, NextResponse } from "next/server"

type Bucket = {
  timestamps: number[] // request timestamps within current window
}

const buckets = new Map<string, Bucket>()

// Cleanup stale buckets every 5 minutes to keep memory bounded
let cleanupStarted = false
function startCleanup() {
  if (cleanupStarted) return
  cleanupStarted = true
  setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000 // drop buckets untouched for 10 min
    for (const [key, b] of buckets) {
      if (b.timestamps.length === 0 || b.timestamps[b.timestamps.length - 1] < cutoff) {
        buckets.delete(key)
      }
    }
  }, 5 * 60 * 1000).unref?.()
}

export interface RateLimitConfig {
  /** Window size in ms (e.g. 60_000 for 1 min). */
  windowMs: number
  /** Max requests allowed within the window. */
  max: number
  /**
   * Opaque prefix so different endpoints don't share buckets
   * (e.g. "import-excel" vs "import-csv").
   */
  name: string
}

export interface RateLimitResult {
  ok: boolean
  /** Remaining requests in current window. */
  remaining: number
  /** Seconds until the oldest request in the window falls off. */
  retryAfterSec: number
}

/**
 * Identify caller: prefer orgId + userId when auth is available; fall back to IP.
 * Accepts a pre-resolved identity so callers decide whether to key by user or IP.
 */
export function checkRateLimit(identity: string, cfg: RateLimitConfig): RateLimitResult {
  startCleanup()
  const key = `${cfg.name}::${identity}`
  const now = Date.now()
  const windowStart = now - cfg.windowMs

  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = { timestamps: [] }
    buckets.set(key, bucket)
  }

  // Drop timestamps outside the window
  bucket.timestamps = bucket.timestamps.filter(t => t > windowStart)

  if (bucket.timestamps.length >= cfg.max) {
    const oldest = bucket.timestamps[0]
    const retryAfterSec = Math.max(1, Math.ceil((oldest + cfg.windowMs - now) / 1000))
    return { ok: false, remaining: 0, retryAfterSec }
  }

  bucket.timestamps.push(now)
  return { ok: true, remaining: cfg.max - bucket.timestamps.length, retryAfterSec: 0 }
}

/**
 * Extract client IP from Next.js request — best-effort.
 * Behind a proxy, expects `x-forwarded-for` to be set by the reverse proxy.
 */
export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0].trim()
  return req.headers.get("x-real-ip") || "unknown"
}

/**
 * Helper: enforce rate limit for an endpoint.
 * Returns a 429 response when the limit is exceeded, or `null` when the caller
 * is allowed to proceed. The caller passes the identity string (usually orgId,
 * userId, or IP depending on the endpoint's threat model).
 */
export function enforceRateLimit(
  identity: string,
  cfg: RateLimitConfig,
): NextResponse | null {
  const result = checkRateLimit(identity, cfg)
  if (result.ok) return null
  return NextResponse.json(
    {
      error: "Too many requests",
      message: `Rate limit exceeded. Retry in ${result.retryAfterSec}s.`,
      retryAfterSec: result.retryAfterSec,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSec),
        "X-RateLimit-Limit": String(cfg.max),
        "X-RateLimit-Remaining": "0",
      },
    },
  )
}
