/**
 * Next.js instrumentation hook (App Router, Next 16). Next calls `register()`
 * once per server runtime at startup; we lazy-import the matching Sentry init
 * so the Node SDK never loads in the edge runtime and vice-versa.
 *
 * Phase 8 G2 (2026-05-29) — Sentry wired DSN-ready. The init files are
 * DSN-gated, so this is a no-op until `SENTRY_DSN` is set. `onRequestError`
 * lets Next forward server/route-handler errors to Sentry (a no-op when the
 * SDK isn't initialized). Verified against @sentry/nextjs 10.55.0:
 * `captureRequestError` is exported.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
