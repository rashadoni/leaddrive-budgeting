/**
 * AI Data Mapper — vendor-agnostic entry point.
 *
 * Phase 7.G Turn LXXXXV (Phase 7.B v2 Day 1): refactored to thin wrapper
 * around `getLLMService().generateMapping()`. SYSTEM_PROMPT + user-message
 * builder moved to `src/lib/llm/prompts/mapper-system.ts` (single source
 * of truth across providers). Heuristic anomaly merge moved inside provider
 * impls (every provider ensures merge runs).
 *
 * Critical safety: the LLM is *advisory*. Proposal shown to a finance
 * reviewer in onboarding UI; nothing lands in DB until reviewer confirms.
 */

import { getLLMService } from "@/lib/llm"
import type { MapperInput, MappingProposal } from "./types"
import { getOrCreateProposal } from "./proposal-cache"

/**
 * Run the AI mapper. Throws on API failure (caller handles); returns
 * `MappingProposal` on success. **Does NOT write to DB** — pure proposal.
 *
 * @param input parsed xlsx structure (see `extractMapperInput`).
 * @param opts optional overrides — e.g. `model` for testing with cheaper tier.
 *   - `orgId`: when provided, uses cache (Phase 7.B v2 Day 3 — saves $0.05+10s
 *     per re-analyze of same template). Without orgId, calls LLM directly.
 *   - `language`: cache key component (default "en")
 *   - `bypassCache`: force fresh LLM call
 */
export async function runMapper(
  input: MapperInput,
  opts: {
    model?: string
    maxTokens?: number
    orgId?: string
    language?: string
    bypassCache?: boolean
  } = {},
): Promise<MappingProposal> {
  // Cache path requires orgId (multi-tenant isolation key).
  if (opts.orgId) {
    const cached = await getOrCreateProposal(input, {
      orgId: opts.orgId,
      language: opts.language,
      bypassCache: opts.bypassCache,
      model: opts.model,
      maxTokens: opts.maxTokens,
    })
    return cached.proposal
  }
  // Bypass cache when no orgId (e.g. CLI scripts, POC tooling)
  const result = await getLLMService().generateMapping(input, opts)
  return result.proposal
}
