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

/**
 * Run the AI mapper. Throws on API failure (caller handles); returns
 * `MappingProposal` on success. **Does NOT write to DB** — pure proposal.
 *
 * @param input parsed xlsx structure (see `extractMapperInput`).
 * @param opts optional overrides — e.g. `model` for testing with cheaper tier.
 */
export async function runMapper(
  input: MapperInput,
  opts: { model?: string; maxTokens?: number } = {},
): Promise<MappingProposal> {
  const result = await getLLMService().generateMapping(input, opts)
  return result.proposal
}
