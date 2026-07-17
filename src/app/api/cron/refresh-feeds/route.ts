/**
 * GET /api/cron/refresh-feeds — scheduled FREE-feed refresh.
 *
 * Pulls the free/public external feeds (CBAR FX, Yahoo commodities, open-meteo
 * weather, FAO / CPI / USDA, …) into `IntelDataPoint`, then recomputes each
 * org's operational companies so feed-driven indicators reflect the new values.
 *
 * Explicitly does NOT run the paid LLM web-crawl or Google Trends' paid proxy.
 * Key-gated free adapters are skipped when their organization key is absent.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically
 * when the `CRON_SECRET` env is set. Without a matching secret the request is
 * refused, so a stray public hit can't trigger external fetches + recompute.
 *
 * ── One-time setup ────────────────────────────────────────────────────────
 *   1. Set env `CRON_SECRET` to a long random string.
 *   2. Configure optional per-organization EIA / USDA keys in Admin → API
 *      keys. Adapters without a configured key are recorded as skipped.
 *   3. Docker VM: install `deploy/systemd/budgetpro-refresh-feeds.timer`.
 *      Vercel: the schedule lives in `vercel.json` (daily 06:00 UTC).
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
import { Prisma } from "@prisma/client"
import { prismaAdmin as prisma } from "@/lib/db/prisma-admin"
import { getLogger } from "@/lib/log"
import { enumerateActiveOrgs } from "@/lib/intel/scheduler-bootstrap"
import { ingestCommodityData } from "@/lib/intel/commodity/ingest"
import { getScheduledFreeFeedAdapters } from "@/lib/intel/commodity"
import { listApiKeys } from "@/lib/intel/api-keys"
import { acquireRefreshFeedsLock } from "@/lib/intel/refresh-feeds-lock"
import { filterOperationalCompanies } from "@/lib/risk/targets"
import { runRecomputeForCompanies } from "@/lib/risk/recompute-trigger"

export const dynamic = "force-dynamic"
export const maxDuration = 300 // Vercel Pro — ingest + recompute can exceed 60s

const log = getLogger("cron:refresh-feeds")

type RecomputeSummary = {
  ok: number
  unknown: number
  failed: number
}

type OrgRunSummary = {
  orgId: string
  status: "ok" | "degraded" | "failed"
  configuredSources: number
  successfulSources: number
  skippedSources: Array<{
    source: string
    reason: "api_key_missing" | "paid_source_disabled"
  }>
  pointsWritten: number
  feedErrors: number
  heartbeatPersisted: boolean
  recompute: RecomputeSummary | null
}

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

  let lock: Awaited<ReturnType<typeof acquireRefreshFeedsLock>>
  try {
    lock = await acquireRefreshFeedsLock()
  } catch (error) {
    log.error("failed to acquire refresh-feeds advisory lock", {
      err: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { ok: false, error: "refresh_lock_unavailable" },
      { status: 503 },
    )
  }
  if (!lock.acquired) {
    await lock.release()
    return NextResponse.json(
      { ok: false, error: "refresh_already_running" },
      { status: 409 },
    )
  }

  try {
    const year = new Date().getUTCFullYear()

    const orgs = await enumerateActiveOrgs(prisma)
    const summary: OrgRunSummary[] = []
    let requestHasFailures = false

    for (const org of orgs) {
      let pointsWritten = 0
      let successfulSources = 0
      let hardFailure = false
      const feedErrors: string[] = []

      // Every organization owns its provider credentials. The unattended
      // scheduler uses a narrower factory than manual refresh: paid proxy
      // adapters are excluded, while missing optional free keys are reported
      // as skipped configuration rather than false feed failures.
      const apiKeys = await listApiKeys(prisma, org.id)
      const adapterSet = getScheduledFreeFeedAdapters({ apiKeys })

      // 1. Pull the free feeds (per-adapter try/catch inside ingestCommodityData).
      try {
        const ingest = await ingestCommodityData(org.id, adapterSet.adapters)
        pointsWritten = ingest.pointsWritten
        feedErrors.push(...ingest.errors)
        successfulSources = ingest.perSource.filter(
          (result) =>
            result.errors.length === 0 &&
            (result.fetched || result.dataPoints.length > 0),
        ).length
        if (successfulSources === 0) {
          feedErrors.push("no configured feed source completed successfully")
          hardFailure = true
        }
      } catch (err) {
        hardFailure = true
        feedErrors.push(
          `ingest threw: ${err instanceof Error ? err.message : String(err)}`,
        )
      }

      // 2. Recompute the org's operational companies so feed-driven indicators
      //    pick up the new values. A partial recompute is a degraded scheduler
      //    outcome: data already written stays valid, but systemd must retry.
      let recompute: RecomputeSummary | null = null
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
          if (r.failed > 0) {
            feedErrors.push(`recompute failed for ${r.failed} pair(s)`)
            if (r.ok === 0) hardFailure = true
          }
        }
      } catch (err) {
        hardFailure = true
        feedErrors.push(
          `recompute threw: ${err instanceof Error ? err.message : String(err)}`,
        )
      }

      let status: OrgRunSummary["status"] = hardFailure
        ? "failed"
        : feedErrors.length === 0
          ? "ok"
          : "degraded"
      let heartbeatPersisted = false

      // 3. Dedicated free-feed heartbeat. It must not update intelLastRunAt:
      //    that key is the independent AI-news scheduler's cadence gate.
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
              feedRefreshLastRunAt: new Date().toISOString(),
              feedRefreshLastRunStatus: status,
              feedRefreshLastRunPointsWritten: pointsWritten,
              feedRefreshLastRunErrorCount: feedErrors.length,
              feedRefreshLastRunErrors: feedErrors.slice(0, 20),
              feedRefreshLastRunSkippedSources: adapterSet.skipped,
            } as unknown as Prisma.InputJsonValue,
          },
        })
        heartbeatPersisted = true
      } catch (error) {
        hardFailure = true
        status = "failed"
        feedErrors.push(
          `heartbeat write failed: ${error instanceof Error ? error.message : String(error)}`,
        )
        log.error("failed to persist free-feed run heartbeat", {
          orgId: org.id,
          err: error instanceof Error ? error.message : String(error),
        })
      }

      // A degraded run must also fail the scheduler invocation. Otherwise curl
      // exits successfully, the canary marker is written and systemd never
      // retries even though at least one feed or recompute result failed.
      if (status !== "ok") requestHasFailures = true

      log.info("feed refresh org done", {
        orgId: org.id,
        status,
        configuredSources: adapterSet.adapters.length,
        successfulSources,
        skippedSources: adapterSet.skipped.length,
        pointsWritten,
        feedErrors: feedErrors.length,
        heartbeatPersisted,
        recompute,
      })
      summary.push({
        orgId: org.id,
        status,
        configuredSources: adapterSet.adapters.length,
        successfulSources,
        skippedSources: adapterSet.skipped,
        pointsWritten,
        feedErrors: feedErrors.length,
        heartbeatPersisted,
        recompute,
      })
    }

    return NextResponse.json(
      {
        ok: !requestHasFailures,
        degraded: summary.some((org) => org.status === "degraded"),
        year,
        orgs: summary,
      },
      { status: requestHasFailures ? 502 : 200 },
    )
  } finally {
    await lock.release()
  }
}
