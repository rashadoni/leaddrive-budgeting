/**
 * Phase 7.E — AI Variance Explainer.
 *
 * Given a single `IndicatorValue` row that landed amber/red/unknown, ask
 * an LLM to produce:
 *   1. A 1-2 sentence narrative explaining what's driving the value
 *      (uses `inputs.resolved` + parent-aggregate breakdown — the same
 *      drill-down a finance reviewer would inspect).
 *   2. Three actionable recommendations a CFO could plausibly act on
 *      this quarter (not "investigate further" — concrete moves like
 *      "renegotiate cocoa supplier contracts" or "shift Q3 marketing
 *      spend from print to digital channels").
 *
 * The explainer is **advisory only**. It runs against the same context
 * snapshot the indicator was computed from — no re-fetch, no external
 * data this turn (Phase 7.E AI Web Crawler is a separate turn). Output
 * language is user-selectable per `feedback_customer_facing_language.md`
 * — the UI stays English, only the LLM narrative switches.
 *
 * Pure module: no DB, no Prisma. Caller (API route) fetches the
 * IndicatorValue + Definition + Company + a budget snapshot, hands the
 * shaped context here.
 */

import { getAnthropicClient, AI_MODEL } from "@/lib/ai/client"
import { extractJsonFromText } from "@/lib/onboarding/ai-mapper/json-extract"
import { formatIntelContextForPrompt, type IntelContextSnapshot } from "./intel-context"

export type ExplainerLanguage = "en" | "ru" | "az"

/**
 * Indicator status worth explaining. We DO let unknown through —
 * "tell me why this cell has no value" is a valid analyst question
 * (often points to missing data, not a real failure).
 */
export type ExplainableStatus = "amber" | "red" | "unknown"

export interface VarianceExplainerInput {
  /** Indicator code + display metadata (drives narrative phrasing). */
  indicator: {
    code: string
    nameEn: string
    unit: string
    direction: "higher_better" | "lower_better" | "band"
    /** EN-language hint template from the seed; gives the LLM a stable
     *  benchmark phrasing to riff on. May be null. */
    hintTemplateEn: string | null
  }
  /** Where the indicator landed. */
  result: {
    value: number
    status: ExplainableStatus
    period: string
  }
  /** Drill-down snapshot — `IndicatorValue.inputs.resolved`, the formula
   *  context the engine actually used. May be empty for `unknown` rows. */
  resolved: Record<string, number>
  /** Aggregate roll-ups by namespace (booking_count, budget_line totals,
   *  etc.). Pulled directly from `IndicatorValue.inputs.aggregates` —
   *  shape varies per indicator type. */
  aggregates: Record<string, unknown>
  /** Error from the recompute pipeline if status='unknown' was forced
   *  (e.g. plausibility clamp, missing var). Helps the LLM distinguish
   *  data-quality from genuine signal. */
  error?: { code: string; reason: string }
  /** Company context — sector + size shape the recommendations. */
  company: {
    name: string
    industry: string | null
    /** Optional: free-form tags (e.g. ["cost_centre", "rollup_sourced"]).
     *  LLM uses these to avoid suggesting "increase revenue" for a pure
     *  admin cost centre that has none. */
    tags?: string[]
  }
  /** Output language for the narrative + recommendations. UI stays EN. */
  language: ExplainerLanguage
  /** Phase 7.E #2 v2 E.1b (Turn LXXXXVI) — optional intel context: latest
   *  FX / CPI / commodity observations. When present, the LLM can cite
   *  specific external drivers (e.g. "AZN/USD fell 3% MoM"). When omitted
   *  or empty, the explainer falls back to inputs-only narrative (v1
   *  behaviour). */
  intelContext?: IntelContextSnapshot
}

export interface VarianceExplainerOutput {
  /** 1-2 sentence narrative — the "what's actually driving this" summary. */
  narrative: string
  /** Up to 3 concrete actions, each ≤ 25 words. Never "investigate further". */
  recommendations: string[]
  /** LLM self-rated confidence in the explanation (0..1). Below 0.5 means
   *  "the inputs alone don't tell me enough — bring in external data". */
  confidence: number
  /** Free-form list of input fields the LLM judged most load-bearing. UI
   *  highlights them in the drill-down so user knows which numbers to
   *  scrutinise. */
  topDrivers: string[]
  /** Tokens consumed — for budget tracking. Optional. */
  usage?: { inputTokens: number; outputTokens: number }
  /** Model id from Anthropic SDK response (e.g. "claude-sonnet-4-5-20250929").
   *  Captured for compliance / audit attestation: future model swap must
   *  not silently erase the trail of what answered the CFO's question. */
  modelName: string
  /** Hand-bumped version of the SYSTEM_PROMPT + buildExplainerPrompt
   *  template. Bump when prompt semantics change so audit shows which
   *  variant produced a given narrative. v1 = initial Phase 7.E ship. */
  promptVersion: string
}

const LANGUAGE_LABEL: Record<ExplainerLanguage, string> = {
  en: "English",
  ru: "Russian (Русский)",
  az: "Azerbaijani (Azərbaycan dili)",
}

/** Bump on any change to SYSTEM_PROMPT or buildExplainerPrompt structure.
 *  v1 = initial Phase 7.E ship (Turn 38 sub-turn 9 backfill).
 *  v2 = Phase 7.G Turn LXXXXVI (E.1b) — intel context block added to prompt.
 *       Bumping invalidates v1-cached explanations; CFO sees richer narratives
 *       on next request. */
export const EXPLAINER_PROMPT_VERSION = "v2"

const SYSTEM_PROMPT = `You are a senior financial analyst producing variance explanations for a CFO at an Azerbaijani diversified holding (~60 operational companies across 14 sectors: hospitality, agro, food processing, pharma, real estate, services, industrial, etc.).

Your job: take ONE indicator's amber/red/unknown reading + its computed inputs and produce:
  1. A narrative — 1-2 sentences, plain language, NO finance jargon a non-specialist couldn't follow. Identify the 1-3 numerical drivers (always cite the actual values from inputs).
  2. Three actionable recommendations — concrete moves a CFO can make THIS QUARTER. Forbidden: "investigate further", "review the data", "consider options". Required: specific verbs (renegotiate, shift, hedge, hire, pause, freeze, audit, exit, replace) + specific targets.
  3. Confidence — honest (0.0-1.0). Below 0.5 means "I'd want external market data before recommending action".
  4. topDrivers — names of input fields (1-3) most responsible for the reading.

Constraints:
  - Output STRICT JSON matching the schema. No markdown, no prose around it.
  - Recommendations: ≤ 25 words each. CFO-readable.
  - For status=unknown with error.code='out_of_range': lead recommendations with "verify data classification — this is likely a misclassified line".
  - For status=unknown with no error: data is missing — lead with "populate <missing_input>".
  - For amber/red on rollup-sourced or admin cost-centre companies (tags include 'admin' or 'cost_centre' or 'rollup_sourced'): factor that into recommendations — don't suggest revenue growth for an admin entity that has none.
  - Recommendations target the SECTOR. Hospitality → ADR/occupancy levers; agro → yield/feed levers; pharma → margin/inventory levers. NEVER suggest cross-sector moves like "diversify into renewable energy" unless explicitly relevant to the indicator.
  - When an "Intel context" section is present (FX rates / CPI / commodity prices), USE it: cite specific external drivers when the indicator's variance correlates (e.g. "AZN/USD fell 4% MoM, inflating USD-denominated COGS"). Do NOT invent external context that isn't shown.`

function summarizeAggregates(aggregates: Record<string, unknown>): string {
  if (Object.keys(aggregates).length === 0) return "(none)"
  const lines: string[] = []
  for (const [namespace, data] of Object.entries(aggregates)) {
    if (data === null || typeof data !== "object") {
      lines.push(`  ${namespace}: ${JSON.stringify(data)}`)
      continue
    }
    // Trim arrays/dicts for prompt economy — show first 8 keys per namespace.
    const entries = Object.entries(data as Record<string, unknown>).slice(0, 8)
    const pairs = entries
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ")
    lines.push(`  ${namespace}: { ${pairs} }`)
  }
  return lines.join("\n")
}

/**
 * Build the user-message body for the LLM. Pure — testable without an
 * Anthropic call.
 */
export function buildExplainerPrompt(input: VarianceExplainerInput): string {
  const tagsLine =
    input.company.tags && input.company.tags.length > 0
      ? `Tags: ${input.company.tags.join(", ")}`
      : "Tags: (none)"
  const errorLine = input.error
    ? `Pipeline error: { code: "${input.error.code}", reason: "${input.error.reason}" }`
    : "Pipeline error: (none)"

  const resolvedLines = Object.entries(input.resolved)
    .map(([k, v]) => `  ${k} = ${v}`)
    .join("\n")

  // Phase 7.G Turn LXXXXVI (E.1b) — optional intel block
  const intelBlock = input.intelContext
    ? formatIntelContextForPrompt(input.intelContext)
    : null
  const intelSection = intelBlock
    ? `\n\nIntel context (latest macro / FX / commodity observations):\n${intelBlock}\n`
    : ""

  return `Indicator: ${input.indicator.code} (${input.indicator.nameEn})
Direction: ${input.indicator.direction}
Unit: ${input.indicator.unit}
Hint template: ${input.indicator.hintTemplateEn ?? "(none)"}

Company: ${input.company.name}
Industry: ${input.company.industry ?? "(none)"}
${tagsLine}

Period: ${input.result.period}
Status: ${input.result.status}
Value: ${input.result.value} ${input.indicator.unit}
${errorLine}

Resolved variables (the formula context):
${resolvedLines || "  (none — likely missing-data status=unknown)"}

Aggregates (drill-down breakdowns):
${summarizeAggregates(input.aggregates)}${intelSection}

Output language: ${LANGUAGE_LABEL[input.language]}.

Return STRICT JSON in this exact shape (no markdown):
{
  "narrative": "1-2 sentences citing the actual driving numbers from inputs${input.intelContext && !input.intelContext.empty ? " (and intel context if relevant)" : ""}",
  "recommendations": ["≤25 words, action verb + target", "...", "..."],
  "confidence": 0.0,
  "topDrivers": ["resolved_var_name", "..."]
}`
}

/**
 * Validate + shape the LLM's parsed JSON. Throws on shape violation so
 * the caller can return 502 (LLM produced garbage) rather than 200 with
 * unsafe content.
 */
/** Validation output excludes the LLM-response-side fields (modelName,
 *  promptVersion, usage) which `runExplainer` fills in after the SDK
 *  call returns. The split keeps validateAndShape pure (only depends on
 *  the parsed JSON body, not the SDK response envelope). */
type ValidatedExplainerBody = Omit<
  VarianceExplainerOutput,
  "modelName" | "promptVersion" | "usage"
>
function validateAndShape(parsed: unknown): ValidatedExplainerBody {
  if (parsed == null || typeof parsed !== "object") {
    throw new Error("Variance explainer: response is not a JSON object")
  }
  const obj = parsed as Record<string, unknown>

  if (typeof obj.narrative !== "string" || obj.narrative.trim() === "") {
    throw new Error("Variance explainer: missing or empty 'narrative'")
  }
  if (
    !Array.isArray(obj.recommendations) ||
    obj.recommendations.length === 0 ||
    !obj.recommendations.every((r) => typeof r === "string" && r.trim() !== "")
  ) {
    throw new Error(
      "Variance explainer: 'recommendations' must be a non-empty array of strings",
    )
  }
  // Cap at 3 — model may over-deliver. Better to truncate than reject.
  const recommendations = (obj.recommendations as string[]).slice(0, 3)

  const confidenceRaw = obj.confidence
  if (
    typeof confidenceRaw !== "number" ||
    !Number.isFinite(confidenceRaw) ||
    confidenceRaw < 0 ||
    confidenceRaw > 1
  ) {
    throw new Error(
      `Variance explainer: 'confidence' must be a finite number in [0,1], got ${JSON.stringify(confidenceRaw)}`,
    )
  }

  if (
    !Array.isArray(obj.topDrivers) ||
    !obj.topDrivers.every((d) => typeof d === "string")
  ) {
    throw new Error(
      "Variance explainer: 'topDrivers' must be an array of strings",
    )
  }
  // Cap at 5 — UI highlights at most 5 drill-down rows.
  const topDrivers = (obj.topDrivers as string[]).slice(0, 5)

  return {
    narrative: obj.narrative.trim(),
    recommendations,
    confidence: confidenceRaw,
    topDrivers,
  }
}

export interface RunExplainerOptions {
  model?: string
  maxTokens?: number
  /** Test seam — inject a fake Anthropic client for unit tests. */
  client?: ReturnType<typeof getAnthropicClient>
}

/**
 * Call the LLM and return a typed `VarianceExplainerOutput`. Throws on
 * API failure / max_tokens truncation / shape violation. The API route
 * wraps these into 502 / 503 responses.
 */
export async function runExplainer(
  input: VarianceExplainerInput,
  opts: RunExplainerOptions = {},
): Promise<VarianceExplainerOutput> {
  const client = opts.client ?? getAnthropicClient()
  const model = opts.model ?? AI_MODEL
  // 4K is enough for narrative + 3 recommendations + JSON overhead. RU/AZ
  // need ~2x English token budget per `feedback_llm_max_tokens.md`, so
  // 4096 covers worst case (RU prose at full length).
  const maxTokens = opts.maxTokens ?? 4096

  const userMessage = buildExplainerPrompt(input)

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  })

  if (response.stop_reason === "max_tokens") {
    throw new Error(
      `Variance explainer truncated at max_tokens=${maxTokens}. Re-run with higher maxTokens — RU/AZ output needs more headroom than EN.`,
    )
  }

  const textBlocks = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
  if (textBlocks.length === 0) {
    throw new Error(
      `Variance explainer: response had no text content (got: ${JSON.stringify(response.content.map((b) => b.type))})`,
    )
  }
  const raw = textBlocks.join("\n").trim()
  const jsonText = extractJsonFromText(raw)
  if (!jsonText) {
    throw new Error(
      `Variance explainer: response did not contain valid JSON. Raw: ${raw.slice(0, 200)}…`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (err) {
    throw new Error(
      `Variance explainer: response did not contain valid JSON. Parse error: ${err instanceof Error ? err.message : String(err)}. Raw: ${raw.slice(0, 200)}…`,
    )
  }

  const shapedBody = validateAndShape(parsed)
  // Compose the final output with response-side metadata. Anthropic SDK
  // echoes the resolved model id (preserves alias resolution, e.g.
  // "claude-sonnet-4-5-20250929" not just "sonnet").
  const out: VarianceExplainerOutput = {
    ...shapedBody,
    modelName: response.model ?? model,
    promptVersion: EXPLAINER_PROMPT_VERSION,
  }
  if (response.usage) {
    out.usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }
  }
  return out
}
