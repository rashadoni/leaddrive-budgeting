/**
 * Sentry — server runtime init (Node.js). Loaded by `src/instrumentation.ts`
 * `register()` when NEXT_RUNTIME === "nodejs".
 *
 * Phase 8 G2 (2026-05-29) — wired DSN-ready. Sentry stays FULLY INERT until
 * `SENTRY_DSN` is set in the environment: with no DSN, `Sentry.init` is never
 * called, so there are no network calls and no global handlers. Set the env
 * var (see `.env.production.example`) to activate — no code change needed.
 *
 * Errors-only by default (cheapest + predictable). Bump perf-trace sampling
 * via `SENTRY_TRACES_SAMPLE_RATE` (e.g. 0.1 = 10% of requests traced).
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
