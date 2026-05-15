/**
 * Phase 7.H Feature B — news sentiment scoring.
 *
 * Pure module: takes a list of IntelItem rows and asks the LLM to score
 * each one's finance-relevant sentiment in [-1, +1] for the holding's
 * CFO perspective. Caller (crawler / backfill script) handles fetching
 * rows + persisting scores.
 *
 * Cost shape: 1 LLM call per batch (≤ 50 items). At 50 items/day per
 * org and ~$0.01/call, this is ~$0.30/month per org — same magnitude
 * as the news-summary digest.
 *
 * Mirror of `news-summary.ts` pattern: system prompt, JSON-out, optional
 * test-seam SDK injection, defensive parse.
 */

import type Anthropic from "@anthropic-ai/sdk"
import { getAnthropicClient, AI_MODEL } from "@/lib/ai/client"
import { extractJsonFromText } from "@/lib/onboarding/ai-mapper/json-extract"

export interface SentimentInputItem {
  id: string
  title: string
  summary: string
  companyTags: string[]
  industryTags: string[]
}

export interface SentimentResult {
  scores: Map<string, number>
  usage: { inputTokens: number; outputTokens: number }
}

export interface RunSentimentBatchOptions {
  client?: Anthropic
  model?: string
}

const MAX_TOKENS = 4096
const MAX_BATCH_SIZE = 50

const SYSTEM_PROMPT = `You are a financial sentiment analyst scoring news articles for the CFO of an Azerbaijani diversified industrial holding (~60 companies across 14 sectors: hospitality, agro, food, pharma, real estate, services, industrial, etc.).

You will receive a JSON array of news items. Each has: id, title, summary, companyTags[], industryTags[].

For EACH item, return a sentiment score in [-1.0, +1.0] from the holding's financial point of view:
  +1.0 = very bullish (strongly positive for revenue / margins / risk profile)
  +0.5 = positive (favorable conditions, tailwind)
   0.0 = neutral / mixed / unrelated to financial outcomes
  -0.5 = negative (headwind, cost pressure, demand softness)
  -1.0 = very bearish (severe risk: regulatory, supply shock, demand collapse, geopolitical)

Heuristics (sector-aware — read industryTags + companyTags first; an item without a relevant tag is usually neutral 0.0):

GENERIC:
  - "AAC cocoa supplier reduced shipments" → AAC sees cost pressure → -0.6
  - "AZN strengthens vs USD by 2%" → improves import-heavy companies' margin → +0.3
  - "Government raises minimum wage 15%" → labor cost up across holding → -0.4
  - "Tourism growth Azerbaijan +12% YoY" → positive for hospitality companies → +0.6

AGRO / FOOD_PROCESSING (Phase 7.I — sugar/cane heuristics for AzerSheker pilot):
  - "ICE Sugar #11 closes up 4% on Brazilian crop fears" → tailwind for sugar producers → +0.5
  - "Sugar futures slump 6% as Indian export window opens" → headwind for our sugar exposure → -0.6
  - "Drought warning issued for Salyan / Imishli / Mil-Karabakh plain" → cane yield risk → -0.7
  - "Heavy rainfall + flooding in southern Azerbaijan" → cane logistics + waterlogging risk → -0.5
  - "Urea / NPK fertilizer prices spike 12%" → input cost up for agro_crops → -0.4
  - "Diesel subsidies extended for agriculture" → mechanization cost down → +0.3
  - "Government raises sugar import tariff" → protects domestic producers (food_processing) → +0.5
  - "EU sugar quota relaxation" → competitor flood, headwind for domestic refiners → -0.4
  - "Genetically engineered cane variety boosts sucrose yield 8%" → R&D tailwind → +0.4
  - Pure macro stat with no actionable angle → 0.0

Context clues to attend to: explicit mention of "sugar", "cane", "beet", "yield", "harvest", "fertilizer", "irrigation", "drought", "frost", "ICE", "Pink Sheet", "extraction rate", "Salyan/Imishli/Sabirabad" → bump up specificity of score (more positive OR more negative).

Output JSON ONLY: { "scores": [{ "id": "...", "score": -0.4 }, ...] }
  - One entry per input item, in the same order.
  - No commentary, no markdown fences.
  - If unable to score (truly off-topic / corrupt text) return score 0.0.`

export async function runSentimentBatch(
  items: SentimentInputItem[],
  opts: RunSentimentBatchOptions = {},
): Promise<SentimentResult> {
  if (items.length === 0) {
    return { scores: new Map(), usage: { inputTokens: 0, outputTokens: 0 } }
  }
  if (items.length > MAX_BATCH_SIZE) {
    throw new Error(
      `runSentimentBatch: batch size ${items.length} exceeds MAX_BATCH_SIZE ${MAX_BATCH_SIZE}; chunk caller-side`,
    )
  }

  const client = opts.client ?? getAnthropicClient()
  const model = opts.model ?? AI_MODEL
  const userMessage = JSON.stringify({ items })

  const res = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
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
      `runSentimentBatch: LLM did not return parseable JSON (${(err as Error).message})`,
    )
  }

  const scores = new Map<string, number>()
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "scores" in parsed &&
    Array.isArray((parsed as { scores: unknown }).scores)
  ) {
    for (const entry of (parsed as { scores: Array<{ id?: unknown; score?: unknown }> }).scores) {
      if (typeof entry.id !== "string") continue
      // Strict: only accept actual numeric scores. null / "bad" / undefined
      // all skipped — the LLM should explicitly emit 0.0 for "neutral",
      // not omit-by-null.
      if (typeof entry.score !== "number" || !Number.isFinite(entry.score)) continue
      const clamped = Math.max(-1, Math.min(1, entry.score))
      scores.set(entry.id, clamped)
    }
  }

  const usage = {
    inputTokens: res.usage?.input_tokens ?? 0,
    outputTokens: res.usage?.output_tokens ?? 0,
  }
  return { scores, usage }
}
