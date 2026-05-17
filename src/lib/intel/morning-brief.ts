/**
 * Phase 7.E AI Morning Brief — pure module.
 *
 * Composes the morning narrative from already-derived terminal data:
 * worst cells + top movers + alerts + news bullets. One LLM call,
 * returns { headline, narrative, priorityAction }.
 *
 * Mirror of news-summary.ts pattern: SDK injection seam, JSON-only
 * output, defensive parse + shape validation.
 */

import type Anthropic from "@anthropic-ai/sdk"
import { getAnthropicClient, AI_MODEL } from "@/lib/ai/client"
import { extractJsonFromText } from "@/lib/onboarding/ai-mapper/json-extract"
import {
  buildMorningBriefSystemPrompt,
  type MorningBriefLanguage,
} from "@/lib/llm/prompts/morning-brief-system"

export type { MorningBriefLanguage }

export interface MorningBriefInput {
  worstCells: Array<{
    companyCode: string
    indicatorCode: string
    value: number
    unit: string
  }>
  topMovers: Array<{
    companyCode: string
    indicatorCode: string
    deltaPct: number
  }>
  activeAlerts: Array<{
    severity: "info" | "warning" | "critical"
    message: string
  }>
  newsBullets: string[]
  /** Company lookup so the LLM can use authoritative names + industries
   *  in the narrative instead of guessing from the code. Without this
   *  the LLM hallucinates classifications (e.g. inventing "фармзаводы"
   *  for ATL-DBZ / ATL-PMZ / ATL-TAZ because the codes end in "Z" /
   *  "Zavodu" without context). Keys = companyCode used in
   *  worstCells/topMovers. */
  companies?: Record<string, { name: string; industry: string | null }>
  language: MorningBriefLanguage
}

export interface MorningBriefResult {
  headline: string
  narrative: string
  priorityAction: string
  usage: { inputTokens: number; outputTokens: number }
}

export interface RunMorningBriefOptions {
  client?: Anthropic
  model?: string
}

const MAX_TOKENS = 2048

export async function runMorningBrief(
  input: MorningBriefInput,
  opts: RunMorningBriefOptions = {},
): Promise<MorningBriefResult> {
  const client = opts.client ?? getAnthropicClient()
  const model = opts.model ?? AI_MODEL
  const system = buildMorningBriefSystemPrompt(input.language)

  const payload = {
    worstCells: input.worstCells.slice(0, 10),
    topMovers: input.topMovers.slice(0, 10),
    activeAlerts: input.activeAlerts.slice(0, 10),
    newsBullets: input.newsBullets.slice(0, 10),
    // Pass company lookup so LLM uses authoritative name+industry
    // rather than inventing classifications from the code suffix.
    companies: input.companies ?? {},
  }

  const res = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: JSON.stringify(payload) }],
  })

  let raw = ""
  for (const block of res.content) {
    if (block.type === "text") raw += block.text
  }

  let parsed: unknown
  try {
    const jsonText = extractJsonFromText(raw)
    parsed = JSON.parse(jsonText)
  } catch (err) {
    throw new Error(
      `runMorningBrief: LLM did not return parseable JSON (${(err as Error).message})`,
    )
  }

  const shaped = validateAndShape(parsed)

  return {
    ...shaped,
    usage: {
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
    },
  }
}

function validateAndShape(parsed: unknown): {
  headline: string
  narrative: string
  priorityAction: string
} {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("runMorningBrief: response is not a JSON object")
  }
  const obj = parsed as Record<string, unknown>
  const headline = typeof obj.headline === "string" ? obj.headline.trim() : ""
  const narrative =
    typeof obj.narrative === "string" ? obj.narrative.trim() : ""
  const priorityAction =
    typeof obj.priorityAction === "string" ? obj.priorityAction.trim() : ""
  if (!headline || !narrative || !priorityAction) {
    throw new Error(
      "runMorningBrief: response missing required fields (headline / narrative / priorityAction)",
    )
  }
  return { headline, narrative, priorityAction }
}
