import createNextIntlPlugin from "next-intl/plugin"
import { withSentryConfig } from "@sentry/nextjs"
import type { NextConfig } from "next"

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts")

const nextConfig: NextConfig = {
  output: "standalone",
  // TS errors now fail the build. Previously we had ~40 pre-existing errors
  // silently skipped here; they were fixed in Phase 1.3 so we can enable strict mode.
  typescript: { ignoreBuildErrors: false },
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
}

const baseConfig = withNextIntl(nextConfig)

// Phase 8 G2 (2026-05-29) — Sentry build integration, DSN-gated. When no
// Sentry DSN is configured the build is byte-identical to before (we return
// `baseConfig` untouched), so wiring Sentry carries ZERO build risk until you
// opt in. Set SENTRY_DSN (and optionally SENTRY_AUTH_TOKEN/ORG/PROJECT for
// source-map upload) to activate. Turbopack has no webpack plugin, so source
// maps upload via the SDK's runAfterProductionCompile path automatically.
const sentryEnabled = Boolean(
  process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
)

export default sentryEnabled
  ? withSentryConfig(baseConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      // Source-map upload auth. Absent → upload is skipped (errors still
      // report, just without symbolicated stack frames). Never hard-fails.
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // Quiet during local/dev builds; verbose only in CI.
      silent: !process.env.CI,
    })
  : baseConfig
