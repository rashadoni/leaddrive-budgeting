/**
 * GET /api/cron/refresh-feeds — scheduled FREE-feed refresh (Vercel Cron).
 *
 * Pulls the free/public external feeds (CBAR FX, Yahoo commodities, open-meteo
 * weather, FAO / CPI / USDA, …) into `IntelDataPoint`, then recomputes each
 * org's operational companies so feed-driven indicators reflect the new values.
 *
 * Explicitly does NOT run the paid LLM web-crawl — that stays a manual button
 * (`/api/intel/refresh`). Only `getCommodityAdapters()` (public feeds) runs here.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically
 * when the `CRON_SECRET` env is set. Without a matching secret the request is
 * refused, so a stray public hit can't trigger external fetches + recompute.
 *
 * ── One-time setup on Vercel ──────────────────────────────────────────────
 *   1. Set env `CRON_SECRET` to a long random string.
 *   2. Configure optional per-organization EIA / USDA / Google Trends keys in
 *      Admin → API keys. Adapters without a configured key skip gracefully.
 *   3. The schedule is registered in `vercel.json` (`crons`, daily 06:00 UTC).
 *      NOTE: `maxDuration = 300` needs Vercel **Pro**; Hobby caps execution
 *      around 10s (too short for ingest + recompute → upgrade, or keep using
 *      the manual "Запустить impact-scan" button).
 */
// rls-scan-ignore: CRON_SECRET-authed scheduled job that legitimately spans
// ALL organizations (enumerateActiveOrgs → per-org ingest + recompute + Org
// settings heartbeat). A single withOrgScope pins ONE org context, so a
// cross-org cron can't use it; runRecomputeForCompanies is also too heavy for
// one 5s tx. Runs on the BYPASSRLS `prismaAdmin` client (passed into the
// helpers too) — org isolation is inherent in each per-org loop iteration.
import { NextRequest, NextResponse } from "next/server"
import { prismaAdmin as prisma } from "@/lib/db/prisma-admin"
import { getLogger } from "@/lib/log"
import { enumerateActiveOrgs } from "@/lib/intel/scheduler-bootstrap"
import { ingestCommodityData } from "@/lib/intel/commodity/ingest"
import { getCommodityAdapters } from "@/lib/intel/commodity"
import { listApiKeys } from "@/lib/intel/api-keys"
import { filterOperationalCompanies } from "@/lib/risk/targets"
import { runRecomputeForCompanies } from "@/lib/risk/recompute-trigger"

export const dynamic = "force-dynamic"
export const maxDuration = 300 // Vercel Pro — ingest + recompute can exceed 60s

const log = getLogger("cron:refresh-feeds")

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured — refusing to run" },
      { status: 503 },
    )
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const year = new Date().getUTCFullYear()

  const orgs = await enumerateActiveOrgs(prisma)
  const summary: Array<{
    orgId: string
    pointsWritten: number
    feedErrors: number
    recompute: { ok: number; unknown: number; failed: number } | null
  }> = []

  for (const org of orgs) {
    let pointsWritten = 0
    const feedErrors: string[] = []

    // Every organization owns its provider credentials. Constructing one
    // adapter set before this loop would leak the scheduler into a global-key
    // contract and make the Admin API-key screen ineffective for cron runs.
    const apiKeys = await listApiKeys(prisma, org.id)
    const adapters = getCommodityAdapters({ apiKeys })

    // 1. Pull the free feeds (per-adapter try/catch inside ingestCommodityData).
    try {
      const ingest = await ingestCommodityData(org.id, adapters)
      pointsWritten = ingest.pointsWritten
      feedErrors.push(...ingest.errors)
    } catch (err) {
      feedErrors.push(
        `ingest threw: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    // 2. Recompute the org's operational companies so feed-driven indicators
    //    pick up the new values. Best-effort — never aborts the cron.
    let recompute: { ok: number; unknown: number; failed: number } | null = null
    try {
      const companies = await prisma.company.findMany({
        where: { organizationId: org.id, isActive: true },
        select: {
          id: true,
          code: true,
          industry: true,
          level: true,
          isActive: true,
          role: true,
          baseCurrencyCode: true,
        },
      })
      const operational = filterOperationalCompanies(companies)
      if (operational.length > 0) {
        const r = await runRecomputeForCompanies(
          prisma,
          org.id,
          operational.map((c) => ({ companyId: c.id, year })),
        )
        recompute = { ok: r.ok, unknown: r.unknown, failed: r.failed }
      }
    } catch (err) {
      feedErrors.push(
        `recompute threw: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    // 3. Heartbeat + fail-alert — persist last-run time, points written, and
    //    any errors to Org.settings (the existing home of `intelLastRunAt`).
    //    This is the durable, type-safe alert state: a stale `intelLastRunAt`
    //    or a non-zero `intelLastRunErrorCount` flags a silently-failing feed,
    //    rather than it hiding behind an old observation date.
    try {
      const orgRow = await prisma.organization.findUnique({
        where: { id: org.id },
        select: { settings: true },
      })
      const settings = (orgRow?.settings ?? {}) as Record<string, unknown>
      await prisma.organization.update({
        where: { id: org.id },
        data: {
          settings: {
            ...settings,
            intelLastRunAt: new Date().toISOString(),
            intelLastRunPointsWritten: pointsWritten,
            intelLastRunErrorCount: feedErrors.length,
            intelLastRunErrors: feedErrors.slice(0, 20),
          },
        },
      })
    } catch (e) {
      log.error("failed to persist intel run heartbeat", {
        orgId: org.id,
        err: e instanceof Error ? e.message : String(e),
      })
    }

    log.info("feed refresh org done", {
      orgId: org.id,
      pointsWritten,
      feedErrors: feedErrors.length,
      recompute,
    })
    summary.push({
      orgId: org.id,
      pointsWritten,
      feedErrors: feedErrors.length,
      recompute,
    })
  }

  return NextResponse.json({ ok: true, year, orgs: summary })
}
