/**
 * Sentry — edge runtime init (middleware / edge routes). Loaded by
 * `src/instrumentation.ts` `register()` when NEXT_RUNTIME === "edge".
 *
 * Phase 8 G2 (2026-05-29) — DSN-gated, same as the server config: inert
 * until `SENTRY_DSN` is set. Keep this config edge-safe (no Node-only APIs).
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });
}
