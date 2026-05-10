/**
 * Phase 7.G Turn LXXXXVIII (Phase 7.E #2 v2 E.1a) — Variance Explainer cache.
 * **Promoted Turn LXXXXII** to dual-write: Prisma `VarianceExplanation`
 * primary, in-memory Map fallback when migration not yet applied. See
 * `src/lib/prisma-promotion.ts` for the helper rationale.
 *
 * Wraps `runExplainer()` with 24h-TTL cache keyed by
 * `(orgId, indicatorValueId, language, snapshotHash)`.
 *
 * **Why cache matters here:**
 * Per Phase 7.E v2 plan §"Capability #2": CFO clicks "Explain" on the
 * same red cell repeatedly (when re-checking, sharing with colleague,
 * comparing against last quarter). v1 had in-memory cache scoped to
 * single component instance — page refresh → re-pay $0.05 + 5-15s LLM
 * call. This module raises cache lifetime to 24h shared across page
 * loads + tabs.
 *
 * **Cache key components:**
 * - orgId: multi-tenant isolation
 * - indicatorValueId: cell identity
 * - language: en/ru/az output (different language = different cache row)
 * - snapshotHash: hash over IV.value + IV.computedAt + relevantIntelIds
 *   (intel context fusion E.1b future). Re-recompute changes hash →
 *   cache invalidates automatically.
 */

import { createHash } from "node:crypto"
import { prisma as defaultPrisma } from "@/lib/prisma"
import { tryPrismaThenFallback } from "@/lib/prisma-promotion"
import {
  runExplainer,
  EXPLAINER_PROMPT_VERSION,
  type VarianceExplainerInput,
  type VarianceExplainerOutput,
  type ExplainerLanguage,
} from "./variance-explainer"

export const EXPLAINER_CACHE_TTL_MS = 24 * 60 * 60 * 1000

type CachedEntry = {
  output: VarianceExplainerOutput
  cachedAt: number
}

const cache = new Map<string, CachedEntry>()

/** Test-only: clear in-memory storage. */
export function clearExplainerCacheForTests(): void {
  cache.clear()
}

/** Test-only: inspect cache size. */
export function getExplainerCacheSizeForTests(): number {
  return cache.size
}

/**
 * Build snapshot hash for cache key. Includes value + period + resolved
 * inputs (the load-bearing fields the LLM actually sees). Excludes
 * `company.name` (display only) and `error.reason` (free-form variance
 * — but `error.code` IS included since it shapes recommendations).
 *
 * Future E.1b: extend with `relevantIntelIds[]` so cache invalidates when
 * fresh intel arrives (avoid stale "FX spiked per Reuters X" when X is
 * 30 days old).
 */
export function snapshotHash(input: VarianceExplainerInput): string {
  const stable = {
    indicator: input.indicator.code,
    period: input.result.period,
    value: input.result.value,
    status: input.result.status,
    resolved: input.resolved,
    errorCode: input.error?.code ?? null,
    industry: input.company.industry,
    tags: (input.company.tags ?? []).slice().sort(),
  }
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 16)
}

export type GetOrCreateExplanationOptions = {
  orgId: string
  indicatorValueId: string
  /** Bypass cache (force fresh LLM call). */
  bypassCache?: boolean
}

export type GetOrCreateExplanationResult = {
  output: VarianceExplainerOutput
  cacheHit: boolean
}

/**
 * Cache-or-compute wrapper around runExplainer. On cache hit: returns
 * stored output with no LLM call (cacheHit=true, output.usage from
 * original miss). On miss: calls runExplainer, caches result, returns.
 *
 * Graceful degradation: if `runExplainer` throws (LLM down), error
 * propagates — caller decides fallback (UI shows error banner; legacy
 * variance-explainer-panel renders error state already).
 */
export async function getOrCreateExplanation(
  input: VarianceExplainerInput,
  opts: GetOrCreateExplanationOptions,
): Promise<GetOrCreateExplanationResult> {
  const hash = snapshotHash(input)
  const cacheKey = `${opts.orgId}:${opts.indicatorValueId}:${input.language}:${EXPLAINER_PROMPT_VERSION}:${hash}`

  // ── READ path: Prisma → memory fallback ────────────────────────────
  if (!opts.bypassCache) {
    const entry = await tryPrismaThenFallback<CachedEntry | undefined>(
      async () => {
        const row = await defaultPrisma.varianceExplanation.findUnique({
          where: {
            organizationId_indicatorValueId_language_promptVersion_snapshotHash: {
              organizationId: opts.orgId,
              indicatorValueId: opts.indicatorValueId,
              language: input.language,
              promptVersion: EXPLAINER_PROMPT_VERSION,
              snapshotHash: hash,
            },
          },
        })
        if (!row) return undefined
        const hydrated: CachedEntry = {
          output: row.output as unknown as VarianceExplainerOutput,
          cachedAt: row.cachedAt.getTime(),
        }
        // Mirror to in-memory for hot reads
        cache.set(cacheKey, hydrated)
        return hydrated
      },
      () => cache.get(cacheKey),
    )

    if (entry && Date.now() - entry.cachedAt < EXPLAINER_CACHE_TTL_MS) {
      return { output: entry.output, cacheHit: true }
    }
  }

  // ── MISS path: call LLM (errors propagate; no cache write on failure) ──
  const output = await runExplainer(input)

  const newEntry: CachedEntry = { output, cachedAt: Date.now() }

  // ── WRITE path: Prisma upsert + in-memory mirror ───────────────────
  await tryPrismaThenFallback<void>(
    async () => {
      await defaultPrisma.varianceExplanation.upsert({
        where: {
          organizationId_indicatorValueId_language_promptVersion_snapshotHash: {
            organizationId: opts.orgId,
            indicatorValueId: opts.indicatorValueId,
            language: input.language,
            promptVersion: EXPLAINER_PROMPT_VERSION,
            snapshotHash: hash,
          },
        },
        create: {
          organizationId: opts.orgId,
          indicatorValueId: opts.indicatorValueId,
          language: input.language,
          promptVersion: EXPLAINER_PROMPT_VERSION,
          snapshotHash: hash,
          output: output as unknown as object,
          tokensIn: output.usage?.inputTokens ?? 0,
          tokensOut: output.usage?.outputTokens ?? 0,
          cachedAt: new Date(newEntry.cachedAt),
        },
        update: {
          output: output as unknown as object,
          tokensIn: output.usage?.inputTokens ?? 0,
          tokensOut: output.usage?.outputTokens ?? 0,
          cachedAt: new Date(newEntry.cachedAt),
        },
      })
      cache.set(cacheKey, newEntry)
    },
    () => {
      // Pre-migrate fallback — write to in-memory only.
      cache.set(cacheKey, newEntry)
    },
  )

  return { output, cacheHit: false }
}

/** Re-export for convenience. */
export type { VarianceExplainerInput, VarianceExplainerOutput, ExplainerLanguage }
