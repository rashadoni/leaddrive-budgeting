/**
 * Phase 7.G Turn LXXXXVIII (Phase 7.E #3 v2 E.2b) — predictive-breach persistence.
 *
 * Wraps the pure `scanForBreaches` output (LXXXXVII E.2a) with Prisma
 * `PredictiveBreach` durable storage + in-memory fallback (drift-blocked).
 * Mirrors the pattern shipped LXXXXII for the 3 caches: post-migrate writes
 * to Prisma; pre-migrate falls to in-memory map + read-through.
 *
 * **Idempotency:** Prisma unique constraint
 *   `(organizationId, period, companyId, indicatorCode, horizonStep)`
 * means re-running the scan within the same period overwrites with the
 * latest forecast — acceptable: a fresh recompute should refresh stale
 * predictions.
 *
 * **Caller flow (E.2b wire):**
 *   1. recompute pipeline finishes → assemble `BreachForecasterInput[]`
 *   2. `scanForBreaches(inputs)` → `ForecastedBreach[]` (pure, LXXXXVII)
 *   3. `evaluateAndPersistBreaches(orgId, breaches)` (this module)
 *   4. Optional: emit `predictive_breach_compute` audit event
 *
 * Caller is the future E.2c wire into `runRecomputeForCompanies` post-IV-write
 * + the future BreachForecastPanel API consumer.
 */

import { Prisma } from "@prisma/client"
import { prisma as defaultPrisma } from "@/lib/prisma"
import { prismaAdmin } from "@/lib/db/prisma-admin"
import { tryPrismaThenFallback } from "@/lib/prisma-promotion"
import type { ForecastedBreach } from "./breach-forecaster"

/** In-memory fallback. Key = `${orgId}:${period}:${companyId}:${indicatorCode}:${horizonStep}`.
 *  Same composite as Prisma unique constraint → identical dedup semantics. */
const memoryStore = new Map<string, ForecastedBreach & { organizationId: string; computedAt: Date }>()

function memoryKey(orgId: string, b: Pick<ForecastedBreach, "period" | "companyId" | "indicatorCode" | "horizonStep">): string {
  return `${orgId}:${b.period}:${b.companyId}:${b.indicatorCode}:${b.horizonStep}`
}

export function clearBreachMemoryForTests(): void {
  memoryStore.clear()
}

export function getBreachMemorySize(): number {
  return memoryStore.size
}

/** Read-through helper for E.2d UI consumer. Reads from Prisma when
 *  available, falls back to in-memory map when table missing. */
export async function getPredictiveBreaches(
  orgId: string,
  filter: { period?: string; minConfidenceBand?: "low" | "medium" | "high" } = {},
  // Stage 3 RLS — accept a scope tx client so the route can run this read
  // inside withOrgScope (the SET LOCAL app.organization_id applies).
  opts: { prisma?: typeof defaultPrisma | Prisma.TransactionClient } = {},
): Promise<Array<ForecastedBreach & { organizationId: string; computedAt: Date }>> {
  const prisma = opts.prisma ?? prismaAdmin
  const minBandRank: Record<"low" | "medium" | "high", number> = { low: 0, medium: 1, high: 2 }

  return await tryPrismaThenFallback<Array<ForecastedBreach & { organizationId: string; computedAt: Date }>>(
    async () => {
      const where: Record<string, unknown> = { organizationId: orgId }
      if (filter.period) where.period = filter.period
      if (filter.minConfidenceBand) {
        // Bands are strings in Prisma (no enum). Filter at SQL level by IN clause.
        const allowed: string[] = []
        for (const [band, rank] of Object.entries(minBandRank)) {
          if (rank >= minBandRank[filter.minConfidenceBand]) allowed.push(band)
        }
        where.confidenceBand = { in: allowed }
      }
      const rows = await prisma.predictiveBreach.findMany({
        where,
        orderBy: [{ period: "desc" }, { horizonStep: "asc" }, { confidenceBand: "desc" }],
      })
      return rows.map((row: {
        organizationId: string
        companyId: string
        indicatorCode: string
        period: string
        horizonStep: number
        currentStatus: string
        predictedStatus: string
        forecastConfidence: number
        confidenceBand: string
        predictedValue: number
        predictedLower: number | null
        predictedUpper: number | null
        drivers: unknown
        computedAt: Date
      }) => ({
        organizationId: row.organizationId,
        companyId: row.companyId,
        indicatorCode: row.indicatorCode,
        period: row.period,
        horizonStep: row.horizonStep,
        currentStatus: row.currentStatus as ForecastedBreach["currentStatus"],
        predictedStatus: row.predictedStatus as ForecastedBreach["predictedStatus"],
        forecastConfidence: row.forecastConfidence,
        confidenceBand: row.confidenceBand as ForecastedBreach["confidenceBand"],
        predictedValue: row.predictedValue,
        predictedLower: row.predictedLower ?? undefined,
        predictedUpper: row.predictedUpper ?? undefined,
        drivers: (row.drivers as Record<string, unknown> | null) ?? undefined,
        computedAt: row.computedAt,
      }))
    },
    () => {
      const out: Array<ForecastedBreach & { organizationId: string; computedAt: Date }> = []
      const orgPrefix = `${orgId}:`
      for (const [key, value] of memoryStore.entries()) {
        if (!key.startsWith(orgPrefix)) continue
        if (filter.period && value.period !== filter.period) continue
        if (filter.minConfidenceBand) {
          if (minBandRank[value.confidenceBand] < minBandRank[filter.minConfidenceBand]) continue
        }
        out.push(value)
      }
      // Sort to match Prisma orderBy: period desc → horizonStep asc → confidenceBand desc
      out.sort((a, b) => {
        if (a.period !== b.period) return b.period.localeCompare(a.period)
        if (a.horizonStep !== b.horizonStep) return a.horizonStep - b.horizonStep
        return b.confidenceBand.localeCompare(a.confidenceBand)
      })
      return out
    },
  )
}

export interface PersistResult {
  written: number
  errors: string[]
}

/**
 * Persist a batch of `ForecastedBreach` rows. Per-row try/catch — one
 * write failure doesn't abort the batch (matches existing intel ingest
 * pattern from LXXXXV).
 *
 * Idempotent: re-running with same composite key updates row in place +
 * bumps `computedAt`. Stale predictions (e.g. `horizonStep=3` forecast
 * from a past scan) get OVERWRITTEN by the latest scan's value — caller
 * is responsible for clearing rows that no longer apply.
 */
export async function evaluateAndPersistBreaches(
  organizationId: string,
  breaches: ForecastedBreach[],
  opts: { prisma?: typeof defaultPrisma } = {},
): Promise<PersistResult> {
  const prisma = opts.prisma ?? prismaAdmin
  const errors: string[] = []
  let written = 0
  const computedAt = new Date()

  for (const b of breaches) {
    try {
      await tryPrismaThenFallback<void>(
        async () => {
          await prisma.predictiveBreach.upsert({
            where: {
              organizationId_period_companyId_indicatorCode_horizonStep: {
                organizationId,
                period: b.period,
                companyId: b.companyId,
                indicatorCode: b.indicatorCode,
                horizonStep: b.horizonStep,
              },
            },
            create: {
              organizationId,
              companyId: b.companyId,
              indicatorCode: b.indicatorCode,
              period: b.period,
              horizonStep: b.horizonStep,
              currentStatus: b.currentStatus,
              predictedStatus: b.predictedStatus,
              forecastConfidence: b.forecastConfidence,
              confidenceBand: b.confidenceBand,
              predictedValue: b.predictedValue,
              predictedLower: b.predictedLower ?? null,
              predictedUpper: b.predictedUpper ?? null,
              drivers: (b.drivers ?? Prisma.JsonNull) as Prisma.NullableJsonNullValueInput,
              computedAt,
            },
            update: {
              currentStatus: b.currentStatus,
              predictedStatus: b.predictedStatus,
              forecastConfidence: b.forecastConfidence,
              confidenceBand: b.confidenceBand,
              predictedValue: b.predictedValue,
              predictedLower: b.predictedLower ?? null,
              predictedUpper: b.predictedUpper ?? null,
              drivers: (b.drivers ?? Prisma.JsonNull) as Prisma.NullableJsonNullValueInput,
              computedAt,
            },
          })
          // Mirror to memory for read-through
          memoryStore.set(memoryKey(organizationId, b), {
            ...b,
            organizationId,
            computedAt,
          })
        },
        () => {
          // Pre-migrate fallback — write to in-memory only
          memoryStore.set(memoryKey(organizationId, b), {
            ...b,
            organizationId,
            computedAt,
          })
        },
      )
      written++
    } catch (e) {
      errors.push(
        `${b.companyId}/${b.indicatorCode}@${b.period}+${b.horizonStep}: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  return { written, errors }
}

/**
 * Bulk-clear breaches matching a filter. Useful when re-scanning and the
 * caller wants to drop stale rows that no longer apply (e.g. an indicator
 * that was at-risk last scan but is now stable).
 *
 * Returns count of rows deleted.
 */
export async function clearBreaches(
  organizationId: string,
  filter: { period?: string; companyId?: string; indicatorCode?: string } = {},
  opts: { prisma?: typeof defaultPrisma } = {},
): Promise<number> {
  const prisma = opts.prisma ?? prismaAdmin

  return await tryPrismaThenFallback<number>(
    async () => {
      const where: Record<string, unknown> = { organizationId }
      if (filter.period) where.period = filter.period
      if (filter.companyId) where.companyId = filter.companyId
      if (filter.indicatorCode) where.indicatorCode = filter.indicatorCode
      const result = await prisma.predictiveBreach.deleteMany({ where })
      // Mirror — clear matching memory rows too
      const orgPrefix = `${organizationId}:`
      for (const [key, val] of memoryStore.entries()) {
        if (!key.startsWith(orgPrefix)) continue
        if (filter.period && val.period !== filter.period) continue
        if (filter.companyId && val.companyId !== filter.companyId) continue
        if (filter.indicatorCode && val.indicatorCode !== filter.indicatorCode) continue
        memoryStore.delete(key)
      }
      return result.count
    },
    () => {
      let removed = 0
      const orgPrefix = `${organizationId}:`
      for (const [key, val] of memoryStore.entries()) {
        if (!key.startsWith(orgPrefix)) continue
        if (filter.period && val.period !== filter.period) continue
        if (filter.companyId && val.companyId !== filter.companyId) continue
        if (filter.indicatorCode && val.indicatorCode !== filter.indicatorCode) continue
        memoryStore.delete(key)
        removed++
      }
      return removed
    },
  )
}
