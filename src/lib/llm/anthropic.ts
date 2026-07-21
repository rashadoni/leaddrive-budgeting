/**
 * Anthropic LLM provider impl. Wraps existing `getAnthropicClient()` +
 * `AI_MODEL`. System prompt + JSON validation reused from
 * `mapper-system.ts` + `json-extract.ts` so every provider sees identical
 * inputs.
 *
 * Phase 7.G Turn LXXXXV (Phase 7.B v2 Day 1).
 */

import { getAnthropicClient, AI_MODEL } from "@/lib/ai/client"
import { renderInputForPrompt } from "@/lib/onboarding/ai-mapper/extract"
import { extractJsonFromText } from "@/lib/onboarding/ai-mapper/json-extract"
import type {
  MapperInput,
  MappingProposal,
} from "@/lib/onboarding/ai-mapper/types"
import { isIsoCurrencyCode, isMapperColumnRole } from "@/lib/onboarding/ai-mapper/types"
import { detectHeuristicAnomalies, mergeAnomalies } from "@/lib/onboarding/ai-mapper/anomaly-rules"
import { MAPPER_SYSTEM_PROMPT, MAPPER_PROMPT_VERSION, buildMapperUserMessage } from "./prompts/mapper-system"
import type { LLMService, LLMGenerateMappingResult, GenerateMappingOptions } from "./types"

export class AnthropicLLMService implements LLMService {
  async generateMapping(
    input: MapperInput,
    opts: GenerateMappingOptions = {},
  ): Promise<LLMGenerateMappingResult> {
    const client = getAnthropicClient()
    const model = opts.model ?? AI_MODEL
    const maxTokens = opts.maxTokens ?? 8192

    const userMessage = buildMapperUserMessage(renderInputForPrompt(input))

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: MAPPER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    })

    if (response.stop_reason === "max_tokens") {
      throw new Error(
        `LLM Mapper truncated at max_tokens=${maxTokens}. Re-run with higher maxTokens (response clipped mid-JSON).`,
      )
    }

    const textBlocks = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
    if (textBlocks.length === 0) {
      throw new Error(
        `LLM Mapper response had no text content (got: ${JSON.stringify(response.content.map((b) => b.type))})`,
      )
    }
    const raw = textBlocks.join("\n").trim()

    const jsonText = extractJsonFromText(raw)

    let parsed: Omit<MappingProposal, "sourceFile" | "sourceSheet" | "usage">
    try {
      parsed = JSON.parse(jsonText)
    } catch (err) {
      throw new Error(
        `LLM Mapper returned invalid JSON. Error: ${err instanceof Error ? err.message : err}.\nFirst 300 chars: ${jsonText.slice(0, 300)}`,
      )
    }

    // Light shape validation — same as legacy mapper.ts
    const requiredFields = ["summary", "overallConfidence", "columns", "anomalies"] as const
    for (const f of requiredFields) {
      if (!(f in parsed)) {
        throw new Error(
          `LLM Mapper response missing required field "${f}". Keys: ${Object.keys(parsed).join(", ")}`,
        )
      }
    }
    if (!Array.isArray(parsed.columns)) {
      throw new Error(`AI Mapper "columns" is not an array (got: ${typeof parsed.columns})`)
    }
    if (!Array.isArray(parsed.anomalies)) {
      throw new Error(`AI Mapper "anomalies" is not an array (got: ${typeof parsed.anomalies})`)
    }

    // Per-element shape validation. Without this, a malformed LLM response
    // like `[{role: 123, confidence: "high"}]` JSON-parses fine but breaks
    // every downstream consumer. Validate at the proposal boundary.
    for (let i = 0; i < parsed.columns.length; i++) {
      const c = parsed.columns[i] as unknown as Record<string, unknown>
      if (typeof c.sourceIndex !== "number") {
        throw new Error(`AI Mapper columns[${i}].sourceIndex must be number (got ${typeof c.sourceIndex})`)
      }
      if (typeof c.role !== "string") {
        throw new Error(`AI Mapper columns[${i}].role must be string (got ${typeof c.role})`)
      }
      if (!isMapperColumnRole(c.role)) {
        throw new Error(`AI Mapper columns[${i}].role is not an allowed mapper role (got ${c.role})`)
      }
      if (c.currencyCode !== undefined && !isIsoCurrencyCode(c.currencyCode)) {
        throw new Error(`AI Mapper columns[${i}].currencyCode must be a three-letter ISO code`)
      }
      if (
        typeof c.confidence !== "number" ||
        !Number.isFinite(c.confidence) ||
        c.confidence < 0 ||
        c.confidence > 1
      ) {
        throw new Error(
          `AI Mapper columns[${i}].confidence must be finite number in [0,1] (got ${c.confidence})`,
        )
      }
      if (typeof c.reasoning !== "string") {
        throw new Error(`AI Mapper columns[${i}].reasoning must be string`)
      }
    }
    for (let i = 0; i < parsed.anomalies.length; i++) {
      const a = parsed.anomalies[i] as unknown as Record<string, unknown>
      if (a.row !== null && typeof a.row !== "number") {
        throw new Error(`AI Mapper anomalies[${i}].row must be number or null`)
      }
      if (typeof a.severity !== "string" || !["critical", "warning", "info"].includes(a.severity)) {
        throw new Error(
          `AI Mapper anomalies[${i}].severity must be 'critical'|'warning'|'info' (got '${a.severity}')`,
        )
      }
      if (typeof a.category !== "string") {
        throw new Error(`AI Mapper anomalies[${i}].category must be string`)
      }
      if (typeof a.description !== "string") {
        throw new Error(`AI Mapper anomalies[${i}].description must be string`)
      }
    }

    // Merge LLM anomalies with heuristic pre-pass (Day 2 module).
    const partial = {
      sourceFile: input.sourceFile,
      sourceSheet: input.sourceSheet,
      summary: parsed.summary,
      overallConfidence: parsed.overallConfidence,
      columns: parsed.columns,
      accountTypeOverrides: parsed.accountTypeOverrides ?? [],
    }
    const heuristic = detectHeuristicAnomalies(input, partial)
    const mergedAnomalies = mergeAnomalies(parsed.anomalies, heuristic)

    return {
      proposal: {
        ...partial,
        anomalies: mergedAnomalies,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      },
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        modelName: model,
        promptVersion: MAPPER_PROMPT_VERSION,
      },
    }
  }
}
