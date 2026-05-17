/**
 * Phase 7.L — Cached wrapper for `runImpactForecast`.
 *
 * Mirrors `src/lib/risk/explainer-cache.ts` pattern:
 *   - 7-day TTL
 *   - Cache key: (orgId, triggerMetric, triggerValueRounded, companyCode,
 *     language, promptVersion, snapshotHash)
 *   - snapshotHash = sha256(companyFinancials + costStructure + triggerMetric)
 *     so cache invalidates when company PnL changes
 *   - Dual-write: Prisma `FeedImpactForecast` table + in-memory Map fallback
 *
 * Bucketization of `triggerValue` (e.g. FAO at 130.3 vs 130.7 hashes to
 * the same key) prevents micro-deltas from re-burning tokens on every
 * scheduler tick. Per-metric bucket sizes:
 *   - FAO_FFPI_NOMINAL → round to 1.0
 *   - BRENT_USD_BBL → round to 1.0
 *   - AZN_USD → round to 0.001
 *   - Default → round to 2 decimals
 */
import { createHash } from "node:crypto"
import { prisma as defaultPrisma } from "@/lib/prisma"
import { tryPrismaThenFallback } from "@/lib/prisma-promotion"
import {
  runImpactForecast,
  type ImpactForecastInput,
  type ImpactForecastOutput,
} from "./impact-forecast"
import { IMPACT_FORECAST_PROMPT_VERSION } from "@/lib/llm/prompts/impact-forecast-system"

export const IMPACT_FORECAST_CACHE_TTL_MS = 7 * 24 * 60 * 60_000

interface CachedEntry {
  output: ImpactForecastOutput
  cachedAt: number
}

const memCache = new Map<string, CachedEntry>()

/**
 * Bucket the trigger value to avoid micro-delta cache misses. Per-metric
 * heuristics tuned for sensible thresholds:
 *   - FAO indices (base 100) → 1 unit
 *   - Brent ($/bbl) → 1 unit
 *   - AZN/USD (~1.7) → 0.001 (3 decimal places)
 *   - Default → 2 decimals
 */
export function bucketizeTriggerValue(metric: string, value: number): number {
  if (/^FAO_/i.test(metric)) return Math.round(value)
  if (/^(BRENT|WTI|NATGAS)_/i.test(metric)) return Math.round(value)
  if (/^AZN_/i.test(metric)) return Math.round(value * 1000) / 1000
  if (/^(STEEL|COPPER|ALUMINUM|LUMBER|SUGAR|WHEAT|CORN|SOYBEAN|OATS|COTTON)_/i.test(metric)) {
    return Math.round(value * 10) / 10
  }
  // Default — 2 decimals
  return Math.round(value * 100) / 100
}

/**
 * Hash over the load-bearing inputs that should invalidate the cache
 * when changed: company financials, cost structure, trigger metric.
 * Excludes the trigger value (bucketized separately) and the language
 * (part of the cache key).
 */
export function impactSnapshotHash(input: ImpactForecastInput): string {
  const payload = {
    company: input.company.code,
    financials: input.companyFinancials,
    costStructure: input.knownCostStructure ?? null,
    metric: input.trigger.metric,
    sensitivity: input.sectorSensitivity,
  }
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 32)
}

export interface GetOrCreateImpactForecastOptions {
  orgId: string
  /** Crossing-rule that fired (for audit + DB row). */
  ruleId: string
  /** Affected company DB id (FK target). */
  affectedCompanyId: string
  /** Bypass cache — used for manual on-demand re-renders. */
  bypassCache?: boolean
}

export interface GetOrCreateImpactForecastResult {
  output: ImpactForecastOutput
  cacheHit: boolean
}

/**
 * Read-through cache:
 *   1. Lookup Prisma by unique key → mirror into mem on hit
 *   2. Fall back to mem cache (covers pre-migrate environments + transient Prisma errors)
 *   3. Miss → call `runImpactForecast` (LLM); errors propagate
 *   4. Persist result to Prisma + mem
 */
export async function getOrCreateImpactForecast(
  input: ImpactForecastInput,
  opts: GetOrCreateImpactForecastOptions,
): Promise<GetOrCreateImpactForecastResult> {
  const triggerValueRounded = bucketizeTriggerValue(
    input.trigger.metric,
    input.trigger.value,
  )
  const hash = impactSnapshotHash(input)
  const cacheKey = `${opts.orgId}:${input.trigger.metric}:${triggerValueRounded}:${input.company.code}:${input.language}:${IMPACT_FORECAST_PROMPT_VERSION}:${hash}`

  if (!opts.bypassCache) {
    const entry = await tryPrismaThenFallback<CachedEntry | undefined>(
      async () => {
        const row = await defaultPrisma.feedImpactForecast.findUnique({
          where: {
            organizationId_triggerMetric_triggerValueRounded_affectedCompanyId_language_promptVersion_snapshotHash:
              {
                organizationId: opts.orgId,
                triggerMetric: input.trigger.metric,
                triggerValueRounded,
                affectedCompanyId: opts.affectedCompanyId,
                language: input.language,
                promptVersion: IMPACT_FORECAST_PROMPT_VERSION,
                snapshotHash: hash,
              },
          },
        })
        if (!row) return undefined
        const hydrated: CachedEntry = {
          output: {
            scenarios: row.scenarios as ImpactForecastOutput["scenarios"],
            recommendations:
              row.recommendations as ImpactForecastOutput["recommendations"],
            confidence: row.confidence as ImpactForecastOutput["confidence"],
            usage: {
              inputTokens: row.tokensIn,
              outputTokens: row.tokensOut,
            },
          },
          cachedAt: row.generatedAt.getTime(),
        }
        memCache.set(cacheKey, hydrated)
        return hydrated
      },
      () => memCache.get(cacheKey),
    )
    if (entry && Date.now() - entry.cachedAt < IMPACT_FORECAST_CACHE_TTL_MS) {
      return { output: entry.output, cacheHit: true }
    }
  }

  // MISS — call LLM
  const output = await runImpactForecast(input)
  const newEntry: CachedEntry = { output, cachedAt: Date.now() }

  await tryPrismaThenFallback<void>(
    async () => {
      await defaultPrisma.feedImpactForecast.upsert({
        where: {
          organizationId_triggerMetric_triggerValueRounded_affectedCompanyId_language_promptVersion_snapshotHash:
            {
              organizationId: opts.orgId,
              triggerMetric: input.trigger.metric,
              triggerValueRounded,
              affectedCompanyId: opts.affectedCompanyId,
              language: input.language,
              promptVersion: IMPACT_FORECAST_PROMPT_VERSION,
              snapshotHash: hash,
            },
        },
        create: {
          organizationId: opts.orgId,
          triggerSourceCode: input.trigger.sourceCode,
          triggerMetric: input.trigger.metric,
          triggerValueRounded,
          triggerObservedAt: new Date(input.trigger.observedAt),
          ruleId: opts.ruleId,
          affectedCompanyId: opts.affectedCompanyId,
          affectedCompanyCode: input.company.code,
          scenarios: output.scenarios as unknown as object,
          recommendations: output.recommendations as unknown as object,
          confidence: output.confidence,
          language: input.language,
          promptVersion: IMPACT_FORECAST_PROMPT_VERSION,
          snapshotHash: hash,
          tokensIn: output.usage.inputTokens,
          tokensOut: output.usage.outputTokens,
          generatedAt: new Date(newEntry.cachedAt),
        },
        update: {
          scenarios: output.scenarios as unknown as object,
          recommendations: output.recommendations as unknown as object,
          confidence: output.confidence,
          tokensIn: output.usage.inputTokens,
          tokensOut: output.usage.outputTokens,
          generatedAt: new Date(newEntry.cachedAt),
        },
      })
      memCache.set(cacheKey, newEntry)
    },
    () => {
      // Pre-migrate fallback — mem only.
      memCache.set(cacheKey, newEntry)
    },
  )

  return { output, cacheHit: false }
}

/** Test seam — clears mem cache between tests. */
export function _clearImpactForecastMemCacheForTests(): void {
  memCache.clear()
}
