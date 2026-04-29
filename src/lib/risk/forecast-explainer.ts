/**
 * Phase C2 v2 — AI Forecast Explainer.
 *
 * Mirror of `variance-explainer.ts`, tailored for forecast narration.
 * Given a `forecastNextPeriod()` output (sub-13 v1) plus the trailing
 * sparkline + indicator/company context, ask an LLM to produce:
 *
 *   1. A narrative — 1-2 sentences explaining WHY the trajectory points
 *      where it does (cite specific numbers from the series).
 *   2. Up to 3 driver hypotheses — likely causes of the observed trend
 *      (sector-aware: "Q4 seasonal uplift" for hospitality vs "Brent
 *      crude tailwind" for petrochem).
 *   3. Up to 3 risk factors — concrete events that could invalidate the
 *      forecast (e.g. "AZN devaluation 20% would compress margins").
 *   4. LLM self-rated confidence (0..1) — separate from the regression
 *      R². Below 0.5 means "the trend is real but external factors
 *      could swamp it; bring market data".
 *
 * Pure module: no DB, no Prisma. Caller (API route) shapes the input
 * from `IndicatorValue.sparkline` + `forecastNextPeriod()` + IV/company
 * snapshot.
 *
 * Forecast vs Variance distinction:
 *   - Variance Explainer: a current cell landed amber/red — "what
 *     happened?"
 *   - Forecast Explainer: a current cell may be green, but the
 *     trajectory points down — "what's coming?" Recommendations are
 *     PROACTIVE (hedge, monitor, prepare) vs REACTIVE (renegotiate,
 *     audit, investigate). LLM is told this explicitly in the prompt.
 */

import { getAnthropicClient, AI_MODEL } from "@/lib/ai/client";
import { extractJsonFromText } from "@/lib/onboarding/ai-mapper/json-extract";

export type ForecastExplainerLanguage = "en" | "ru" | "az";

/**
 * Input shape — extends what `forecastNextPeriod()` returns with the
 * surrounding context the LLM needs to produce a sector-aware narrative.
 */
export interface ForecastExplainerInput {
  indicator: {
    code: string;
    nameEn: string;
    unit: string;
    direction: "higher_better" | "lower_better" | "band";
    /** EN-language hint template from the seed (optional — gives the LLM
     *  a stable benchmark phrasing). */
    hintTemplateEn: string | null;
  };
  /** The current cell's status + value at the anchor period. Helps the
   *  LLM frame "from here, the trajectory says…" rather than abstract
   *  forecasting. */
  current: {
    value: number;
    status: "green" | "amber" | "red" | "unknown";
    period: string;
  };
  /** The forecast result — output of `forecastNextPeriod()`. */
  forecast: {
    predicted: number;
    confidence: "high" | "medium" | "low";
    slope: number;
    intercept: number;
    r2: number;
    contributingCount: number;
    method: "linear-regression-v1";
  };
  /** Trailing series the forecast was fit on. May contain nulls. */
  series: ReadonlyArray<number | null>;
  /** Company context — sector + tags shape risk-factor relevance. */
  company: {
    name: string;
    industry: string | null;
    /** Optional free-form tags (e.g. ["admin", "rollup_sourced"]).
     *  LLM uses these to skip suggestions that don't apply. */
    tags?: string[];
  };
  /** Output language for the narrative. UI stays EN. */
  language: ForecastExplainerLanguage;
}

export interface ForecastExplainerOutput {
  /** 1-2 sentence narrative — the trajectory framing. */
  narrative: string;
  /** Up to 3 likely drivers — sector-aware causal hypotheses. */
  driverHypotheses: string[];
  /** Up to 3 risk factors — events that could invalidate the forecast. */
  riskFactors: string[];
  /** LLM self-rated confidence (0..1). Distinct from the regression R²:
   *  this captures "how much do I trust THIS narrative" not "how well
   *  does the line fit". */
  confidence: number;
  usage?: { inputTokens: number; outputTokens: number };
  modelName: string;
  promptVersion: string;
}

const LANGUAGE_LABEL: Record<ForecastExplainerLanguage, string> = {
  en: "English",
  ru: "Russian (Русский)",
  az: "Azerbaijani (Azərbaycan dili)",
};

/** Bump on any change to SYSTEM_PROMPT or buildForecastPrompt structure. */
export const FORECAST_EXPLAINER_PROMPT_VERSION = "v1";

const SYSTEM_PROMPT = `You are a senior financial analyst producing forecast narratives for a CFO at an Azerbaijani diversified holding (~60 operational companies across 14 sectors: hospitality, agro, food processing, pharma, real estate, services, industrial, etc.).

Your job is DISTINCT from variance explanation: forecast narration is FORWARD-LOOKING and PROACTIVE, not reactive.

  - Variance Explainer ("what happened, fix it") → amber/red current cell.
  - Forecast Explainer (you) → trajectory + risks. The current value
    may be GREEN; you are explaining what may come next based on the
    trailing series.

Take ONE indicator's:
  1. Current period reading
  2. Linear-regression forecast for the next period (slope, R², n points)
  3. Trailing series (sparkline)
  4. Company sector + tags

Produce:
  1. Narrative — 1-2 sentences. Plain language, no jargon a non-specialist
     couldn't follow. Cite the actual numerical change (e.g. "trending
     from 14% in March to 9.5% next period — a 4.5pp compression").
     If the LINEAR-REGRESSION confidence is "low" or contributingCount<5,
     LEAD WITH THE LIMITATION ("with only 3 data points, this is
     directional only").
  2. driverHypotheses — up to 3 causal hypotheses for the observed
     trend. Sector-aware: hospitality → seasonal mix / ADR; agro →
     yield / feed cost; petrochem → crude prices / sanctions impact;
     services → headcount / productivity. NEVER suggest cross-sector
     drivers that don't apply.
  3. riskFactors — up to 3 events that could INVALIDATE the forecast.
     Concrete + actionable to monitor: "Iran sanctions tightening
     would push feedstock cost +20%", "AZN devaluation 15% would
     compress import margins", "Q4 seasonal demand exit could
     accelerate revenue decline". NOT generic ("market volatility").
  4. confidence — your own (0.0-1.0). Distinct from R². Below 0.5 means
     "the line fit looks fine but I'd want external market signals
     before recommending action".

Constraints:
  - Output STRICT JSON matching the schema. No markdown, no prose around it.
  - driverHypotheses + riskFactors items: ≤ 25 words each. CFO-readable.
  - For tags including 'admin' or 'cost_centre' or 'rollup_sourced':
    skip revenue-side hypotheses (these companies have no revenue),
    focus on cost / FX / consolidation drivers.
  - For status='unknown': flag the data-quality issue first; treat
    forecast as suspect.`;

function summarizeSeries(series: ReadonlyArray<number | null>): string {
  if (series.length === 0) return "(empty)";
  const fmt = (v: number | null) =>
    v === null || v === undefined ? "—" : v.toFixed(2);
  return series.map(fmt).join(", ");
}

export function buildForecastPrompt(input: ForecastExplainerInput): string {
  const lines: string[] = [];
  lines.push(`Indicator: ${input.indicator.code} — ${input.indicator.nameEn}`);
  lines.push(
    `Direction: ${input.indicator.direction} (unit: ${input.indicator.unit})`,
  );
  if (input.indicator.hintTemplateEn) {
    lines.push(`Benchmark hint: ${input.indicator.hintTemplateEn}`);
  }
  lines.push("");
  lines.push(
    `Company: ${input.company.name}${input.company.industry ? ` (${input.company.industry})` : ""}`,
  );
  if (input.company.tags && input.company.tags.length > 0) {
    lines.push(`Tags: ${input.company.tags.join(", ")}`);
  }
  lines.push("");
  lines.push(
    `Current period (${input.current.period}): ${input.current.value.toFixed(2)} [${input.current.status}]`,
  );
  lines.push("");
  lines.push("Forecast (next period):");
  lines.push(`  predicted: ${input.forecast.predicted.toFixed(2)}`);
  lines.push(`  slope: ${input.forecast.slope.toFixed(4)} per period`);
  lines.push(
    `  R²: ${input.forecast.r2.toFixed(3)} (n=${input.forecast.contributingCount} of ${input.series.length} slots)`,
  );
  lines.push(`  confidence band: ${input.forecast.confidence}`);
  lines.push(`  method: ${input.forecast.method}`);
  lines.push("");
  lines.push(`Trailing series: [${summarizeSeries(input.series)}]`);
  lines.push("");
  lines.push(
    `Output language: ${LANGUAGE_LABEL[input.language]}.`,
  );
  lines.push("");
  lines.push(
    'Respond with STRICT JSON only: {"narrative":"...","driverHypotheses":["...",...],"riskFactors":["...",...],"confidence":0.X}',
  );
  return lines.join("\n");
}

interface ShapedBody {
  narrative: string;
  driverHypotheses: string[];
  riskFactors: string[];
  confidence: number;
}

function validateAndShape(parsed: unknown): ShapedBody {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(
      `Forecast explainer: response was not a JSON object — got ${typeof parsed}`,
    );
  }
  const obj = parsed as Record<string, unknown>;
  const narrative = obj.narrative;
  if (typeof narrative !== "string" || narrative.trim() === "") {
    throw new Error(
      `Forecast explainer: missing or empty 'narrative' string`,
    );
  }
  const driverHypotheses = obj.driverHypotheses;
  if (
    !Array.isArray(driverHypotheses) ||
    !driverHypotheses.every((s) => typeof s === "string")
  ) {
    throw new Error(
      `Forecast explainer: 'driverHypotheses' must be string[]`,
    );
  }
  const riskFactors = obj.riskFactors;
  if (
    !Array.isArray(riskFactors) ||
    !riskFactors.every((s) => typeof s === "string")
  ) {
    throw new Error(`Forecast explainer: 'riskFactors' must be string[]`);
  }
  const confidence = obj.confidence;
  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw new Error(
      `Forecast explainer: 'confidence' must be a number in [0, 1] — got ${JSON.stringify(confidence)}`,
    );
  }
  // Cap arrays at 3 — prompt says "up to 3" so over-eager LLMs get
  // truncated rather than the API forwarding 7 risk factors to the UI.
  return {
    narrative: narrative.trim(),
    driverHypotheses: (driverHypotheses as string[])
      .slice(0, 3)
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    riskFactors: (riskFactors as string[])
      .slice(0, 3)
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    confidence,
  };
}

export interface RunForecastExplainerOptions {
  model?: string;
  maxTokens?: number;
  /** Test seam — inject a fake Anthropic client for unit tests. */
  client?: ReturnType<typeof getAnthropicClient>;
}

export async function runForecastExplainer(
  input: ForecastExplainerInput,
  opts: RunForecastExplainerOptions = {},
): Promise<ForecastExplainerOutput> {
  const client = opts.client ?? getAnthropicClient();
  const model = opts.model ?? AI_MODEL;
  // 8192 vs variance-explainer's 4096 — forecast output carries 3
  // hypotheses + 3 risk factors (≤25 words each) + narrative + LLM
  // confidence vs variance's 3 recommendations + topDrivers + narrative.
  // Net ~50% more prose, plus RU/AZ tokenization is ~2× English per
  // `feedback_llm_max_tokens.md`. 8K covers worst case (RU at full
  // verbosity); architect sub-22 closure on the asymmetry.
  const maxTokens = opts.maxTokens ?? 8192;

  const userMessage = buildForecastPrompt(input);

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  if (response.stop_reason === "max_tokens") {
    throw new Error(
      `Forecast explainer truncated at max_tokens=${maxTokens}. Re-run with higher maxTokens — RU/AZ output needs more headroom than EN.`,
    );
  }

  const textBlocks = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text);
  if (textBlocks.length === 0) {
    throw new Error(
      `Forecast explainer: response had no text content (got: ${JSON.stringify(response.content.map((b) => b.type))})`,
    );
  }
  const raw = textBlocks.join("\n").trim();
  const jsonText = extractJsonFromText(raw);
  if (!jsonText) {
    throw new Error(
      `Forecast explainer: response did not contain valid JSON. Raw: ${raw.slice(0, 200)}…`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `Forecast explainer: response did not contain valid JSON. Parse error: ${err instanceof Error ? err.message : String(err)}. Raw: ${raw.slice(0, 200)}…`,
    );
  }

  const shaped = validateAndShape(parsed);
  const out: ForecastExplainerOutput = {
    ...shaped,
    modelName: response.model ?? model,
    promptVersion: FORECAST_EXPLAINER_PROMPT_VERSION,
  };
  if (response.usage) {
    out.usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
  return out;
}
