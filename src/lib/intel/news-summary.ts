/**
 * Phase 7.H Feature 1 — Today's Brief AI news summary.
 *
 * Pure module: takes a list of IntelItem rows (already crawled, scored,
 * stored) and asks the LLM to produce 5 concise bullets for the CFO.
 *
 * Caller (API route) handles: fetching IntelItem rows, RBAC scoping,
 * cache lookup, audit logging, rate limiting. This module just shapes
 * the prompt + parses the response.
 */

import type Anthropic from "@anthropic-ai/sdk"
import { getAnthropicClient, AI_MODEL } from "@/lib/ai/client"
import { extractJsonFromText } from "@/lib/onboarding/ai-mapper/json-extract"
import {
  buildNewsSummarySystemPrompt,
  type NewsSummaryLanguage,
} from "@/lib/llm/prompts/news-summary-system"

export type { NewsSummaryLanguage }

export interface NewsSummaryInput {
  items: Array<{
    title: string
    summary: string
    url: string
    sourceLabel: string
    relevanceScore: number
    industryTags: string[]
    companyTags: string[]
    publishedAt: string | null
  }>
  language: NewsSummaryLanguage
}

export interface NewsSummaryResult {
  bullets: string[]
  usage: { inputTokens: number; outputTokens: number }
}

export interface RunNewsSummaryOptions {
  /** Test seam — inject a fake SDK client for unit tests. */
  client?: Anthropic
  /** Override model for cheaper/faster test runs. */
  model?: string
}

const MAX_TOKENS = 8192
const MAX_BULLETS = 5

export async function runNewsSummary(
  input: NewsSummaryInput,
  opts: RunNewsSummaryOptions = {},
): Promise<NewsSummaryResult> {
  if (input.items.length === 0) {
    return { bullets: [], usage: { inputTokens: 0, outputTokens: 0 } }
  }

  const client = opts.client ?? getAnthropicClient()
  const model = opts.model ?? AI_MODEL
  const system = buildNewsSummarySystemPrompt(input.language)
  const userMessage = JSON.stringify({ items: input.items })

  const res = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: userMessage }],
  })

  // Extract text from response (Anthropic returns content blocks).
  let raw = ""
  for (const block of res.content) {
    if (block.type === "text") raw += block.text
  }

  let parsed: unknown
  try {
    parsed = extractJsonFromText(raw)
  } catch (err) {
    throw new Error(
      `News summary LLM returned non-JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const bullets = validateAndShape(parsed)

  return {
    bullets,
    usage: {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    },
  }
}

/** Defensive parse: ensure response matches { bullets: string[] }
 *  contract. Reject rather than render garbage. */
function validateAndShape(parsed: unknown): string[] {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("News summary response is not an object")
  }
  const obj = parsed as Record<string, unknown>
  if (!Array.isArray(obj.bullets)) {
    throw new Error("News summary response missing `bullets` array")
  }
  const bullets: string[] = []
  for (const b of obj.bullets) {
    if (typeof b !== "string") continue
    const trimmed = b.trim()
    if (trimmed.length === 0) continue
    if (trimmed.length > 200) {
      // Tolerate slight overrun — clamp instead of rejecting the whole result.
      bullets.push(trimmed.slice(0, 197) + "…")
    } else {
      bullets.push(trimmed)
    }
    if (bullets.length >= MAX_BULLETS) break
  }
  return bullets
}
