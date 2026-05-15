/**
 * Phase 7.G Turn XLVI (Phase E.2) — AI-narrated executive summary for
 * the Board Deck.
 *
 * Given a `BoardSnapshot`, ask an LLM to produce:
 *   1. A 1-line headline (≤120 chars) — the "what's the story this
 *      quarter" hook the cover slide uses.
 *   2. Three paragraphs of executive narrative — what's driving the
 *      composite scores, where the active alerts cluster, what
 *      recommendations the CFO should bring to the board.
 *
 * Pure module: no DB, no Prisma. The caller (page.tsx + PPTX export
 * route) builds the snapshot via `buildBoardSnapshot()`, then hands it
 * here. `buildBoardSnapshot` deliberately stays LLM-free so the
 * deterministic snapshot data can be cached / re-used without
 * triggering Anthropic calls.
 *
 * Mirrors the variance-explainer module pattern:
 *   - getAnthropicClient() for the SDK
 *   - extractJsonFromText for tolerant JSON extraction
 *   - validateAndShape for strict shape enforcement (502-worthy on
 *     drift)
 *   - RunNarrationOptions test seam (client / model / maxTokens)
 *
 * Language: EN/RU/AZ user-selectable. UI surface stays in user's
 * locale; the LLM narrative is what we localize.
 *
 * Failure mode: throws on any LLM-side problem. Caller catches +
 * degrades gracefully (render snapshot without narrative section).
 * Page renders fine without it; PPTX export skips the headline + Slide
 * 2 narrative if the call fails.
 */

import { getAnthropicClient, AI_MODEL } from "@/lib/ai/client";
import { extractJsonFromText } from "@/lib/onboarding/ai-mapper/json-extract";
import type { BoardSnapshot } from "./build-snapshot";

export type NarrationLanguage = "en" | "ru" | "az";

const LANGUAGES: readonly NarrationLanguage[] = ["en", "ru", "az"];

export function isNarrationLanguage(s: string): s is NarrationLanguage {
  return (LANGUAGES as readonly string[]).includes(s);
}

const LANGUAGE_LABEL: Record<NarrationLanguage, string> = {
  en: "English",
  ru: "Russian (Русский)",
  az: "Azerbaijani (Azərbaycan dili)",
};

/** Hand-bumped on any change to SYSTEM_PROMPT or
 *  buildNarrationPrompt structure. v1 = initial Phase E.2 ship. */
export const NARRATION_PROMPT_VERSION = "v1";

export interface NarrationInput {
  snapshot: BoardSnapshot;
  language: NarrationLanguage;
}

export interface NarrationOutput {
  /** ≤120 char one-line hook for the cover slide / page header. */
  headline: string;
  /** Exactly three paragraphs, each ≤200 words. */
  paragraphs: [string, string, string];
  /** Tokens consumed — for budget tracking. Optional. */
  usage?: { inputTokens: number; outputTokens: number };
  /** Resolved Anthropic model id (e.g. "claude-sonnet-4-5-20250929").
   *  Captured for compliance attestation. */
  modelName: string;
  /** Hand-bumped NARRATION_PROMPT_VERSION; identifies the prompt
   *  variant that produced the narrative. */
  promptVersion: string;
}

const SYSTEM_PROMPT = `You are an executive-summary writer for the board deck of an Azerbaijani diversified holding (~60 operational sub-companies across 14 sectors: hospitality, agro, food processing, pharma, real estate, services, industrial, etc.).

Your audience: the CFO and board of directors. They need a 1-line headline that names the dominant story this period + 3 paragraphs of context they can read in <60 seconds before walking into the meeting.

Hard constraints:
  - Output STRICT JSON matching the schema. No markdown fences, no commentary, no apology.
  - \`headline\` ≤120 characters. Names the dominant story this period — not a summary of metrics, but a NARRATIVE ("Hospitality recovery offsets industrial drag" beats "Mixed results across sectors").
  - \`paragraphs\` is EXACTLY three strings. Paragraph 1: what's driving the headline (cite top 1-3 composite-score outliers + top 1-3 alerts). Paragraph 2: where the risk concentration is (sector / company patterns). Paragraph 3: what the CFO should bring to the board (concrete actions or watch-items, not "investigate further").
  - Each paragraph ≤200 words. CFO-readable. NO finance jargon a non-specialist couldn't follow ("EBITDA" / "OpEx" OK; "depreciation curtailment" / "amortization recapture" no).
  - Recommendations target the SECTOR. Hospitality → ADR/occupancy; agro_crops → yield/ha, water/fertilizer intensity, sugar content, drought-risk hedging via forward contracts on ICE Sugar #11; food_processing (sugar refining) → extraction rate, raw-input price exposure, capacity utilization; pharma → margin/inventory; industrial → utilization + input costs; real_estate → occupancy + rent collection. Don't suggest cross-sector pivots.
  - When the snapshot includes agro_crops or food_processing companies and the period covers a harvest cycle, explicitly reference: per-hectare yield, sugar content %, fertilizer/water intensity, ICE Sugar #11 trend (sugar_price_latest vs sugar_price_mean_12m). Generic "monitor crop performance" advice = worse answer than tailored "lock 30% of Q3 cane output via Nov ICE futures while AGRO_SUGAR_PRICE_TREND is +8% above 12M mean".
  - When the snapshot has zero red alerts and ≥80% green cells, lead with that — don't manufacture risk for theatrical effect.

Schema (use EXACTLY these field names):
  {
    "headline": "...",
    "paragraphs": ["...", "...", "..."]
  }`;

/**
 * Distill a `BoardSnapshot` into a compact prompt body. Pure helper —
 * testable without the SDK. Caps the cardinality of operational/alerts
 * lists to keep input tokens bounded (Phase F-scale 60 cos × full
 * cells would otherwise push past 8K input tokens).
 */
export function buildNarrationPrompt(input: NarrationInput): string {
  const { snapshot, language } = input;

  // Top-N composite scores, lowest first (worst risk on top).
  const compositeRows: Array<{
    code: string;
    name: string;
    industry: string | null;
    score: number | null;
    band: string;
  }> = [];
  for (const co of snapshot.operational) {
    const composite = snapshot.compositeByCompany.get(co.id);
    compositeRows.push({
      code: co.code,
      name: co.name,
      industry: co.industry,
      score: composite?.score ?? null,
      band: composite?.band ?? "unknown",
    });
  }
  compositeRows.sort((a, b) => {
    if (a.score === null && b.score === null) return 0;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return a.score - b.score;
  });
  const TOP_COMPOSITES = 12;
  const compositeBlock = compositeRows
    .slice(0, TOP_COMPOSITES)
    .map(
      (r) =>
        `  ${r.code} (${r.industry ?? "—"}): score=${
          r.score === null ? "—" : r.score
        } band=${r.band}`,
    )
    .join("\n");

  // Top alerts grouped by severity.
  const TOP_ALERTS_PER_SEVERITY = 6;
  const alertBlock = (["critical", "warning", "info"] as const)
    .map((sev) => {
      const list = snapshot.matchesBySeverity[sev]
        .slice(0, TOP_ALERTS_PER_SEVERITY)
        .map(
          (m) =>
            `  - [${m.ruleId}] ${m.message}${
              m.affectedCompanyIds.length > 0
                ? ` (companies: ${m.affectedCompanyIds.length})`
                : ""
            }`,
        )
        .join("\n");
      return `${sev.toUpperCase()} (${snapshot.matchesBySeverity[sev].length} total):\n${list || "  (none)"}`;
    })
    .join("\n\n");

  return `Holding: ${snapshot.org.name}
Period: ${snapshot.period}
Generated: ${snapshot.generatedAt}

Totals:
  Operational sub-cos: ${snapshot.totals.operational}
  Indicators: ${snapshot.totals.indicators}
  Cells: ${snapshot.totals.cells}
  Green / Amber / Red: ${snapshot.totals.green} / ${snapshot.totals.amber} / ${snapshot.totals.red}

Top ${TOP_COMPOSITES} composite scores (worst-first):
${compositeBlock || "  (no operational sub-cos)"}

Active alerts:
${alertBlock}

Output language: ${LANGUAGE_LABEL[language]}.

Return STRICT JSON in this exact shape (no markdown):
{
  "headline": "≤120 char one-line story",
  "paragraphs": [
    "paragraph 1 — what's driving the headline",
    "paragraph 2 — risk concentration",
    "paragraph 3 — what the CFO should bring to the board"
  ]
}`;
}

/** Validate + shape the LLM's parsed JSON. Throws on shape violation
 *  so the caller can render a degraded page (no narrative section)
 *  rather than 200-with-garbage. */
type ValidatedBody = Pick<NarrationOutput, "headline" | "paragraphs">;
function validateAndShape(parsed: unknown): ValidatedBody {
  if (parsed == null || typeof parsed !== "object") {
    throw new Error("Board narration: response is not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.headline !== "string" || obj.headline.trim() === "") {
    throw new Error("Board narration: missing or empty 'headline'");
  }
  // SYSTEM_PROMPT contract: headline ≤120 chars. Architect Turn-XLVI
  // 🔄 closure: enforce the documented contract. Soft trim at 120 if
  // model over-delivers (some prompts produce 130-char headlines);
  // hard cap at 240 chars (2× contract) is shape-violation territory
  // — anything beyond that suggests a malformed response, not a model
  // exceeding by a few characters.
  if (obj.headline.length > 240) {
    throw new Error(
      `Board narration: 'headline' too long (${obj.headline.length} chars; max 240)`,
    );
  }
  const headline = obj.headline.trim().slice(0, 120);

  if (
    !Array.isArray(obj.paragraphs) ||
    obj.paragraphs.length !== 3 ||
    !obj.paragraphs.every(
      (p): p is string => typeof p === "string" && p.trim() !== "",
    )
  ) {
    throw new Error(
      "Board narration: 'paragraphs' must be an array of EXACTLY three non-empty strings",
    );
  }
  const paragraphs = obj.paragraphs.map((p) => p.trim()) as [
    string,
    string,
    string,
  ];

  return { headline, paragraphs };
}

export interface RunNarrationOptions {
  /** Override the SDK client (test seam). */
  client?: ReturnType<typeof getAnthropicClient>;
  /** Override the model id. */
  model?: string;
  /** Override the response token cap. */
  maxTokens?: number;
}

/**
 * Call the LLM and return a typed `NarrationOutput`. Throws on API
 * failure / max_tokens truncation / shape violation. Caller catches
 * and renders without narrative on failure (graceful degradation —
 * deck is still useful without the AI summary).
 */
export async function runNarration(
  input: NarrationInput,
  opts: RunNarrationOptions = {},
): Promise<NarrationOutput> {
  const client = opts.client ?? getAnthropicClient();
  const model = opts.model ?? AI_MODEL;
  // 4K is enough for headline + 3 paragraphs + JSON overhead in EN.
  // RU/AZ ~2x token-density per `feedback_llm_max_tokens.md`, so 4096
  // covers worst-case Russian prose at full length.
  const maxTokens = opts.maxTokens ?? 4096;

  const userMessage = buildNarrationPrompt(input);

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  if (response.stop_reason === "max_tokens") {
    throw new Error(
      `Board narration truncated at max_tokens=${maxTokens}. Re-run with higher maxTokens — RU/AZ output needs more headroom than EN.`,
    );
  }

  const textBlocks = response.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text);
  if (textBlocks.length === 0) {
    throw new Error(
      `Board narration: response had no text content (got: ${JSON.stringify(response.content.map((b) => b.type))})`,
    );
  }
  const raw = textBlocks.join("\n").trim();
  const jsonText = extractJsonFromText(raw);
  if (!jsonText) {
    throw new Error(
      `Board narration: response did not contain valid JSON. Raw: ${raw.slice(0, 200)}…`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `Board narration: response did not contain valid JSON. Parse error: ${err instanceof Error ? err.message : String(err)}. Raw: ${raw.slice(0, 200)}…`,
    );
  }

  const shapedBody = validateAndShape(parsed);
  const out: NarrationOutput = {
    ...shapedBody,
    modelName: response.model ?? model,
    promptVersion: NARRATION_PROMPT_VERSION,
  };
  if (response.usage) {
    out.usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
  return out;
}
