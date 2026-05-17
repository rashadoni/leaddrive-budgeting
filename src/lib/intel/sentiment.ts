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

HOSPITALITY (Phase 7.K):
  - "AZ tourism arrivals +18% YoY" → positive occupancy demand → +0.6
  - "Visa restrictions added for AZ tourists" → demand drag → -0.5
  - "Hilton Baku opens additional 60 rooms" → competitor capacity expansion → -0.3
  - "F1 / IGF / SOCAR conference confirmed for Baku" → event-driven RevPAR boost → +0.5
  - "Currency devaluation makes AZ destinations cheaper for foreigners" → inbound tourism tailwind → +0.4

PHARMA (Phase 7.K):
  - "MoH AZ approves new drug for hypertension" → portfolio expansion opportunity → +0.4
  - "FDA recalls API supplier batch — AZ market affected" → supply disruption → -0.7
  - "Pharmacheck warns on counterfeit generic batch" → reputational + sales risk → -0.5
  - "Türkiye pharma manufacturer signs AZ distribution deal" → competitive intensity up → -0.3
  - "AZ govt removes pharma import VAT" → cost-side win → +0.4

RETAIL / BEVERAGE (Phase 7.K):
  - "AZ food CPI +12% YoY" → margin compression on staples → -0.4
  - "Bravo opens 8 new stores in regional cities" → competitive intensity up → -0.3
  - "Coca-Cola AZ raises wholesale prices 10%" → demand-side cost pressure → -0.2
  - "Sugar tax draft circulating in Milli Majlis" → potential demand drag for sugary drinks → -0.5
  - "AZN strengthens vs USD" → import-heavy retail margin tailwind → +0.4

CONSTRUCTION / REAL ESTATE (Phase 7.K):
  - "Steel HRC futures up 8% on China demand" → input cost pressure for construction → -0.5
  - "AZ govt awards $2bn highway tender" → backlog opportunity for general contractors → +0.6
  - "Baku CBD office cap rate compresses to 9.5%" → real-estate valuation tailwind → +0.4
  - "Akkord wins Caspian port expansion contract" → competitor backlog up → -0.2
  - "Cement plant explosion in Gəncə cuts regional supply 30%" → supply shock, mixed effect → 0.0

POULTRY (Phase 7.K):
  - "Corn futures up 12% on US drought" → feed cost pressure for AZ poultry → -0.6
  - "Avian flu outbreak in Iran near AZ border" → biosecurity risk + import substitution opp → -0.3
  - "Azersun poultry capacity expansion announced" → domestic price floor pressure → -0.4
  - "Wholesale broiler price falls 7%" → margin compression on integrated producers → -0.5

LOGISTICS (Phase 7.K):
  - "Baltic Dry Index drops 18% on China import weakness" → freight margin compression → -0.3
  - "Brent crude up 9% on Mideast tension" → diesel pass-through cost up → -0.5
  - "BTC pipeline volumes record-high" → AZ logistics activity tailwind → +0.5
  - "Caspian port congestion delays cargo 5 days" → revenue + cost-side hit → -0.4
  - "AZ Railways raises tariff 6%" → cost pass-through opportunity for trucking → +0.2

EDUCATION (Phase 7.K):
  - "ADA University tuition freeze announced" → margin compression for tier-1 private → -0.4
  - "AZ govt subsidy for STEM graduates announced" → enrollment tailwind → +0.4
  - "Population age 0-14 falls 1.2% YoY in AZ census" → long-term enrollment headwind → -0.3
  - "Khazar accreditation review extended" → reputational tail risk → -0.5

ENTERTAINMENT (Phase 7.K):
  - "Baku F1 weekend confirmed, ticketing opens" → hospitality + venue demand → +0.7
  - "Crystal Hall concert series announced" → utilization tailwind → +0.5
  - "Heavy rain forecast for AZ outdoor festival" → outdoor-venue demand drag → -0.4

INDUSTRIAL (Phase 7.K):
  - "SOCAR Petkim earnings beat by 18%" → benchmark for AZ petrochem peers → +0.3
  - "Copper futures down 6% on China cooling" → industrial demand softness → -0.4
  - "Baku Steel announces 200kt expansion" → domestic supply up, price pressure → -0.3
  - "Natural gas prices spike on cold snap" → industrial input cost up → -0.5

  - Pure macro stat with no actionable angle → 0.0

Context clues to attend to: explicit mention of "sugar", "cane", "beet", "yield", "harvest", "fertilizer", "irrigation", "drought", "frost", "ICE", "Pink Sheet", "extraction rate", "Salyan/Imishli/Sabirabad" → bump up specificity of score (more positive OR more negative). Same for sector-specific keywords from the heuristics above (e.g. "Brent", "Baltic Dry", "F1 Baku", "Pharmacheck", "stat.gov.az", "CPI", "tariff").

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
