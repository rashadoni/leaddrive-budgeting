/**
 * Phase 7.M Tier 7 Phase 6 (2026-05-21) — deprecation-header helper.
 *
 * RFC 8594 (Sunset) + RFC 9745 (Deprecation) + RFC 8288 (Link
 * successor-version) — standard HTTP signals telling clients a route is
 * deprecated and where to migrate. Applied to /api/operational-facts/import
 * and /api/budgeting/import-csv during the AI-Import consolidation —
 * routes stay functional (UI surfaces still call them) but advertise
 * their replacement path.
 *
 * Usage:
 *
 *   import { applyDeprecationHeaders } from "@/lib/api-deprecation"
 *   ...
 *   const response = NextResponse.json(...)
 *   applyDeprecationHeaders(response, {
 *     replacedBy: "/api/import/ai-auto-multi",
 *   })
 *   return response
 *
 * For routes that wrap many internal returns, prefer the `withDeprecation`
 * HOF — it walks the response after the handler runs and stamps headers
 * once at the edge.
 */
import type { NextRequest, NextResponse } from "next/server"

export interface DeprecationOpts {
  /** URL of the replacement endpoint (Link rel="successor-version"). */
  replacedBy: string
  /**
   * RFC 8594 sunset date — when this route will (or did) stop accepting
   * requests. Defaults to the Phase 7.M Tier 7 deprecation date.
   * Format: HTTP-date (RFC 7231).
   */
  sunset?: string
  /**
   * Human-readable note appended to logs / X-Deprecation-Reason header.
   * Should explain why the route is deprecated + how to migrate.
   */
  reason?: string
}

const DEFAULT_SUNSET = "Thu, 21 May 2026 00:00:00 GMT"

/**
 * Mutate a NextResponse / Response in place — stamp standard
 * deprecation headers onto it. Safe to call multiple times (overwrites
 * existing values).
 */
export function applyDeprecationHeaders(
  response: NextResponse | Response,
  opts: DeprecationOpts,
): void {
  const headers = response.headers
  headers.set("Sunset", opts.sunset ?? DEFAULT_SUNSET)
  headers.set("Deprecation", "true")
  headers.set("Link", `<${opts.replacedBy}>; rel="successor-version"`)
  headers.set("X-Replaced-By", opts.replacedBy)
  if (opts.reason) {
    headers.set("X-Deprecation-Reason", opts.reason)
  }
}

/**
 * Wrap an async Next.js route handler with automatic deprecation-header
 * stamping. Useful for legacy routes with many internal return points —
 * caller defines the handler, this HOF intercepts the response and adds
 * the headers once at the edge.
 *
 * Example:
 *
 *   export const POST = withDeprecation({
 *     replacedBy: "/api/import/ai-auto-multi",
 *     reason: "use AI Import — recognises OPS_FACTS shape",
 *   })(async function originalPost(req) {
 *     ...existing handler logic with multiple returns...
 *   })
 */
export function withDeprecation(opts: DeprecationOpts) {
  return <
    H extends (
      req: NextRequest,
      ctx?: unknown,
    ) => Promise<NextResponse | Response>,
  >(
    handler: H,
  ): H => {
    return (async (req: NextRequest, ctx?: unknown) => {
      const response = await handler(req, ctx)
      applyDeprecationHeaders(response, opts)
      return response
    }) as H
  }
}
