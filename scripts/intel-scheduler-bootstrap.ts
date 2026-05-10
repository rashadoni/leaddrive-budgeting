/**
 * Phase 7.G Turn CVIII (Phase 7.E #1 D.5a bootstrap follow-up) — long-lived
 * intel scheduler process.
 *
 * Closes the «manual-trigger-only» gap from LXXXX D.5a + CII D.5b: this
 * process registers `runScheduledIntelCrawl(orgId)` per org with a 24h
 * interval (staggered first-fire) so FX/CPI/RSS/breach-scan all run
 * automatically.
 *
 * **Run via LaunchAgent / systemd / cron-style supervisor:**
 *   ```
 *   npx tsx scripts/intel-scheduler-bootstrap.ts
 *   ```
 * Honours SIGTERM + SIGINT → calls cleanup() then `prisma.$disconnect()` so
 * timer leaks don't keep the process alive after kill.
 *
 * **CLI flags:**
 *   --once             Run one cycle per org synchronously then exit
 *                      (manual-test mode; doesn't register intervals)
 *   --interval-ms=N    Override default 24h cadence (testing only)
 *   --skip-commodity   Don't run commodity ingest in each cycle
 *   --skip-breach      Don't run breach scan in each cycle
 *
 * **What each org's cycle does** (per LXXXX/CII/C scheduler):
 *   1. Acquire pg_try_advisory_lock (concurrent process safety)
 *   2. Crawl AI Web feed via Anthropic web_search
 *   3. (optional) Pull TCMB FX + WorldBank CPI + commodities RSS
 *   4. (optional) Scan IndicatorValues for predictive breaches
 *   5. Update `org.settings.intelLastRunAt`; release lock
 */

import { prisma } from "../src/lib/prisma"
import {
  enumerateActiveOrgs,
  registerSchedulers,
} from "../src/lib/intel/scheduler-bootstrap"
import {
  runScheduledIntelCrawl,
  type RunScheduledOptions,
} from "../src/lib/intel/scheduler"
import type { IntelCrawlInput } from "../src/lib/intel/types"

interface CliFlags {
  once: boolean
  intervalMs?: number
  skipCommodity: boolean
  skipBreach: boolean
}

function parseFlags(argv: ReadonlyArray<string>): CliFlags {
  const flags: CliFlags = {
    once: false,
    skipCommodity: false,
    skipBreach: false,
  }
  for (const arg of argv) {
    if (arg === "--once") flags.once = true
    else if (arg === "--skip-commodity") flags.skipCommodity = true
    else if (arg === "--skip-breach") flags.skipBreach = true
    else if (arg.startsWith("--interval-ms=")) {
      const n = parseInt(arg.slice("--interval-ms=".length), 10)
      if (Number.isFinite(n) && n > 0) flags.intervalMs = n
    }
  }
  return flags
}

/** Build the per-org IntelCrawlInput. Pulls active companies + their
 *  industries from the DB so the LLM prompt knows what to search for. */
async function buildInputForOrg(orgId: string): Promise<IntelCrawlInput | null> {
  const companies = await prisma.company.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { code: true, industry: true },
  })
  if (companies.length === 0) return null
  const codes: string[] = []
  const industriesSet = new Set<string>()
  for (const c of companies) {
    codes.push(c.code)
    if (c.industry) industriesSet.add(c.industry)
  }
  return {
    organizationId: orgId,
    industries: Array.from(industriesSet),
    companyCodes: codes,
  }
}

async function runOneCycle(orgId: string, flags: CliFlags): Promise<void> {
  const opts: RunScheduledOptions = {
    buildInput: buildInputForOrg,
    runCommodityIngest: !flags.skipCommodity,
    runBreachScan: !flags.skipBreach,
  }
  const result = await runScheduledIntelCrawl(prisma, orgId, opts)
  if ("ok" in result && result.ok) {
    const itemsCreated = result.result.itemsCreated
    const breachCount = result.breachScan?.breachesPersisted ?? 0
    const commodityPoints = result.commodityIngest?.pointsWritten ?? 0
    console.log(
      `[intel-bootstrap] org=${orgId} OK · items=${itemsCreated} commodity=${commodityPoints} breaches=${breachCount}`,
    )
  } else if ("skipped" in result) {
    console.log(`[intel-bootstrap] org=${orgId} skipped (${result.skipped})`)
  } else if ("ok" in result && !result.ok) {
    console.warn(`[intel-bootstrap] org=${orgId} ERR · ${result.error}`)
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))
  const orgs = await enumerateActiveOrgs(prisma)
  if (orgs.length === 0) {
    console.warn("[intel-bootstrap] no organizations found — exiting")
    await prisma.$disconnect()
    return
  }
  console.log(
    `[intel-bootstrap] enumerating ${orgs.length} org(s): ${orgs.map((o) => o.slug).join(", ")}`,
  )

  if (flags.once) {
    console.log("[intel-bootstrap] --once: running each org sequentially then exiting")
    for (const org of orgs) {
      try {
        await runOneCycle(org.id, flags)
      } catch (err) {
        console.error(`[intel-bootstrap] org=${org.id} threw:`, err)
      }
    }
    await prisma.$disconnect()
    return
  }

  const result = registerSchedulers(orgs, (orgId) => runOneCycle(orgId, flags), {
    intervalMs: flags.intervalMs,
  })
  console.log(
    `[intel-bootstrap] registered ${result.orgCount} org(s); first fires staggered up to ${flags.intervalMs ?? 24 * 60 * 60 * 1000}ms`,
  )

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[intel-bootstrap] ${signal} received — cleaning up`)
    result.cleanup()
    await prisma.$disconnect()
    process.exit(0)
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"))
  process.on("SIGINT", () => void shutdown("SIGINT"))

  // Process stays alive on the registered intervals; keep this thenable open.
  await new Promise<void>(() => {
    /* never resolves — exit only on signal */
  })
}

void main().catch((err) => {
  console.error("[intel-bootstrap] fatal:", err)
  process.exit(1)
})
