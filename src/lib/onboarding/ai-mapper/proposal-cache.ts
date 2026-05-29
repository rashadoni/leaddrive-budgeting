/**
 * Phase 7.G Turn LXXXXVI (Phase 7.B v2 Day 3) — AI Mapper proposal cache.
 * **Promoted Turn LXXXXII** to dual-write: Prisma `AIMapperProposalCache`
 * primary, in-memory Map fallback when migration not yet applied. See
 * `src/lib/prisma-promotion.ts` for the helper rationale.
 *
 * Wraps `getLLMService().generateMapping()` with a 24h-TTL cache keyed by
 * `(orgId, structureHash, promptVersion, modelName)`.
 *
 * **Value captured by Prisma persistence (post-migrate):**
 * - Cache survives Next.js process restart (LaunchAgent kickstart, deploy).
 * - Cache shared across replicas (multi-region future).
 * - Templates `(isTemplate=true)` durable forever — promoted templates
 *   carry across sessions / browser tabs / users.
 *
 * **Value captured by in-memory (fallback when table missing):**
 * - Single-session 5-entity-template case: user analyzes AZMADE rev6-LLS
 *   then immediately analyzes rev6-SPARK (same template, different data) —
 *   cache hit saves $0.05 + 10-30s.
 * - Repeat analyze of same upload (e.g. user clicks "Re-analyze" after
 *   tweaking sample row).
 *
 * **Heuristic anomaly pre-pass (Day 2)** — runs AFTER cache hit/miss on
 * the LIVE input data. Cached `proposal.anomalies` from cache key are
 * dropped; rebuilt from live data. Only `columns` + `accountTypeOverrides`
 * + `summary` + `overallConfidence` are cached (value-independent).
 */

import { getLLMService, type LLMUsage } from "@/lib/llm"
import { prisma as defaultPrisma } from "@/lib/prisma"
import { tryPrismaThenFallback } from "@/lib/prisma-promotion"
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
  /** Phase 7.B v2 Day 5: template promotion. When true, entry bypasses TTL
   * (forever-cached) and surfaces in `listTemplates()`. Promote via
   * `promoteCacheEntryToTemplate()`. */
  isTemplate?: boolean
  /** User-supplied label for promoted template (e.g. "AZMADE 2026 P&L"). */
  templateName?: string
  /** Times this template was used (auto-incremented on each cache hit
   * when isTemplate=true). */
  applyCount?: number
  lastUsedAt?: number
}

/**
 * In-memory cache map: key = `${orgId}:${structureHash}:${promptVersion}:${modelName}`.
 * Singleton in-memory store. Used as fallback when Prisma table missing,
 * AND as write-through for read-consistency in same-request lifetimes.
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

/** Build the in-memory cache key from key components. */
function buildCacheKey(
  orgId: string,
  structureHash: string,
  promptVersion: string,
  modelName: string,
): string {
  return `${orgId}:${structureHash}:${promptVersion}:${modelName}`
}

/** Hydrate an in-memory CachedEntry from a Prisma row. */
function entryFromPrismaRow(row: {
  proposal: unknown
  llmAnomalies: unknown
  tokensIn: number
  tokensOut: number
  cachedAt: Date
  promptVersion: string
  modelName: string
  isTemplate: boolean
  templateName: string | null
  applyCount: number
  lastUsedAt: Date | null
}): CachedEntry {
  const baseProposal = row.proposal as CachedEntry["baseProposal"]
  const llmAnomalies = (row.llmAnomalies as Anomaly[]) ?? []
  return {
    baseProposal,
    llmAnomalies,
    usage: {
      inputTokens: row.tokensIn,
      outputTokens: row.tokensOut,
      modelName: row.modelName,
      promptVersion: row.promptVersion,
    },
    cachedAt: row.cachedAt.getTime(),
    isTemplate: row.isTemplate,
    templateName: row.templateName ?? undefined,
    applyCount: row.applyCount,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.getTime() : undefined,
  }
}

export async function getOrCreateProposal(
  input: MapperInput,
  opts: GetOrCreateProposalOptions,
): Promise<GetOrCreateProposalResult> {
  const language = opts.language ?? "en"
  const structureHash = computeStructureHash(input, language)
  const { promptVersion, modelName } = await resolveCacheKeyMetadata()
  const cacheKey = buildCacheKey(opts.orgId, structureHash, promptVersion, modelName)

  // ── READ path: Prisma → memory fallback ────────────────────────────
  if (!opts.bypassCache) {
    const entry = await tryPrismaThenFallback<CachedEntry | undefined>(
      async () => {
        const row = await defaultPrisma.aIMapperProposalCache.findUnique({
          where: {
            organizationId_structureHash_promptVersion_modelName: {
              organizationId: opts.orgId,
              structureHash,
              promptVersion,
              modelName,
            },
          },
        })
        if (!row) return undefined
        const hydrated = entryFromPrismaRow(row)
        // Mirror to in-memory for same-request reads (no extra DB hit).
        cache.set(cacheKey, hydrated)
        return hydrated
      },
      () => cache.get(cacheKey),
    )

    // Templates (isTemplate=true) bypass TTL — forever-cached until deleted.
    const isFresh =
      entry && (entry.isTemplate || Date.now() - entry.cachedAt < PROPOSAL_CACHE_TTL_MS)
    if (entry && isFresh) {
      // Increment template usage stats — write-through to Prisma if available
      if (entry.isTemplate) {
        const newApplyCount = (entry.applyCount ?? 0) + 1
        const newLastUsedAt = Date.now()
        entry.applyCount = newApplyCount
        entry.lastUsedAt = newLastUsedAt
        // Persist counter bump — best-effort, fall through if table missing
        await tryPrismaThenFallback<void>(
          async () => {
            await defaultPrisma.aIMapperProposalCache.update({
              where: {
                organizationId_structureHash_promptVersion_modelName: {
                  organizationId: opts.orgId,
                  structureHash,
                  promptVersion,
                  modelName,
                },
              },
              data: {
                applyCount: newApplyCount,
                lastUsedAt: new Date(newLastUsedAt),
              },
            })
          },
          () => {
            // No-op — counter already bumped on `entry`
          },
        )
      }
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

  // ── MISS path: call LLM ────────────────────────────────────────────
  const result = await getLLMService().generateMapping(input, {
    model: opts.model,
    maxTokens: opts.maxTokens,
  })

  const baseProposal: CachedEntry["baseProposal"] = {
    summary: result.proposal.summary,
    overallConfidence: result.proposal.overallConfidence,
    columns: result.proposal.columns,
    accountTypeOverrides: result.proposal.accountTypeOverrides,
  }
  const newEntry: CachedEntry = {
    baseProposal,
    llmAnomalies: result.proposal.anomalies,
    usage: result.usage,
    cachedAt: Date.now(),
  }

  // ── WRITE path: Prisma upsert + in-memory mirror ───────────────────
  await tryPrismaThenFallback<void>(
    async () => {
      await defaultPrisma.aIMapperProposalCache.upsert({
        where: {
          organizationId_structureHash_promptVersion_modelName: {
            organizationId: opts.orgId,
            structureHash,
            promptVersion: result.usage.promptVersion,
            modelName: result.usage.modelName,
          },
        },
        create: {
          organizationId: opts.orgId,
          structureHash,
          promptVersion: result.usage.promptVersion,
          modelName: result.usage.modelName,
          proposal: baseProposal as unknown as object,
          llmAnomalies: result.proposal.anomalies as unknown as object,
          tokensIn: result.usage.inputTokens,
          tokensOut: result.usage.outputTokens,
          cachedAt: new Date(newEntry.cachedAt),
          // Reset template fields on fresh write (overwrites stale entry).
          isTemplate: false,
          applyCount: 0,
        },
        update: {
          proposal: baseProposal as unknown as object,
          llmAnomalies: result.proposal.anomalies as unknown as object,
          tokensIn: result.usage.inputTokens,
          tokensOut: result.usage.outputTokens,
          cachedAt: new Date(newEntry.cachedAt),
        },
      })
      // Mirror in-memory for same-request reads.
      cache.set(
        buildCacheKey(opts.orgId, structureHash, result.usage.promptVersion, result.usage.modelName),
        newEntry,
      )
    },
    () => {
      // Pre-migrate fallback — write to in-memory only.
      cache.set(
        buildCacheKey(opts.orgId, structureHash, result.usage.promptVersion, result.usage.modelName),
        newEntry,
      )
    },
  )

  return { proposal: result.proposal, usage: result.usage, cacheHit: false }
}

// ─── Phase 7.B v2 Day 5 — template library helpers ───────────────────────

export type TemplateInfo = {
  cacheKey: string
  templateName: string
  structureHash: string
  applyCount: number
  lastUsedAt: number | null
  cachedAt: number
}

/**
 * Promote an existing cache entry to a permanent template. Caller MUST have
 * just run `getOrCreateProposal()` for this orgId+hash so the entry exists.
 * Idempotent — re-promoting overwrites name + resets applyCount.
 *
 * Returns true on success, false if no cache entry exists for given key.
 */
export async function promoteCacheEntryToTemplate(
  orgId: string,
  input: MapperInput,
  templateName: string,
  language: string = "en",
): Promise<boolean> {
  const structureHash = computeStructureHash(input, language)
  const { promptVersion, modelName } = await resolveCacheKeyMetadata()
  const cacheKey = buildCacheKey(orgId, structureHash, promptVersion, modelName)

  // Promote-or-fail: try Prisma update first; if table missing, fall to in-memory.
  return await tryPrismaThenFallback<boolean>(
    async () => {
      // Find first to discriminate "no row" from "table missing" cleanly.
      const row = await defaultPrisma.aIMapperProposalCache.findUnique({
        where: {
          organizationId_structureHash_promptVersion_modelName: {
            organizationId: orgId,
            structureHash,
            promptVersion,
            modelName,
          },
        },
      })
      if (!row) {
        // Maybe in-memory has it but Prisma doesn't (test mode, mid-promotion)
        const memoryEntry = cache.get(cacheKey)
        if (!memoryEntry) return false
        memoryEntry.isTemplate = true
        memoryEntry.templateName = templateName
        memoryEntry.applyCount = memoryEntry.applyCount ?? 0
        memoryEntry.lastUsedAt = memoryEntry.lastUsedAt ?? null as unknown as number
        return true
      }
      await defaultPrisma.aIMapperProposalCache.update({
        where: {
          organizationId_structureHash_promptVersion_modelName: {
            organizationId: orgId,
            structureHash,
            promptVersion,
            modelName,
          },
        },
        data: {
          isTemplate: true,
          templateName,
          // Don't reset applyCount on re-promotion — preserve historical use
        },
      })
      // Mirror to in-memory
      const memoryEntry = cache.get(cacheKey)
      if (memoryEntry) {
        memoryEntry.isTemplate = true
        memoryEntry.templateName = templateName
        memoryEntry.applyCount = memoryEntry.applyCount ?? 0
        memoryEntry.lastUsedAt = memoryEntry.lastUsedAt ?? null as unknown as number
      } else {
        cache.set(cacheKey, entryFromPrismaRow({ ...row, isTemplate: true, templateName }))
      }
      return true
    },
    () => {
      const entry = cache.get(cacheKey)
      if (!entry) return false
      entry.isTemplate = true
      entry.templateName = templateName
      entry.applyCount = entry.applyCount ?? 0
      entry.lastUsedAt = entry.lastUsedAt ?? null as unknown as number
      return true
    },
  )
}

/**
 * List all approved templates for an org. Returned sorted by `lastUsedAt`
 * desc (most-recently-used first). Reads from Prisma when available;
 * falls back to scanning in-memory map when table missing.
 */
export async function listTemplates(orgId: string): Promise<TemplateInfo[]> {
  return await tryPrismaThenFallback<TemplateInfo[]>(
    async () => {
      const rows = await defaultPrisma.aIMapperProposalCache.findMany({
        where: { organizationId: orgId, isTemplate: true },
        orderBy: { lastUsedAt: { sort: "desc", nulls: "last" } },
      })
      return rows.map((row: {
        organizationId: string
        structureHash: string
        promptVersion: string
        modelName: string
        templateName: string | null
        applyCount: number
        lastUsedAt: Date | null
        cachedAt: Date
      }) => ({
        cacheKey: buildCacheKey(row.organizationId, row.structureHash, row.promptVersion, row.modelName),
        templateName: row.templateName ?? "(unnamed)",
        structureHash: row.structureHash,
        applyCount: row.applyCount,
        lastUsedAt: row.lastUsedAt ? row.lastUsedAt.getTime() : null,
        cachedAt: row.cachedAt.getTime(),
      }))
    },
    () => {
      const orgPrefix = `${orgId}:`
      const result: TemplateInfo[] = []
      for (const [key, entry] of cache.entries()) {
        if (!key.startsWith(orgPrefix)) continue
        if (!entry.isTemplate) continue
        // Parse cacheKey shape: ${orgId}:${structureHash}:${promptVersion}:${modelName}
        const parts = key.split(":")
        const structureHash = parts[1] ?? ""
        result.push({
          cacheKey: key,
          templateName: entry.templateName ?? "(unnamed)",
          structureHash,
          applyCount: entry.applyCount ?? 0,
          lastUsedAt: entry.lastUsedAt ?? null,
          cachedAt: entry.cachedAt,
        })
      }
      result.sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
      return result
    },
  )
}

/**
 * Synchronous in-memory-only list used by callers that can't await
 * (legacy code paths). Prefer `listTemplates()` for new callers.
 *
 * @deprecated since LXXXXII — use async `listTemplates()` for Prisma reads.
 */
export function listTemplatesSync(orgId: string): TemplateInfo[] {
  const orgPrefix = `${orgId}:`
  const result: TemplateInfo[] = []
  for (const [key, entry] of cache.entries()) {
    if (!key.startsWith(orgPrefix)) continue
    if (!entry.isTemplate) continue
    const parts = key.split(":")
    const structureHash = parts[1] ?? ""
    result.push({
      cacheKey: key,
      templateName: entry.templateName ?? "(unnamed)",
      structureHash,
      applyCount: entry.applyCount ?? 0,
      lastUsedAt: entry.lastUsedAt ?? null,
      cachedAt: entry.cachedAt,
    })
  }
  result.sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
  return result
}

/**
 * Delete a template (and its underlying cache entry). Returns true if
 * found and removed, false if no such cache key.
 *
 * Async — performs Prisma delete with in-memory fallback.
 */
export async function deleteTemplate(cacheKey: string): Promise<boolean> {
  // Parse cacheKey to extract Prisma-side identifiers
  const parts = cacheKey.split(":")
  const [orgId, structureHash, promptVersion, modelName] = parts
  if (!orgId || !structureHash || !promptVersion || !modelName) {
    return cache.delete(cacheKey)
  }

  return await tryPrismaThenFallback<boolean>(
    async () => {
      try {
        await defaultPrisma.aIMapperProposalCache.delete({
          where: {
            organizationId_structureHash_promptVersion_modelName: {
              organizationId: orgId,
              structureHash,
              promptVersion,
              modelName,
            },
          },
        })
        cache.delete(cacheKey)
        return true
      } catch (e: unknown) {
        // P2025 = "Record to delete does not exist" — treat as not found
        const code = e && typeof e === "object" ? (e as { code?: unknown }).code : undefined
        if (code === "P2025") {
          // Still try in-memory delete (might exist there only)
          return cache.delete(cacheKey)
        }
        throw e
      }
    },
    () => cache.delete(cacheKey),
  )
}

/** Resolve cache-key metadata (promptVersion + modelName) used to address rows.
 *  Anthropic provider uses AI_MODEL constant; in-memory uses "in-memory" string. */
async function resolveCacheKeyMetadata(): Promise<{ promptVersion: string; modelName: string }> {
  const { MAPPER_PROMPT_VERSION } = await import("@/lib/llm/prompts/mapper-system")
  const provider = process.env.LLM_PROVIDER ?? "anthropic"
  let modelName: string
  if (provider === "in-memory") {
    modelName = "in-memory"
  } else {
    const { AI_MODEL } = await import("@/lib/ai/client")
    modelName = AI_MODEL
  }
  return { promptVersion: MAPPER_PROMPT_VERSION, modelName }
}

