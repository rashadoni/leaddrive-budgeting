/**
 * Phase 7.G Turn LXXXXVI (Phase 7.B v2 Day 3) — AI Mapper proposal cache.
 *
 * Wraps `getLLMService().generateMapping()` with a 24h-TTL cache keyed by
 * `(orgId, structureHash, promptVersion, modelName)`. Mirrors
 * `BoardDeckNarration` cache pattern but **in-memory** for this turn —
 * Prisma `AIMapperProposalCache` table promotion deferred until Prisma
 * migration drift resolved (filed as 🔄 in CARRYOVER alongside
 * coa_role_change audit emission).
 *
 * **Value captured by in-memory** (per Phase 7.B v2 plan §3):
 * - Single-session 5-entity-template case: user analyzes AZMADE rev6-LLS
 *   then immediately analyzes rev6-SPARK (same template, different data) —
 *   cache hit saves $0.05 + 10-30s.
 * - Repeat analyze of same upload (e.g. user clicks "Re-analyze" after
 *   tweaking sample row).
 *
 * **Value lost vs Prisma persistence:**
 * - Cache lost on Next.js process restart (LaunchAgent restart, deploy).
 * - Cache not shared across replicas (single-process today via LaunchAgent;
 *   future-proofing only matters at scale).
 *
 * **Heuristic anomaly pre-pass (Day 2)** — runs AFTER cache hit/miss on
 * the LIVE input data. Cached `proposal.anomalies` from cache key are
 * dropped; rebuilt from live data. Only `columns` + `accountTypeOverrides`
 * + `summary` + `overallConfidence` are cached (value-independent).
 */

import { getLLMService, type LLMUsage } from "@/lib/llm"
import { computeStructureHash } from "./structure-hash"
import { detectHeuristicAnomalies, mergeAnomalies } from "./anomaly-rules"
import type { MapperInput, MappingProposal, Anomaly } from "./types"

export const PROPOSAL_CACHE_TTL_MS = 24 * 60 * 60 * 1000

type CachedEntry = {
  /** Cached fields — value-independent (column structure + role inference). */
  baseProposal: Omit<MappingProposal, "sourceFile" | "sourceSheet" | "anomalies" | "usage">
  /** LLM-flagged anomalies cached too (value-dependent BUT acceptable —
   * if user uploads a different version of same template, anomaly
   * specifics change but pattern is similar; merge with fresh heuristic
   * pass on cache hit). */
  llmAnomalies: Anomaly[]
  usage: LLMUsage
  cachedAt: number
}

/**
 * Cache map: key = `${orgId}:${structureHash}:${promptVersion}:${modelName}`.
 * Singleton in-memory store. Clear via `clearProposalCacheForTests()`.
 */
const cache = new Map<string, CachedEntry>()

export function clearProposalCacheForTests(): void {
  cache.clear()
}

/** Test seam — inspect cache size for assertions. */
export function getCacheSizeForTests(): number {
  return cache.size
}

export type GetOrCreateProposalOptions = {
  orgId: string
  language?: string
  /** Bypass cache (force fresh LLM call). */
  bypassCache?: boolean
  /** Override LLM model. */
  model?: string
  /** Override max tokens. */
  maxTokens?: number
}

export type GetOrCreateProposalResult = {
  proposal: MappingProposal
  usage: LLMUsage
  /** True if served from cache (no LLM call this turn). */
  cacheHit: boolean
}

export async function getOrCreateProposal(
  input: MapperInput,
  opts: GetOrCreateProposalOptions,
): Promise<GetOrCreateProposalResult> {
  const language = opts.language ?? "en"
  const structureHash = computeStructureHash(input, language)

  // Cache lookup — if hit and not stale, rebuild full proposal from cached
  // base + fresh heuristic anomaly pass.
  if (!opts.bypassCache) {
    const llm = getLLMService()
    // Resolve usage.modelName + promptVersion via a single dummy call?
    // No — we need cache key BEFORE the call. Use a sentinel "any-model"
    // key that only matches when model+promptVersion match the LIVE
    // service's defaults. Trade-off: forces cache invalidation on model
    // bump (which is the right behavior — different model could produce
    // different mapping).
    //
    // Cleanest: use the AnthropicLLMService's known constants. For
    // in-memory provider, modelName is "in-memory" — distinct cache key.
    const cacheKey = await computeCacheKey(opts.orgId, structureHash, llm)
    const entry = cache.get(cacheKey)
    if (entry && Date.now() - entry.cachedAt < PROPOSAL_CACHE_TTL_MS) {
      const heuristic = detectHeuristicAnomalies(input, {
        ...entry.baseProposal,
        sourceFile: input.sourceFile,
        sourceSheet: input.sourceSheet,
      })
      const merged = mergeAnomalies(entry.llmAnomalies, heuristic)
      return {
        proposal: {
          ...entry.baseProposal,
          sourceFile: input.sourceFile,
          sourceSheet: input.sourceSheet,
          anomalies: merged,
          usage: { inputTokens: 0, outputTokens: 0 }, // cache hit = no spend
        },
        usage: { ...entry.usage, inputTokens: 0, outputTokens: 0 },
        cacheHit: true,
      }
    }
  }

  // Cache miss (or bypass) — call LLM
  const result = await getLLMService().generateMapping(input, {
    model: opts.model,
    maxTokens: opts.maxTokens,
  })

  // Write to cache (overwrites stale entry if any)
  const cacheKey = `${opts.orgId}:${structureHash}:${result.usage.promptVersion}:${result.usage.modelName}`
  cache.set(cacheKey, {
    baseProposal: {
      summary: result.proposal.summary,
      overallConfidence: result.proposal.overallConfidence,
      columns: result.proposal.columns,
      accountTypeOverrides: result.proposal.accountTypeOverrides,
    },
    llmAnomalies: result.proposal.anomalies,
    usage: result.usage,
    cachedAt: Date.now(),
  })

  return { proposal: result.proposal, usage: result.usage, cacheHit: false }
}

/** Build cache key — needs LLM service to resolve modelName + promptVersion.
 * Uses a dry-run via a sentinel that doesn't actually call the LLM. */
async function computeCacheKey(
  orgId: string,
  structureHash: string,
  _llmService: unknown,
): Promise<string> {
  // We can't know modelName+promptVersion without making a call. Workaround:
  // import the constants directly. In a multi-provider future, this becomes
  // a `getProviderMetadata()` method on LLMService.
  const { MAPPER_PROMPT_VERSION } = await import("@/lib/llm/prompts/mapper-system")
  const provider = process.env.LLM_PROVIDER ?? "anthropic"
  // Anthropic provider uses AI_MODEL constant; in-memory uses "in-memory" string.
  let modelName: string
  if (provider === "in-memory") {
    modelName = "in-memory"
  } else {
    const { AI_MODEL } = await import("@/lib/ai/client")
    modelName = AI_MODEL
  }
  return `${orgId}:${structureHash}:${MAPPER_PROMPT_VERSION}:${modelName}`
}
