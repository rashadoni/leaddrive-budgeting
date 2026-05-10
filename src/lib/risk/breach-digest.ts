/**
 * Phase 7.G Turn CIII (Phase 7.E #3 v2 E.2e LLM-half) — predictive breach digest.
 *
 * Pure module: takes a list of `ForecastedBreach` rows + ranks them + builds
 * the LLM prompt for a single-paragraph digest aimed at the CFO. The actual
 * LLM call wires through `getLLMService()` (mirror of variance-explainer
 * pattern) in a follow-up turn — this turn ships the deterministic primitives
 * so the wire+audit emit is a thin glue layer.
 *
 * **Ranking semantics:** breaches are ranked highest-priority first by:
 *   1. Predicted severity (red worst, then amber, then unknown).
 *   2. Confidence band (high > medium > low) — drop low when topN allows.
 *   3. Horizon proximity (step 1 first; step 6 last).
 *   4. Tiebreak by `companyId` for determinism.
 *
 * **Why pure ranking + prompt:** the LLM call layer can stay thin (just
 * fetch + invoke service + persist). Deterministic ranking + prompt
 * structure are testable without an SDK call.
 *
 * **Output language:** the digest emits in the org's `intelLanguage`
 * (LXXXXIII D.5c) — same EN/RU/AZ pattern as the intel crawler.
 */

import type { ForecastedBreach, BreachConfidenceBand } from "./breach-forecaster"
import type { IndicatorStatus } from "./formula-engine"

export type DigestLanguage = "en" | "ru" | "az"

const LANGUAGE_LABEL: Record<DigestLanguage, string> = {
  en: "English",
  ru: "Russian (Русский)",
  az: "Azerbaijani (Azərbaycan dili)",
}

/** Severity rank — higher = worse (red worst). */
const SEVERITY_RANK: Record<IndicatorStatus, number> = {
  red: 3,
  amber: 2,
  unknown: 1,
  green: 0,
}

/** Confidence rank — higher = more confident. */
const CONFIDENCE_RANK: Record<BreachConfidenceBand, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

/** Default cap on rows the digest model sees. Above ~12 the prompt
 *  bloats without adding signal — the rest fall off. */
export const DEFAULT_DIGEST_TOP_N = 12

export interface SelectTopBreachesOptions {
  /** Cap output length. Default: 12. */
  topN?: number
  /** Drop forecasts below this band (e.g. "medium" excludes low). Default: "low" (keep all). */
  minConfidenceBand?: BreachConfidenceBand
}

/**
 * Rank + cap breaches for the digest prompt. Stable ordering: severity desc
 * → confidence desc → horizon asc → companyId asc.
 */
export function selectTopBreaches(
  breaches: ReadonlyArray<ForecastedBreach>,
  opts: SelectTopBreachesOptions = {},
): ForecastedBreach[] {
  const topN = opts.topN ?? DEFAULT_DIGEST_TOP_N
  const minBand = opts.minConfidenceBand ?? "low"
  const minRank = CONFIDENCE_RANK[minBand]

  const filtered = breaches.filter((b) => CONFIDENCE_RANK[b.confidenceBand] >= minRank)

  const sorted = [...filtered].sort((a, b) => {
    const sevA = SEVERITY_RANK[a.predictedStatus] ?? 0
    const sevB = SEVERITY_RANK[b.predictedStatus] ?? 0
    if (sevA !== sevB) return sevB - sevA
    const confA = CONFIDENCE_RANK[a.confidenceBand]
    const confB = CONFIDENCE_RANK[b.confidenceBand]
    if (confA !== confB) return confB - confA
    if (a.horizonStep !== b.horizonStep) return a.horizonStep - b.horizonStep
    return a.companyId.localeCompare(b.companyId)
  })

  return sorted.slice(0, topN)
}

export interface BreachDigestPromptInput {
  organizationId: string
  /** Pre-ranked + capped via `selectTopBreaches`. */
  breaches: ReadonlyArray<ForecastedBreach>
  /** Output language. Default "en". */
  language?: DigestLanguage
  /** Period being summarized (e.g. "2026-Q1"). */
  period: string
}

/** System-prompt: locked in once + bumped via DIGEST_PROMPT_VERSION. */
export const DIGEST_PROMPT_VERSION = "v1"

export const DIGEST_SYSTEM_PROMPT = `You are a senior financial analyst producing a daily predictive-breach digest for the CFO of an Azerbaijani diversified holding (~60 operational companies across 14 sectors).

Your job: take the ranked list of upcoming indicator breaches (currentStatus → predictedStatus over the forecast horizon) + produce a single tight paragraph the CFO can read in 30 seconds.

Constraints:
  - Output is a SINGLE PARAGRAPH (≤120 words). No bullet lists, no headers, no markdown.
  - Lead with the most severe breach (highest severity × highest confidence). Cite the company code + indicator code + horizon step.
  - When multiple breaches share a sector or driver pattern, group them ("Three hospitality units showing margin compression at horizon +2"). Honest grouping only — don't invent ties.
  - Be factual. NO recommendations, NO action verbs (those live in VarianceExplainer). The digest's job is SCAN-IN-30s; recommendations come on demand.
  - When the list is empty or only low-confidence: state that plainly ("No high- or medium-confidence breaches forecast for this period; trend lines are stable").
  - Output strict JSON in this shape: {"narrative": "..."}`

/** Pure prompt builder — testable without LLM. */
export function buildDigestPrompt(input: BreachDigestPromptInput): string {
  const lang = input.language ?? "en"
  if (input.breaches.length === 0) {
    return `Organization: ${input.organizationId}
Period: ${input.period}

Breach list: (empty — no forecasts surfaced for this period at the chosen confidence floor).

Output language: ${LANGUAGE_LABEL[lang]}.

Return STRICT JSON: {"narrative": "..."}`
  }

  const lines = input.breaches.map((b, idx) => {
    const ci =
      b.predictedLower !== undefined && b.predictedUpper !== undefined
        ? ` [${b.predictedLower.toFixed(2)}, ${b.predictedUpper.toFixed(2)}]`
        : ""
    return `  ${idx + 1}. ${b.companyId} / ${b.indicatorCode} @ ${b.period}+${b.horizonStep}: ${b.currentStatus} → ${b.predictedStatus} (predicted ${b.predictedValue.toFixed(2)}${ci}, confidence ${b.confidenceBand} ${(b.forecastConfidence * 100).toFixed(0)}%)`
  })

  return `Organization: ${input.organizationId}
Period: ${input.period}
Breach count: ${input.breaches.length}

Ranked breaches (most severe + most confident first):
${lines.join("\n")}

Output language: ${LANGUAGE_LABEL[lang]}.

Return STRICT JSON: {"narrative": "single paragraph ≤120 words"}`
}

export interface BreachDigestOutput {
  narrative: string
  /** Pass-through count of breaches the digest summarized. */
  breachCount: number
  /** Snapshot of the 1-3 highest-severity breaches the digest leads with —
   *  surfaces in the audit event metadata for forensics. */
  topCompanies: string[]
  /** Tokens consumed (LLM round-trip). */
  usage?: { inputTokens: number; outputTokens: number }
  /** Resolved model id (e.g. "claude-sonnet-4-5-20250929"). */
  modelName: string
  promptVersion: string
}

/** Validate + shape the LLM response. Throws on shape violation so caller
 *  can audit the failure rather than persist garbage. */
export function validateDigestResponse(
  parsed: unknown,
  topCompanies: string[],
  breachCount: number,
  modelName: string,
  usage?: { inputTokens: number; outputTokens: number },
): BreachDigestOutput {
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("breach-digest: response is not a JSON object")
  }
  const obj = parsed as Record<string, unknown>
  if (typeof obj.narrative !== "string" || obj.narrative.trim() === "") {
    throw new Error("breach-digest: missing or empty 'narrative'")
  }
  return {
    narrative: obj.narrative.trim(),
    breachCount,
    topCompanies,
    usage,
    modelName,
    promptVersion: DIGEST_PROMPT_VERSION,
  }
}

/** Extract `topCompanies` (first 3 distinct companyIds) for audit metadata. */
export function topCompaniesFrom(breaches: ReadonlyArray<ForecastedBreach>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const b of breaches) {
    if (seen.has(b.companyId)) continue
    seen.add(b.companyId)
    out.push(b.companyId)
    if (out.length === 3) break
  }
  return out
}
