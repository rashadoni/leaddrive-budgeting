/**
 * Phase 7.L — Pure LLM impact-forecast module.
 *
 * Stateless wrapper around Anthropic SDK that takes a single external-
 * feed crossing event + one affected company's financials and produces
 * a 3-scenario (best / likely / worst) impact forecast with anchored
 * arithmetic.
 *
 * Mirrors `src/lib/intel/morning-brief.ts` shape:
 *   - SDK injection seam (`opts.client`)
 *   - JSON-only output (defensive `extractJsonFromText`)
 *   - validateAndShape() guard against malformed LLM responses
 *
 * No DB, no cache — pure transformation. Caching layer lives in
 * `impact-forecast-cache.ts` (Phase 5).
 */
import type Anthropic from "@anthropic-ai/sdk"
import { getAnthropicClient, AI_MODEL } from "@/lib/ai/client"
import { extractJsonFromText } from "@/lib/onboarding/ai-mapper/json-extract"
import {
  buildImpactForecastSystemPrompt,
  type ImpactForecastLanguage,
} from "@/lib/llm/prompts/impact-forecast-system"

export type { ImpactForecastLanguage }

export interface ImpactForecastTrigger {
  sourceCode: string
  metric: string
  value: number
  baseline: number
  deltaPct: number
  observedAt: string // ISO
  rationale?: string
}

export interface ImpactForecastCompany {
  code: string
  name: string
  industry: string | null
}

export interface ImpactForecastFinancials {
  revenueAZN: number | null
  cogsAZN: number | null
  opexAZN: number | null
  ebitdaAZN: number | null
  /** Reporting period (e.g. "2026" or "2026-Q1"). */
  period: string
}

export interface ImpactForecastCostStructure {
  keyInputs: Array<{ name: string; shareOfCogs: number }>
}

export type ImpactSensitivity = "high" | "medium" | "low"

export interface ImpactForecastInput {
  trigger: ImpactForecastTrigger
  company: ImpactForecastCompany
  companyFinancials: ImpactForecastFinancials
  knownCostStructure?: ImpactForecastCostStructure | null
  sectorSensitivity: ImpactSensitivity
  language: ImpactForecastLanguage
}

export interface ImpactScenario {
  projectedIndicatorValue: number
  plDeltaAZN: number
  deltaPct: number
  drivers: string[]
  timeHorizon: string
}

export interface ImpactForecastOutput {
  scenarios: {
    best: ImpactScenario
    likely: ImpactScenario
    worst: ImpactScenario
  }
  recommendations: string[] // exactly 3
  confidence: "low" | "medium" | "high"
  usage: { inputTokens: number; outputTokens: number }
}

export interface RunImpactForecastOptions {
  client?: Anthropic
  model?: string
}

const MAX_TOKENS = 3072

export async function runImpactForecast(
  input: ImpactForecastInput,
  opts: RunImpactForecastOptions = {},
): Promise<ImpactForecastOutput> {
  const client = opts.client ?? getAnthropicClient()
  const model = opts.model ?? AI_MODEL
  const system = buildImpactForecastSystemPrompt(input.language)

  const payload = {
    trigger: input.trigger,
    company: input.company,
    companyFinancials: input.companyFinancials,
    knownCostStructure: input.knownCostStructure ?? null,
    sectorSensitivity: input.sectorSensitivity,
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
      `runImpactForecast: LLM did not return parseable JSON (${
        (err as Error).message
      })`,
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

function isScenarioShape(o: unknown): o is ImpactScenario {
  if (typeof o !== "object" || o === null) return false
  const r = o as Record<string, unknown>
  return (
    typeof r.projectedIndicatorValue === "number" &&
    typeof r.plDeltaAZN === "number" &&
    typeof r.deltaPct === "number" &&
    Array.isArray(r.drivers) &&
    r.drivers.every((d) => typeof d === "string") &&
    typeof r.timeHorizon === "string"
  )
}

function validateAndShape(parsed: unknown): {
  scenarios: ImpactForecastOutput["scenarios"]
  recommendations: string[]
  confidence: ImpactForecastOutput["confidence"]
} {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("runImpactForecast: response is not a JSON object")
  }
  const obj = parsed as Record<string, unknown>
  const scenarios = obj.scenarios as Record<string, unknown> | undefined
  if (!scenarios || typeof scenarios !== "object") {
    throw new Error("runImpactForecast: missing scenarios block")
  }
  if (
    !isScenarioShape(scenarios.best) ||
    !isScenarioShape(scenarios.likely) ||
    !isScenarioShape(scenarios.worst)
  ) {
    throw new Error(
      "runImpactForecast: scenarios.{best,likely,worst} must each have projectedIndicatorValue+plDeltaAZN+deltaPct+drivers[]+timeHorizon",
    )
  }
  const recommendations = Array.isArray(obj.recommendations)
    ? obj.recommendations.filter(
        (r): r is string => typeof r === "string" && r.trim().length > 0,
      )
    : []
  if (recommendations.length !== 3) {
    throw new Error(
      `runImpactForecast: recommendations must be exactly 3 strings, got ${recommendations.length}`,
    )
  }
  const confidence = obj.confidence
  if (
    confidence !== "low" &&
    confidence !== "medium" &&
    confidence !== "high"
  ) {
    throw new Error(
      `runImpactForecast: confidence must be 'low'|'medium'|'high', got ${String(
        confidence,
      )}`,
    )
  }
  return {
    scenarios: {
      best: scenarios.best as ImpactScenario,
      likely: scenarios.likely as ImpactScenario,
      worst: scenarios.worst as ImpactScenario,
    },
    recommendations,
    confidence,
  }
}
