/**
 * Phase 7.G Turn LXXXXV (Phase 7.E #1 D.5b) — commodity ingest pipeline.
 *
 * Loops over `[adapter, ...]`, fetches each, writes results to Prisma
 * `IntelDataPoint` table OR in-memory fallback (via `tryPrismaThenFallback`).
 *
 * **Why centralized:** keeps adapters pure (HTTP+parse only). Persistence
 * concerns (org-scoping, Prisma upsert shape, dedup, in-memory mirror)
 * live here. Adapters can be unit-tested without DB; ingest can be unit-
 * tested with stubbed adapters.
 *
 * **Idempotency:** Prisma unique constraint on
 * `(organizationId, sourceCode, metric, datetime)` enforces dedup. Re-
 * running ingest within the same day → upsert overwrites with latest
 * value (acceptable: the most recent observation wins).
 *
 * **Pre-migrate fallback:** when `IntelDataPoint` table doesn't exist,
 * tryPrismaThenFallback writes to a module-level in-memory Map. Loses on
 * restart; the next scheduled run re-fetches + repopulates.
 *
 * **Reads:** post-migrate, query Prisma directly. Pre-migrate, call
 * `getInMemoryDataPoints(orgId, sourceCode?)`. The variance explainer
 * intel-fusion (E.1b) consumer should use Prisma reads with this helper's
 * read-through pattern when ready.
 */

import { Prisma } from "@prisma/client"
import { prisma as defaultPrisma } from "@/lib/prisma"
import { prismaAdmin } from "@/lib/db/prisma-admin"
import { tryPrismaThenFallback } from "@/lib/prisma-promotion"
import type { CommodityAdapter, CommodityDataPoint, CommodityFetchResult } from "./types"
import { checkPlausibility } from "./plausibility"

/** In-memory fallback map. Key = `${orgId}:${sourceCode}:${metric}:${ISO datetime}`. */
const memoryStore = new Map<string, CommodityDataPoint & { organizationId: string }>()

function memoryKey(
  orgId: string,
  sourceCode: string,
  metric: string,
  datetime: Date,
): string {
  return `${orgId}:${sourceCode}:${metric}:${datetime.toISOString()}`
}

export function clearCommodityMemoryForTests(): void {
  memoryStore.clear()
}

export function getCommodityMemorySize(): number {
  return memoryStore.size
}

/** Fetch all data points stored in memory for an org, optionally filtered
 *  by sourceCode. Used by E.1b intel-fusion until Prisma migration applied. */
export function getInMemoryDataPoints(
  orgId: string,
  sourceCode?: string,
): Array<CommodityDataPoint & { organizationId: string }> {
  const out: Array<CommodityDataPoint & { organizationId: string }> = []
  const prefix = `${orgId}:${sourceCode ?? ""}`
  for (const [key, value] of memoryStore.entries()) {
    if (sourceCode) {
      if (!key.startsWith(prefix)) continue
    } else {
      if (!key.startsWith(`${orgId}:`)) continue
    }
    out.push(value)
  }
  return out
}

export interface IngestOptions {
  /** Test seam: override Prisma client. Default = real prisma from @/lib/prisma. */
  prisma?: typeof defaultPrisma
}

export interface IngestResult {
  /** Per-adapter fetch envelope, preserved 1:1 for forensics. */
  perSource: CommodityFetchResult[]
  /** Total points written across all sources (counts in-memory + Prisma identically). */
  pointsWritten: number
  /** Per-adapter / per-write errors aggregated. */
  errors: string[]
}

/**
 * Run all adapters, persist results for a given org.
 *
 * Per-row try/catch — one adapter failing doesn't abort the others. Per-
 * write try/catch handled by `tryPrismaThenFallback` (table-missing →
 * memory). Real DB errors (FK / type) bubble up via thrown error.
 */
export async function ingestCommodityData(
  orgId: string,
  adapters: CommodityAdapter[],
  opts: IngestOptions = {},
  now: Date = new Date(),
): Promise<IngestResult> {
  const prisma = opts.prisma ?? prismaAdmin
  const perSource: CommodityFetchResult[] = []
  const errors: string[] = []
  let pointsWritten = 0

  for (const adapter of adapters) {
    let result: CommodityFetchResult
    try {
      result = await adapter.fetch(now)
    } catch (e) {
      const msg = `Adapter ${adapter.source} threw: ${e instanceof Error ? e.message : String(e)}`
      errors.push(msg)
      perSource.push({ source: adapter.source, dataPoints: [], errors: [msg], fetched: false })
      continue
    }
    perSource.push(result)
    errors.push(...result.errors.map((e) => `${adapter.source}: ${e}`))

    for (const point of result.dataPoints) {
      // Skip non-finite values defensively (adapters should pre-filter)
      if (!Number.isFinite(point.value)) {
        errors.push(`${adapter.source}: dropped non-finite value for ${point.metric}`)
        continue
      }

      // Phase 7.M Step 1 (2026-05-18) — plausibility gate. Centralised
      // last-line-of-defence against structurally impossible values
      // (e.g. UN Comtrade 2025-partial-year writing −$23B "balance").
      // A point that fails the registry is rejected here, BEFORE the
      // Prisma upsert; no recompute, no UI display, no false signal.
      // The rule id + value land in `errors[]` so the scheduler audit
      // surfaces which feed is misbehaving without silently corrupting
      // the holding's risk picture.
      const plaus = checkPlausibility(point.metric, point.value)
      if (!plaus.ok) {
        errors.push(
          `${adapter.source}: REJECTED ${point.metric}=${point.value} [rule:${plaus.ruleId}] ${plaus.reason ?? ""}`,
        )
        continue
      }
      try {
        await tryPrismaThenFallback<void>(
          async () => {
            await prisma.intelDataPoint.upsert({
              where: {
                organizationId_sourceCode_metric_datetime: {
                  organizationId: orgId,
                  sourceCode: point.sourceCode,
                  metric: point.metric,
                  datetime: point.datetime,
                },
              },
              create: {
                organizationId: orgId,
                sourceCode: point.sourceCode,
                metric: point.metric,
                datetime: point.datetime,
                value: point.value,
                unit: point.unit ?? null,
                raw: (point.raw ?? Prisma.JsonNull) as Prisma.NullableJsonNullValueInput,
              },
              update: {
                value: point.value,
                unit: point.unit ?? null,
                raw: (point.raw ?? Prisma.JsonNull) as Prisma.NullableJsonNullValueInput,
                fetchedAt: new Date(),
              },
            })
            // Mirror to memory for read-through
            memoryStore.set(
              memoryKey(orgId, point.sourceCode, point.metric, point.datetime),
              { ...point, organizationId: orgId },
            )
          },
          () => {
            // Fallback: write to memory only
            memoryStore.set(
              memoryKey(orgId, point.sourceCode, point.metric, point.datetime),
              { ...point, organizationId: orgId },
            )
          },
        )
        pointsWritten++
      } catch (e) {
        errors.push(
          `${adapter.source}: write failed for ${point.metric} — ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    }
  }

  return { perSource, pointsWritten, errors }
}
