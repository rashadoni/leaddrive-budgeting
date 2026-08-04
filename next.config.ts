import createNextIntlPlugin from "next-intl/plugin"
import { withSentryConfig } from "@sentry/nextjs"
import type { NextConfig } from "next"

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts")

const nextConfig: NextConfig = {
  output: "standalone",
  // TS errors now fail the build. Previously we had ~40 pre-existing errors
  // silently skipped here; they were fixed in Phase 1.3 so we can enable strict mode.
  //
  // The ONE exception is the production image build, which runs on the 3.8GB
  // prod server. There, `next build` compiled fine in 34s and then spent 10
  // minutes in the type-check phase before the kernel's OOM killer took it
  // (SIGKILL, not a heap error). That check is the third run of the identical
  // check on the identical commit: the pre-commit hook runs `tsc --noEmit`, CI
  // runs it as its own step, and deploy/update-prod.sh refuses to ship anything
  // that is not already origin/main with CI green. Skipping it inside the image
  // build removes duplicated work, not a gate — and only the Dockerfile sets
  // this variable, so local and CI builds still type-check.
  typescript: { ignoreBuildErrors: process.env.DOCKER_BUILD_SKIP_TYPECHECK === "1" },
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  experimental: {
    // Large xlsx imports — enterprise reporting packs reach 26MB+ (mostly
    // pivot-cache bloat). Every request passes through `src/proxy.ts` (the
    // Next 16 proxy), which clones + buffers the body, capped by
    // `proxyClientMaxBodySize` — DEFAULT 10MB. A 26MB upload was silently
    // TRUNCATED to 10MB, so `request.formData()` then failed parsing the broken
    // multipart → a fast uncaught 500 BEFORE the workbook was ever read (the
    // confusing "HTTP 500" on Reporting 2026.xlsx, 2026-06-21). Raised to 64MB
    // so real client files pass through intact. Global — fixes every upload
    // route at once. Files beyond this should hit the in-handler Content-Length
    // guard with a clean message; truly huge files need a streaming-to-disk
    // redesign rather than formData() buffering.
    //
    // 96MB here is deliberately ABOVE the 64MB per-file import cap
    // (MAX_IMPORT_UPLOAD_BYTES) so a max-size file plus its multipart
    // boundaries + form fields still fits in the proxy buffer without being
    // truncated. Keep this > that cap whenever either changes.
    proxyClientMaxBodySize: "96mb",
  },
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
