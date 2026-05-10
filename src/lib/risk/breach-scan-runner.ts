/**
 * Phase 7.G Turn C (Phase 7.E #3 v2 E.2e) — breach scan runner.
 *
 * Pure orchestrator: loads `IndicatorValue` rows for an org's current
 * period (joined with definition thresholds + sparkline), maps to
 * `BreachForecasterInput[]`, calls `scanForBreaches` (E.2a), persists
 * via `evaluateAndPersistBreaches` (E.2b). Single entry-point callable
 * from intel-scheduler post-crawl, manual admin trigger, or test harness.
 *
 * **Why this layer:** keeps the data-loading concerns isolated from the
 * pure breach math + persistence — both of which already have full test
 * coverage. This module's tests stub Prisma + verify the wiring.
 *
 * **Period selection:** scans the LATEST period available per
 * (companyId, indicatorId) — i.e. the most-recently-computed IV. Stale
 * predictions for older periods are NOT touched (caller can call
 * `clearBreaches` separately to GC).
 *
 * **No LLM:** breach detection is pure regression. The optional LLM
 * digest of top breaches lives in a separate future module
 * (`breach-digest.ts`) — out of scope for E.2e's "wire scan into
 * scheduler" deliverable.
 */

import { prisma as defaultPrisma } from "@/lib/prisma"
import { tryPrismaThenFallback } from "@/lib/prisma-promotion"
import {
  scanForBreaches,
  type BreachForecasterInput,
  type BreachForecasterOptions,
} from "./breach-forecaster"
import {
  evaluateAndPersistBreaches,
  type PersistResult,
} from "./breach-persist"
import type { IndicatorStatus, Thresholds } from "./formula-engine"

export interface RunBreachScanOptions extends BreachForecasterOptions {
  /** Optional period filter — only scan IVs in this period. Default: all
   *  recent IVs (post-cutoffMs). */
  period?: string
  /** Recency cutoff in ms — only IVs computed within this window are
   *  scanned. Default 31 days (covers monthly cadence with grace). */
  cutoffMs?: number
  /** "Now" for tests. */
  now?: Date
  /** Test seam: inject Prisma. */
  prisma?: typeof defaultPrisma
}

export interface RunBreachScanResult {
  /** Number of IVs loaded from DB / fallback. */
  ivsLoaded: number
  /** Number of IVs the scanner actually had history for. */
  ivsScanned: number
  /** Total breaches surfaced + persisted. */
  breachesPersisted: number
  /** Per-stage errors (load + scan + persist combined). */
  errors: string[]
  /** Pass-through persist result for caller forensics. */
  persist: PersistResult
}

const DEFAULT_CUTOFF_MS = 31 * 24 * 60 * 60 * 1000

/** Validate a sparkline JSON value into ReadonlyArray<number|null>.
 *  Defensive — Prisma returns Json; bad shapes drop quietly. */
function coerceSparkline(raw: unknown): Array<number | null> | null {
  if (!Array.isArray(raw)) return null
  const out: Array<number | null> = []
  for (const v of raw) {
    if (v === null) {
      out.push(null)
    } else if (typeof v === "number" && Number.isFinite(v)) {
      out.push(v)
    } else {
      // Mixed shape — caller's data is corrupt; bail
      return null
    }
  }
  return out
}

/** Validate a thresholds JSON value. Returns null if shape doesn't match. */
function coerceThresholds(raw: unknown): Thresholds | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  for (const key of ["green", "amber", "red"] as const) {
    const band = obj[key]
    if (!band || typeof band !== "object") return null
    const b = band as Record<string, unknown>
    if (typeof b.op !== "string") return null
  }
  return obj as unknown as Thresholds
}

const ALLOWED_STATUSES: IndicatorStatus[] = ["green", "amber", "red", "unknown"]

/**
 * Run a full breach scan for an org. Loads IVs → maps to inputs → scans
 * → persists. Designed to be safe to call repeatedly (idempotent at the
 * persist layer via composite-key dedup).
 */
export async function runBreachScanForOrg(
  organizationId: string,
  opts: RunBreachScanOptions = {},
): Promise<RunBreachScanResult> {
  const prisma = opts.prisma ?? defaultPrisma
  const now = opts.now ?? new Date()
  const cutoff = new Date(now.getTime() - (opts.cutoffMs ?? DEFAULT_CUTOFF_MS))
  const errors: string[] = []

  // 1. Load recent IVs joined with indicator definition thresholds.
  //    Pre-migrate fallback returns []; scan becomes a no-op (which is
  //    correct: no data → no forecasts).
  const rows = await tryPrismaThenFallback<
    Array<{
      companyId: string
      period: string
      sparkline: unknown
      status: string
      indicator: { code: string; thresholds: unknown }
    }>
  >(
    async () => {
      const where: Record<string, unknown> = {
        organizationId,
        computedAt: { gte: cutoff },
      }
      if (opts.period) where.period = opts.period
      return await prisma.indicatorValue.findMany({
        where,
        select: {
          companyId: true,
          period: true,
          sparkline: true,
          status: true,
          indicator: { select: { code: true, thresholds: true } },
        },
      })
    },
    () => [],
  )

  // 2. Map to BreachForecasterInput[], dropping rows with bad shape.
  const inputs: BreachForecasterInput[] = []
  for (const row of rows) {
    const sparkline = coerceSparkline(row.sparkline)
    if (!sparkline) {
      errors.push(`${row.companyId}/${row.indicator.code}@${row.period}: bad sparkline shape`)
      continue
    }
    const thresholds = coerceThresholds(row.indicator.thresholds)
    if (!thresholds) {
      errors.push(`${row.companyId}/${row.indicator.code}@${row.period}: bad thresholds shape`)
      continue
    }
    if (!ALLOWED_STATUSES.includes(row.status as IndicatorStatus)) {
      errors.push(`${row.companyId}/${row.indicator.code}@${row.period}: unknown status "${row.status}"`)
      continue
    }
    inputs.push({
      indicatorCode: row.indicator.code,
      companyId: row.companyId,
      period: row.period,
      sparkline,
      thresholds,
      currentStatus: row.status as IndicatorStatus,
    })
  }

  // 3. Run pure scanner.
  const scan = scanForBreaches(inputs, { horizonSteps: opts.horizonSteps })
  errors.push(...scan.stats.errors)

  // 4. Persist (with in-memory fallback baked in).
  const persist = await evaluateAndPersistBreaches(organizationId, scan.breaches, { prisma })
  errors.push(...persist.errors)

  return {
    ivsLoaded: rows.length,
    ivsScanned: scan.stats.ivsWithSufficientHistory,
    breachesPersisted: persist.written,
    errors,
    persist,
  }
}
