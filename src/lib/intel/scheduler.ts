/**
 * Phase 7.G Turn LXXXX (Phase 7.E #1 v2 D.5a) — daily intel crawl scheduler.
 *
 * Per LXXXV vendor pick #4: Next.js setInterval + Postgres advisory lock
 * (NOT BullMQ — defer to Phase 6). Per-org schedule with 24h skip-if-recent
 * gate.
 *
 * **Storage shape:** uses existing `Organization.settings` JSON field
 * (no schema migration). Reads/writes `settings.intelLastRunAt` (ISO).
 *
 * **Concurrency safety:** Postgres advisory lock prevents dupe runs from
 * concurrent Node processes (clustering / blue-green deploy / dev hot-reload).
 * Lock key derived from sha256(orgId) → bigint. Acquired with
 * `pg_try_advisory_lock` (non-blocking; returns false instead of waiting).
 *
 * **Bootstrap (NOT shipped this turn):** A separate
 * `scripts/intel-scheduler-bootstrap.ts` would register `setInterval` per
 * org once at process start. That's deployment glue — defer to "schedule
 * goes live" turn. Until bootstrap exists, this module is callable from
 * (a) admin manual trigger, (b) cron job, (c) test harness.
 *
 * **Failure modes:**
 *   - Lock contention → return early `{ skipped: "lock-busy" }` (another
 *     process owns the lock; that one will run/has run)
 *   - <24h since last run → return `{ skipped: "too-recent" }`
 *   - Crawl error → bubble up; settings unchanged
 *   - Settings update fails after crawl → log warning + return crawl result
 *     (the audit trail in IntelItem inserts is the durable record)
 */

import { createHash } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { runIntelCrawl } from "./crawler"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger for the
// intel scheduler's best-effort housekeeping warnings. 2 console.warn
// → logger.warn (settings.intelLastRunAt write fail + advisory-lock
// release fail). Both are non-fatal; the crawl result + audit_event
// are the durable record.
const log = getLogger("intel:scheduler")
import type { IntelCrawlInput, IntelCrawlResult, IntelOutputLanguage } from "./types"
import { runBreachScanForOrg } from "@/lib/risk/breach-scan-runner"
import {
  runCrossingScan,
  type RunCrossingScanResult,
} from "@/lib/intel/crossing-scan-runner"
import {
  ingestCommodityData,
  getCommodityAdapters,
  type CommodityAdapter,
} from "@/lib/intel/commodity"

/** Allowed values for `Organization.settings.intelLanguage`. Anything else
 *  falls back to "en". */
const ALLOWED_LANGUAGES: IntelOutputLanguage[] = ["en", "ru", "az"]

export const INTEL_SCHEDULE_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Phase 7.G Turn C (E.2e) — counts surfaced from the optional post-crawl
 *  breach scan. Mirrors `RunBreachScanResult` shape minus `persist` detail
 *  (caller doesn't need raw upsert errors here, just headline counts). */
export interface ScheduledBreachScanCounts {
  ivsLoaded: number
  ivsScanned: number
  breachesPersisted: number
  errors: string[]
}

/** Phase 7.G Turn CII (D.5b → scheduler) — counts surfaced from the optional
 *  post-crawl commodity ingest (TCMB FX + WorldBank CPI + commodities RSS). */
export interface ScheduledCommodityIngestCounts {
  /** Adapter sources that ran (e.g. ["tcmb-fx-rates", "worldbank-cpi"]). */
  sources: string[]
  /** Total data points written across all sources. */
  pointsWritten: number
  errors: string[]
}

export type ScheduledCrawlResult =
  /** Платный обход выключен для этой организации (`settings.intelCrawlEnabled`). */
  | { skipped: "disabled" }
  | { skipped: "too-recent"; lastRunAt: string }
  | { skipped: "lock-busy" }
  | { skipped: "no-input" }
  | {
      ok: true
      lastRunAt: string
      result: IntelCrawlResult
      /** Phase 7.G Turn C (E.2e) — present when post-crawl breach scan ran. */
      breachScan?: ScheduledBreachScanCounts
      /** Phase 7.G Turn CII (D.5b wire) — present when commodity ingest ran. */
      commodityIngest?: ScheduledCommodityIngestCounts
      /** Phase 7.L — present when external-feed crossing scan ran. */
      crossingScan?: RunCrossingScanResult
    }
  | { ok: false; error: string }

/**
 * Convert orgId to a bigint key for pg_advisory_lock. Postgres advisory
 * lock keys are bigint (signed 64-bit). sha256-truncate to first 8 bytes
 * (16 hex chars), parse as positive bigint within signed 64-bit range.
 */
export function orgIdToLockKey(orgId: string): bigint {
  const hash = createHash("sha256").update(orgId).digest("hex").slice(0, 16)
  // Take 7 bytes (14 hex chars) → fits in signed 64-bit comfortably (<2^56)
  return BigInt("0x" + hash.slice(0, 14))
}

export type RunScheduledOptions = {
  /** Build IntelCrawlInput from org context. Caller must provide because
   * input requires industries[]+companyCodes[] derived from prisma.company
   * query — that DB call belongs in caller (route or cron) not here. */
  buildInput: (orgId: string) => Promise<IntelCrawlInput | null>
  /** Override 24h interval. */
  intervalMs?: number
  /** Override "now" for tests. */
  now?: () => Date
  /** Skip the advisory-lock acquisition (test mode — single process anyway). */
  skipLock?: boolean
  /** Phase 7.G Turn C (E.2e) — when true, run a predictive-breach scan
   *  (`runBreachScanForOrg`) AFTER the crawl completes successfully. The
   *  scan re-uses the same DB connection + the lock window. Failures from
   *  the breach scan never abort the crawl result — they're recorded under
   *  result.breachScan.errors[].
   *  Default: false (opt-in to keep existing scheduler invocations unchanged). */
  runBreachScan?: boolean
  /** Phase 7.G Turn CII (D.5b wire) — when true, run commodity API ingest
   *  (`ingestCommodityData(getCommodityAdapters())`) AFTER the crawl. Pulls
   *  TCMB FX + WorldBank CPI + commodities RSS for the org. Failures recorded
   *  under result.commodityIngest.errors[]; never abort the crawl OK result.
   *  Default: false (opt-in). Runs BEFORE breach scan so fresh intel data
   *  is available to E.1b intel-fusion if downstream consumers need it. */
  runCommodityIngest?: boolean
  /** Test seam — override the adapter list (default `getCommodityAdapters()`). */
  commodityAdapters?: CommodityAdapter[]
  /** Phase 7.L — when true, scan ingested IntelDataPoints for external-
   *  feed crossings (FAO > 130, Brent > $100, AZN/USD shift >2%, etc.)
   *  and run impact-forecast LLM per affected operational company.
   *  Failures recorded under result.crossingScan.errors[]; never abort
   *  the crawl result. Default: false (opt-in). Runs AFTER breach scan
   *  so commodity feeds are already ingested. */
  runCrossingScan?: boolean
}

/**
 * Run the intel crawl for an org with schedule + concurrency gates.
 * Returns ScheduledCrawlResult discriminating skip reasons from success/error.
 */
export async function runScheduledIntelCrawl(
  prisma: PrismaClient,
  orgId: string,
  opts: RunScheduledOptions,
): Promise<ScheduledCrawlResult> {
  const intervalMs = opts.intervalMs ?? INTEL_SCHEDULE_INTERVAL_MS
  const now = opts.now ?? (() => new Date())

  // 1. Read last-run timestamp from Organization.settings JSON
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })
  if (!org) return { ok: false, error: `Organization ${orgId} not found` }

  const settings = (org.settings ?? {}) as Record<string, unknown>

  // Платная работа — только по явному согласию.
  //
  // Этот обход тратит деньги на каждый запуск: один round-trip модели плюс до
  // пяти `web_search` на организацию, каждый день. Пока ключ настроен, он идёт
  // сам по себе — пользователи в приложении для этого не нужны, и по счёту
  // видно только «списано», а не «кто просил».
  //
  // Поэтому расписание по умолчанию ВЫКЛЮЧЕНО и включается тумблером на
  // странице Intel Health. Проверка строго на `=== true`: отсутствующий ключ,
  // `null` и строка "false" одинаково значат «не включали».
  //
  // Гейт стоит только здесь, в ПЛАНОВОМ пути. Ручной запуск админа
  // (`POST /api/intel/refresh`) зовёт `runIntelCrawl` напрямую и остаётся
  // рабочим: человек, нажавший кнопку, знает, что тратит.
  if (settings.intelCrawlEnabled !== true) {
    return { skipped: "disabled" }
  }

  const lastRunIso = typeof settings.intelLastRunAt === "string" ? settings.intelLastRunAt : null
  if (lastRunIso) {
    const lastRun = new Date(lastRunIso).getTime()
    const elapsed = now().getTime() - lastRun
    if (elapsed < intervalMs) {
      return { skipped: "too-recent", lastRunAt: lastRunIso }
    }
  }

  // 2. Acquire advisory lock (skip in tests)
  let lockAcquired = false
  if (!opts.skipLock) {
    const lockKey = orgIdToLockKey(orgId)
    const result = await prisma.$queryRawUnsafe<Array<{ pg_try_advisory_lock: boolean }>>(
      `SELECT pg_try_advisory_lock($1::bigint) AS pg_try_advisory_lock`,
      lockKey.toString(),
    )
    lockAcquired = result[0]?.pg_try_advisory_lock === true
    if (!lockAcquired) {
      return { skipped: "lock-busy" }
    }
  }

  try {
    // 3. Build input via caller's hook
    const input = await opts.buildInput(orgId)
    if (!input) return { skipped: "no-input" }

    // 3.5 Phase 7.G Turn LXXXXIII (D.5c) — apply org's preferred output
    // language (settings.intelLanguage). Caller-supplied language wins ONLY
    // if scheduler can't resolve a valid one from settings — this gives
    // org-admin (UI) the canonical knob, callers a sane default.
    const settingsLanguage =
      typeof settings.intelLanguage === "string" &&
      (ALLOWED_LANGUAGES as string[]).includes(settings.intelLanguage)
        ? (settings.intelLanguage as IntelOutputLanguage)
        : null
    const effectiveLanguage: IntelOutputLanguage =
      settingsLanguage ?? input.language ?? "en"

    // 4. Run the crawl
    const result = await runIntelCrawl(
      { ...input, language: effectiveLanguage },
      { prisma },
    )

    // 5. Update settings.intelLastRunAt (best-effort — crawl already wrote
    //    IntelItem rows + audit_event, those are the durable record)
    const newSettings = { ...settings, intelLastRunAt: now().toISOString() }
    try {
      await prisma.organization.update({
        where: { id: orgId },
        data: { settings: newSettings as object },
      })
    } catch (e) {
      log.warn("failed to update settings.intelLastRunAt", {
        orgId,
        err: e instanceof Error ? e.message : String(e),
      })
    }

    // 5.5 Phase 7.G Turn CII (D.5b wire) — optional commodity ingest.
    //     Pulls FX/CPI/RSS data points for E.1b intel-fusion. Runs BEFORE
    //     breach scan so fresh data is available to downstream consumers.
    //     Failures never abort the crawl OK result.
    //
    //     Phase 7.K Phase 5a — per-org API keys are loaded from
    //     Organization.settings.apiKeys and threaded through to adapter
    //     factories that need them (EIA / USDA / Google Trends proxy).
    //     Missing keys → adapter returns api_key_missing gracefully.
    let commodityIngest: ScheduledCommodityIngestCounts | undefined
    if (opts.runCommodityIngest) {
      try {
        let adapters = opts.commodityAdapters
        if (!adapters) {
          // Load per-org API keys then construct adapters with them.
          // Lazy-imported to avoid a hard cycle.
          const { listApiKeys } = await import("@/lib/intel/api-keys")
          const apiKeys = await listApiKeys(prisma as never, orgId)
          adapters = getCommodityAdapters({ apiKeys })
        }
        const ingest = await ingestCommodityData(orgId, adapters, { prisma }, now())
        commodityIngest = {
          sources: adapters.map((a) => a.source),
          pointsWritten: ingest.pointsWritten,
          errors: ingest.errors,
        }
      } catch (e) {
        commodityIngest = {
          sources: [],
          pointsWritten: 0,
          errors: [`commodity-ingest threw: ${e instanceof Error ? e.message : String(e)}`],
        }
      }
    }

    // 6. Phase 7.G Turn C (E.2e) — optional post-crawl breach scan.
    //    Failures here are recorded but never abort the crawl result.
    let breachScan: ScheduledBreachScanCounts | undefined
    if (opts.runBreachScan) {
      try {
        const scan = await runBreachScanForOrg(orgId, { prisma, now: now() })
        breachScan = {
          ivsLoaded: scan.ivsLoaded,
          ivsScanned: scan.ivsScanned,
          breachesPersisted: scan.breachesPersisted,
          errors: scan.errors,
        }
      } catch (e) {
        breachScan = {
          ivsLoaded: 0,
          ivsScanned: 0,
          breachesPersisted: 0,
          errors: [`breach-scan threw: ${e instanceof Error ? e.message : String(e)}`],
        }
      }
    }

    // 7. Phase 7.L — optional external-feed crossing scan + impact forecasts.
    //    Runs AFTER commodity ingest + breach scan so the freshest
    //    IntelDataPoint rows are visible. Failures recorded but never
    //    abort the crawl result.
    let crossingScan: RunCrossingScanResult | undefined
    if (opts.runCrossingScan) {
      try {
        crossingScan = await runCrossingScan(orgId, {
          prisma,
          now: () => now(),
        })
      } catch (e) {
        crossingScan = {
          ok: false,
          matchesFound: 0,
          forecastsAttempted: 0,
          forecastsGenerated: 0,
          cacheHits: 0,
          skippedNoFinancials: 0,
          skippedBudget: 0,
          errors: [
            `crossing-scan threw: ${e instanceof Error ? e.message : String(e)}`,
          ],
        }
      }
    }

    return {
      ok: true,
      lastRunAt: now().toISOString(),
      result,
      breachScan,
      commodityIngest,
      crossingScan,
    }
  } finally {
    // 6. Release advisory lock
    if (lockAcquired) {
      const lockKey = orgIdToLockKey(orgId)
      try {
        await prisma.$queryRawUnsafe(
          `SELECT pg_advisory_unlock($1::bigint)`,
          lockKey.toString(),
        )
      } catch (e) {
        log.warn("failed to release advisory lock", {
          orgId,
          err: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }
}
