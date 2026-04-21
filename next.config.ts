import createNextIntlPlugin from "next-intl/plugin"
import type { NextConfig } from "next"

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts")

const nextConfig: NextConfig = {
  output: "standalone",
  // TS errors now fail the build. Previously we had ~40 pre-existing errors
  // silently skipped here; they were fixed in Phase 1.3 so we can enable strict mode.
  typescript: { ignoreBuildErrors: false },
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
}

export default withNextIntl(nextConfig)
