/**
 * Phase 1 "Crisis Brief" — grounded AI narrative. Mirrors variance-explainer.ts.
 * The prompt receives ONLY computed deltas + score swing; the system prompt
 * forbids inventing numbers. Advisory-CFO tone, ⚠ lead. EN/RU/AZ. When a
 * modeling assumption was made (FX assumedImportShare), it is stated honestly.
 */
import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client'
import { extractJsonFromText } from '@/lib/onboarding/ai-mapper/json-extract'

export type BriefLanguage = 'en' | 'ru' | 'az'

export interface CrisisBriefWorstHit {
  companyCode: string
  companyName: string
  baselineScore: number | null
  scenarioScore: number | null
  topDeltas: Array<{ code: string; baselineValue: number; scenarioValue: number }>
}
export interface CrisisBriefInput {
  scenarioCode: string
  scenarioNameEn: string
  language: BriefLanguage
  holdingBaselineScore: number | null
  holdingScenarioScore: number | null
  worstHit: CrisisBriefWorstHit[]
  changed: number
  worsened: number
  improved: number
  /** Honest modeling caveat surfaced verbatim (e.g. FX import-share assumption). */
  assumptionNote: string | null
}
export interface CrisisBriefOutput {
  narrative: string
  mitigations: string[]
  confidence: number
  modelName: string
  promptVersion: string
  usage?: { inputTokens: number; outputTokens: number }
}

export const CRISIS_BRIEF_PROMPT_VERSION = 'v1'
const LANGUAGE_LABEL: Record<BriefLanguage, string> = {
  en: 'English',
  ru: 'Russian (Русский)',
  az: 'Azerbaijani (Azərbaycan dili)',
}

const SYSTEM_PROMPT = `You are the CFO advisor for an Azerbaijani diversified holding. You are briefing the board on a SIMULATED crisis scenario. You receive ONLY pre-computed numbers (a holding composite-score swing + worst-hit companies + indicator deltas).

Produce:
  1. narrative — board-level, 3-5 sentences. LEAD with a ⚠ crisis framing and the holding composite swing (cite exact before→after). Then name the 1-3 worst-hit companies with their ACTUAL score drops + the key indicator that moved (cite real before→after). Advisory, serious, not pure alarmism. If an assumption note is provided, state it plainly.
  2. mitigations — 2-3 concrete moves the CFO can make THIS QUARTER. Specific verbs (hedge, renegotiate, pre-buy, raise prices, freeze capex, diversify supply). No "monitor"/"investigate".
  3. confidence — honest 0.0-1.0.

ABSOLUTE CONSTRAINTS:
  - Use ONLY the numbers provided. NEVER invent a figure, percentage, or company not in the input.
  - Output STRICT JSON only (no markdown): { "narrative": string, "mitigations": string[], "confidence": number }.
  - Write in the requested output language.`

const fmtScore = (s: number | null): string => (s == null ? 'n/a' : String(Math.round(s)))

export function buildCrisisBriefPrompt(input: CrisisBriefInput): string {
  const worstLines = input.worstHit
    .map((w) => {
      const deltas = w.topDeltas.map((d) => `${d.code}: ${d.baselineValue} → ${d.scenarioValue}`).join('; ')
      return `  ${w.companyCode} (${w.companyName}): composite ${fmtScore(w.baselineScore)} → ${fmtScore(w.scenarioScore)} | ${deltas || '(no indicator deltas)'}`
    })
    .join('\n')
  const assumption = input.assumptionNote
    ? `\nModeling assumption (state this in the narrative): ${input.assumptionNote}\n`
    : ''
  return `Scenario: ${input.scenarioCode} (${input.scenarioNameEn})

Holding composite score: ${fmtScore(input.holdingBaselineScore)} → ${fmtScore(input.holdingScenarioScore)}
Indicators changed status: ${input.changed} (worsened ${input.worsened}, improved ${input.improved})
${assumption}
Worst-hit companies (use these EXACT numbers, invent nothing):
${worstLines || '  (none)'}

Output language: ${LANGUAGE_LABEL[input.language]}.

Return STRICT JSON (no markdown):
{ "narrative": "⚠ ... 3-5 sentences citing only the numbers above", "mitigations": ["...","...","..."], "confidence": 0.0 }`
}

type ValidatedBody = Omit<CrisisBriefOutput, 'modelName' | 'promptVersion' | 'usage'>
function validateAndShape(parsed: unknown): ValidatedBody {
  if (parsed == null || typeof parsed !== 'object') throw new Error('Crisis brief: response is not a JSON object')
  const obj = parsed as Record<string, unknown>
  if (typeof obj.narrative !== 'string' || obj.narrative.trim() === '') throw new Error("Crisis brief: missing 'narrative'")
  if (
    !Array.isArray(obj.mitigations) ||
    obj.mitigations.length === 0 ||
    !obj.mitigations.every((m) => typeof m === 'string' && m.trim() !== '')
  ) {
    throw new Error("Crisis brief: 'mitigations' must be a non-empty string array")
  }
  const mitigations = (obj.mitigations as string[]).slice(0, 3)
  const c = obj.confidence
  if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1) {
    throw new Error(`Crisis brief: 'confidence' must be in [0,1], got ${JSON.stringify(c)}`)
  }
  return { narrative: obj.narrative.trim(), mitigations, confidence: c }
}

export interface RunCrisisBriefOptions {
  model?: string
  maxTokens?: number
  client?: ReturnType<typeof getAnthropicClient>
}

export async function runCrisisBrief(input: CrisisBriefInput, opts: RunCrisisBriefOptions = {}): Promise<CrisisBriefOutput> {
  const client = opts.client ?? getAnthropicClient()
  const model = opts.model ?? AI_MODEL
  // RU/AZ board prose headroom (feedback_llm_max_tokens).
  const maxTokens = opts.maxTokens ?? 8192

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildCrisisBriefPrompt(input) }],
  })

  if (response.stop_reason === 'max_tokens') {
    throw new Error(`Crisis brief truncated at max_tokens=${maxTokens}. Re-run with higher maxTokens.`)
  }
  const textBlocks = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
  if (textBlocks.length === 0) throw new Error('Crisis brief: response had no text content')
  const raw = textBlocks.join('\n').trim()
  const jsonText = extractJsonFromText(raw)
  if (!jsonText) throw new Error(`Crisis brief: no JSON in response. Raw: ${raw.slice(0, 200)}…`)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (err) {
    throw new Error(`Crisis brief: JSON parse error: ${err instanceof Error ? err.message : String(err)}`)
  }
  const body = validateAndShape(parsed)
  const out: CrisisBriefOutput = { ...body, modelName: response.model ?? model, promptVersion: CRISIS_BRIEF_PROMPT_VERSION }
  if (response.usage) out.usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
  return out
}
