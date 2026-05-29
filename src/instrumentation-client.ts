/**
 * Sentry — browser/client init. Next 16 loads `instrumentation-client.ts`
 * automatically (the modern replacement for the legacy `sentry.client.config.ts`,
 * and the form required for Turbopack client instrumentation).
 *
 * Phase 8 G2 (2026-05-29) — DSN-gated: inert until `NEXT_PUBLIC_SENTRY_DSN`
 * is set (must be NEXT_PUBLIC_* to reach the browser bundle). No replay/session
 * capture by default — errors + opt-in tracing only, to keep bundle + cost
 * predictable. Note: `captureRouterTransitionStart` is NOT exported by
 * @sentry/nextjs 10.55.0 (verified), so no navigation-transition hook here.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: Number(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0,
    ),
  });
}
