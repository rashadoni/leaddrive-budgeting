/**
 * Phase 7.G Turn LXXXXV (Phase 7.B v2 Day 1) — LLM service factory.
 *
 * Singleton factory. Routes call `getLLMService()` and consume `LLMService`
 * interface — never reach for a concrete impl directly. Mirror of
 * `src/lib/email/index.ts` pattern.
 *
 * Selection (env-driven):
 *   - `LLM_PROVIDER === "anthropic"` → AnthropicLLMService (default for any
 *     non-test/non-prod env when ANTHROPIC_API_KEY is set)
 *   - `LLM_PROVIDER === "in-memory"` → InMemoryLLMService (TEST/DEV ONLY;
 *     throws in production per Phase 7.B v2 plan Risk #2)
 *   - default (no env): Anthropic if key present; else throw
 *
 * Future: `"openai-compat"` impl reads LLM_BASE_URL + LLM_MODEL + LLM_API_KEY.
 */

import { AnthropicLLMService } from "./anthropic"
import { InMemoryLLMService } from "./in-memory"
import { hasAnthropicKey } from "@/lib/ai/client"
import type { LLMService } from "./types"

let instance: LLMService | null = null

export function getLLMService(): LLMService {
  if (instance) return instance

  const provider = process.env.LLM_PROVIDER
  const isProd = process.env.NODE_ENV === "production"

  // Production safety gate: in-memory MUST NOT be used in production
  // (would silently return canned proposals = data corruption).
  if (provider === "in-memory" && isProd) {
    throw new Error(
      "LLM_PROVIDER=in-memory is not allowed in production. Set LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY before deploy.",
    )
  }

  if (provider === "in-memory") {
    instance = new InMemoryLLMService()
    return instance
  }

  if (provider === "anthropic" || provider === undefined || provider === "") {
    if (!hasAnthropicKey()) {
      throw new Error(
        "LLM provider 'anthropic' selected but ANTHROPIC_API_KEY is not set. Add it to .env or set LLM_PROVIDER=in-memory for tests.",
      )
    }
    instance = new AnthropicLLMService()
    return instance
  }

  throw new Error(
    `Unknown LLM_PROVIDER='${provider}'. Supported: anthropic, in-memory.`,
  )
}

/**
 * Sentinel for routes that want a 503 "no LLM configured" check before
 * doing expensive work. Returns true if either ANTHROPIC_API_KEY is set
 * (so we'd resolve to AnthropicLLMService) or LLM_PROVIDER=in-memory
 * (test mode).
 */
export function hasLLMConfigured(): boolean {
  if (process.env.LLM_PROVIDER === "in-memory") return true
  return hasAnthropicKey()
}

/** Test-only: reset singleton. */
export function resetLLMServiceForTests(): void {
  instance = null
}

export type {
  LLMService,
  LLMGenerateMappingResult,
  LLMUsage,
  GenerateMappingOptions,
} from "./types"
export { setMockProposal } from "./in-memory"
