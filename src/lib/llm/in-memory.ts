/**
 * In-memory LLM provider for tests. Returns canned proposals via
 * `setMockProposal()`. Mirrors `InMemoryEmailService` pattern.
 *
 * Production-safety: `getLLMService()` factory THROWS on
 * `LLM_PROVIDER === 'in-memory'` if `process.env.NODE_ENV === 'production'`
 * (Phase 7.B v2 plan Risk #2 mitigation).
 *
 * Phase 7.G Turn LXXXXV (Phase 7.B v2 Day 1).
 */

import type { MapperInput, MappingProposal } from "@/lib/onboarding/ai-mapper/types"
import { detectHeuristicAnomalies, mergeAnomalies } from "@/lib/onboarding/ai-mapper/anomaly-rules"
import type { LLMService, LLMGenerateMappingResult, GenerateMappingOptions } from "./types"
import { MAPPER_PROMPT_VERSION } from "./prompts/mapper-system"

let mockProposal: Omit<MappingProposal, "sourceFile" | "sourceSheet" | "usage"> | null = null

/** Test seam — set the next-call response. */
export function setMockProposal(
  p: Omit<MappingProposal, "sourceFile" | "sourceSheet" | "usage"> | null,
): void {
  mockProposal = p
}

const DEFAULT_PROPOSAL: Omit<MappingProposal, "sourceFile" | "sourceSheet" | "usage"> = {
  summary: "[in-memory stub] No mock set; returning empty proposal.",
  overallConfidence: 0.5,
  columns: [],
  accountTypeOverrides: [],
  anomalies: [],
}

export class InMemoryLLMService implements LLMService {
  async generateMapping(
    input: MapperInput,
    _opts: GenerateMappingOptions = {},
  ): Promise<LLMGenerateMappingResult> {
    const base = mockProposal ?? DEFAULT_PROPOSAL
    const partial = {
      sourceFile: input.sourceFile,
      sourceSheet: input.sourceSheet,
      summary: base.summary,
      overallConfidence: base.overallConfidence,
      columns: base.columns,
      accountTypeOverrides: base.accountTypeOverrides ?? [],
    }
    const heuristic = detectHeuristicAnomalies(input, partial)
    const mergedAnomalies = mergeAnomalies(base.anomalies, heuristic)

    return {
      proposal: {
        ...partial,
        anomalies: mergedAnomalies,
        usage: { inputTokens: 0, outputTokens: 0 },
      },
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        modelName: "in-memory",
        promptVersion: MAPPER_PROMPT_VERSION,
      },
    }
  }
}
