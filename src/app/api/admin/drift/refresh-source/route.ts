/**
 * POST /api/admin/drift/refresh-source?source=<sourceCode>
 *
 * Manually trigger one commodity adapter and write its data points
 * into `IntelDataPoint`. Powers the "Refresh now" button on each
 * card in the Drift Dashboard.
 *
 * Why per-source endpoint (not whole batch): the dashboard groups
 * by sourceCode and the user clicks one card; firing all 7 adapters
 * for a single click would burn rate-limits + take 30+ seconds.
 *
 * Auth: admin-only (data ingestion is a privileged operation that
 * costs upstream API quota — TCMB has free tier but Yahoo / RSS
 * have rate limits, World Bank tolerates daily polling but not
 * spam).
 *
 * Rate limit: 1×/min per (org × sourceCode) — prevents
 * button-spam from racking quota.
 */
import { NextRequest, NextResponse } from "next/server"
// rls-scan-ignore: admin-only ingestion route with an authenticated, explicit
// organizationId. Provider fetches can exceed the 5s interactive transaction
// window, so pass the BYPASSRLS client and keep every read/write constrained by
// the session org instead of holding a withOrgScope transaction over network I/O.
import { prismaAdmin as prisma } from "@/lib/db/prisma-admin"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit } from "@/lib/rate-limit"
import {
  getCommodityAdapters,
  ingestCommodityData,
} from "@/lib/intel/commodity"
import {
  getCommodityApiKeySource,
  listApiKeys,
} from "@/lib/intel/api-keys"

export const maxDuration = 60
export const runtime = "nodejs"

const RATE_LIMIT = {
  name: "admin-drift-refresh-source",
  max: 1,
  windowMs: 60_000,
}

export async function POST(request: NextRequest) {
  const session = await requireRole(request, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }
  const orgId = session.orgId
  const url = new URL(request.url)
  const sourceCode = url.searchParams.get("source")
  if (!sourceCode) {
    return NextResponse.json(
      { error: "Missing ?source=<sourceCode> query param" },
      { status: 400 },
    )
  }

  const availableSources = getCommodityAdapters().map((a) => a.source)
  if (!availableSources.includes(sourceCode)) {
    return NextResponse.json(
      {
        error: `Unknown sourceCode: ${sourceCode}`,
        availableSources,
      },
      { status: 404 },
    )
  }

  // Validate configuration before consuming the rate-limit allowance. A
  // missing key is an actionable setup state, not a failed provider request.
  const keySource = getCommodityApiKeySource(sourceCode)
  const apiKeys = keySource
    ? await listApiKeys(prisma, orgId)
    : undefined
  if (keySource && !apiKeys?.[keySource]) {
    return NextResponse.json(
      {
        error: `API key is not configured for ${sourceCode}`,
        code: "api_key_missing",
        sourceCode,
        keySource,
        configurePath: "/budgeting/admin/api-keys",
      },
      { status: 424 },
    )
  }

  // Rate-limit per (org × sourceCode) — independent buckets so admin
  // can hit several different sources in quick succession.
  const rateLimitError = enforceRateLimit(`${orgId}:${sourceCode}`, RATE_LIMIT)
  if (rateLimitError) return rateLimitError

  // Phase 7.K Phase 5a — thread per-org API keys through adapter
  // construction. Without this the manual "Refresh now" button would
  // bypass the key wiring and the EIA / USDA / GTrends adapters would
  // emit api_key_missing even when the admin has set a key.
  const adapters = getCommodityAdapters({ apiKeys }).filter(
    (a) => a.source === sourceCode,
  )

  const startedAt = Date.now()
  const result = await ingestCommodityData(orgId, adapters, { prisma })
  const durationMs = Date.now() - startedAt

  return NextResponse.json({
    sourceCode,
    inserted: result.pointsWritten,
    errors: result.errors,
    perSource: result.perSource.map((p) => ({
      source: p.source,
      dataPoints: p.dataPoints.length,
      fetched: p.fetched,
      errors: p.errors,
    })),
    durationMs,
  })
}
