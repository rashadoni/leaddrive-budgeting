/**
 * Phase 7.G Turn LXXXXV (Phase 7.B v2 Day 1) — vendor-agnostic LLM service.
 *
 * Mirror of `src/lib/email/types.ts` factory pattern. Routes/consumers call
 * `getLLMService().generateMapping(input)` (etc.) and stay vendor-blind.
 * Swap to OpenAI / vLLM / self-hosted is a 1-line change in `index.ts`.
 *
 * Per Phase 7.B v2 plan §"Architectural Decisions" item 1: this interface
 * is intentionally narrow this turn (one method) but designed to absorb
 * future callers (Variance Explainer, Board Deck Narration, AI Web Crawler).
 * Adding methods later is non-breaking.
 */

import type { MapperInput, MappingProposal } from "@/lib/onboarding/ai-mapper/types"

export type LLMUsage = {
  inputTokens: number
  outputTokens: number
  modelName: string
  promptVersion: string
}

export type LLMGenerateMappingResult = {
  proposal: MappingProposal
  usage: LLMUsage
}

export interface LLMService {
  /**
   * Generate an AI-mapper proposal from extracted xlsx structure.
   * Vendor-specific impl handles: model routing, system+user prompt
   * delivery, JSON-mode coercion, max-tokens guard, multi-text-block
   * concatenation. All callers stay vendor-blind.
   */
  generateMapping(input: MapperInput, opts?: GenerateMappingOptions): Promise<LLMGenerateMappingResult>
}

export type GenerateMappingOptions = {
  /** Override model name (vendor-specific string). Default: provider's primary. */
  model?: string
  /** Override max-tokens. Default: 8192 (per `feedback_llm_max_tokens.md`). */
  maxTokens?: number
}
