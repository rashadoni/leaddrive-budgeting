/**
 * GET /api/cron/intel-crawl — scheduled AI web-crawl (the PAID one).
 *
 * Runs `runScheduledIntelCrawl` for every organization: the Anthropic
 * `web_search` crawl that fills `IntelItem` and feeds the Intel lane in Risk
 * Terminal, plus the schedule + advisory-lock gates and the
 * `settings.intelLastRunAt` heartbeat that the Intel Health page reads.
 *
 * ── Why this route exists ────────────────────────────────────────────────
 * Until now there was no way to run this on a schedule in this deployment:
 *
 *   • `/api/cron/refresh-feeds` is the FREE-feed job and is explicitly
 *     forbidden from touching `intelLastRunAt` — so however often it ran, the
 *     Intel Health page stayed "never run / stale".
 *   • `/api/intel/refresh` is the admin's manual override. It is session-authed
 *     (a timer has no session) and it calls `runIntelCrawl` directly, so it
 *     writes items but never the heartbeat.
 *   • `scripts/intel-scheduler-bootstrap.ts` is the designed long-lived
 *     process, but it cannot run in this image: the runtime stage is a Next
 *     standalone build with no full node_modules, so a bare `tsx` script cannot
 *     resolve `@anthropic-ai/sdk` (verified on prod, 2026-08-04).
 *
 * Inside the Next server the SDK is present, so the same scheduler runs here.
 *
 * ── Cost ─────────────────────────────────────────────────────────────────
 * Each org that is due costs roughly one model round-trip plus up to five
 * `web_search` uses. The 24h skip-if-recent gate inside the scheduler is what
 * bounds it: firing this route more often than daily does NOT re-crawl, it
 * returns `skipped: "too-recent"`. Commodity ingest and the breach scan are
 * deliberately left off — `/api/cron/refresh-feeds` already owns those, and
 * doing them twice would double the write load for nothing.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET`. Fails closed — without the env
 * set the route refuses to run, so a stray public hit cannot spend money.
 *
 * ── Setup ────────────────────────────────────────────────────────────────
 *   1. Set `CRON_SECRET` (≥32 chars) in the deployment env.
 *   2. Docker VM: install `deploy/systemd/budgetpro-intel-crawl.timer`.
 */
// rls-scan-ignore: CRON_SECRET-authed scheduled job that legitimately spans
// ALL organizations (enumerateActiveOrgs → per-org crawl + settings
// heartbeat). A single withOrgScope pins ONE org context, so a cross-org cron
// cannot use it. Runs on the BYPASSRLS `prismaAdmin` client; org isolation is
// inherent in each per-org loop iteration, and every query below is filtered by
// the `orgId` of that iteration.
import { NextRequest, NextResponse } from "next/server"
import { prismaAdmin as prisma } from "@/lib/db/prisma-admin"
import { getLogger } from "@/lib/log"
import { enumerateActiveOrgs } from "@/lib/intel/scheduler-bootstrap"
import { runScheduledIntelCrawl } from "@/lib/intel/scheduler"
import { hasAnthropicKey } from "@/lib/ai/client"
import { bearerMatches } from "@/lib/cron-auth"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300

const log = getLogger("cron:intel-crawl")

type OrgOutcome = {
  orgId: string
  status: "ok" | "skipped" | "failed"
  detail?: string
  itemsCreated?: number
}

/**
 * The crawler needs the org's industries + company codes. That DB read belongs
 * to the caller by design (see RunScheduledOptions.buildInput), so it lives
 * here rather than inside the scheduler.
 */
async function buildInputForOrg(orgId: string) {
  const companies = await prisma.company.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { code: true, industry: true },
  })
  if (companies.length === 0) return null

  const companyCodes: string[] = []
  const industries = new Set<string>()
  for (const c of companies) {
    companyCodes.push(c.code)
    if (c.industry) industries.add(c.industry)
  }
  return { organizationId: orgId, industries: Array.from(industries), companyCodes }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured — refusing to run" },
      { status: 503 },
    )
  }
  if (!bearerMatches(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  // Checked before any org loop: without a key every org would fail
  // identically, and a 503 says why instead of burning a per-org error each.
  if (!hasAnthropicKey()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured — refusing to run" },
      { status: 503 },
    )
  }

  const startedAt = Date.now()
  const orgs = await enumerateActiveOrgs(prisma)
  const outcomes: OrgOutcome[] = []

  for (const org of orgs) {
    try {
      const result = await runScheduledIntelCrawl(prisma, org.id, {
        buildInput: buildInputForOrg,
        // Owned by /api/cron/refresh-feeds — see the cost note above.
        runCommodityIngest: false,
        runBreachScan: false,
      })
      if ("ok" in result && result.ok) {
        outcomes.push({
          orgId: org.id,
          status: "ok",
          itemsCreated: result.result.itemsCreated,
        })
      } else if ("skipped" in result) {
        outcomes.push({ orgId: org.id, status: "skipped", detail: result.skipped })
      } else {
        outcomes.push({
          orgId: org.id,
          status: "failed",
          detail: "error" in result ? result.error : "unknown",
        })
      }
    } catch (err) {
      // One org's failure must not abort the rest of the fan-out.
      const detail = err instanceof Error ? err.message : String(err)
      log.error("intel crawl failed for org", { orgId: org.id, err: detail })
      outcomes.push({ orgId: org.id, status: "failed", detail })
    }
  }

  const summary = {
    orgs: outcomes.length,
    ok: outcomes.filter((o) => o.status === "ok").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    itemsCreated: outcomes.reduce((s, o) => s + (o.itemsCreated ?? 0), 0),
    durationMs: Date.now() - startedAt,
  }
  log.info("intel crawl cron finished", summary)

  // 200 even with per-org failures: the timer should not retry the whole
  // fan-out because one org's provider call failed. The body carries detail.
  return NextResponse.json({ ...summary, outcomes })
}
