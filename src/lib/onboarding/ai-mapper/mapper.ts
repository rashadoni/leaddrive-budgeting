/**
 * AI Data Mapper — LLM-driven column-mapping + anomaly detection.
 *
 * Takes a `MapperInput` (extracted xlsx) and returns a `MappingProposal`
 * (column roles + account-type inferences + anomalies). Uses Anthropic
 * Claude via the existing `getAnthropicClient()` infrastructure.
 *
 * **Critical safety**: the LLM is *advisory*. The proposal is shown to a
 * finance reviewer in the onboarding UI; nothing lands in DB until the
 * reviewer confirms. So an over-confident wrong mapping is annoying but
 * not financially dangerous — same review gate as any other Excel import.
 */

import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';
import type { MapperInput, MappingProposal } from './types';
import { renderInputForPrompt } from './extract';
import { extractJsonFromText } from './json-extract';

const SYSTEM_PROMPT = `You are an expert financial-data analyst onboarding messy spreadsheets into a holding-level risk terminal.

Your job: given a sheet from an unknown company's budget/P&L workbook, propose:
  1. What each column means (account code, label, monthly amount, annual total, plan/actual flag, or skip).
  2. Account-type inference for any rows that have an account code (revenue / cogs / expense / asset / liability / equity), based on SAP-style prefixes (6xx=revenue, 70x/71x=cogs, 72x..79x/9xx=expense, 1xx=asset, 2xx=liability, 3xx=equity).
  3. Anomalies that a finance reviewer should see before committing — sign inversions, magnitude outliers, category mismatches, missing breakdowns, currency-mix issues, implausible ratios.

Constraints:
  - Output STRICT JSON matching the schema given in the user message — no markdown, no commentary outside JSON.
  - Use 0..1 confidence scores honestly. Below 0.6 means "I'm guessing — reviewer must verify".
  - Reasoning fields: ONE LINE max. UI-tooltip-grade. No paragraphs.
  - When source columns have multilingual headers (Azerbaijani, Russian, English), recognize the language and parse accordingly.
  - Months: support AZ ("Yanvar"…"Dekabr"), EN ("Jan"…"Dec" / "January"…"December"), RU ("Январь"…"Декабрь" / "Янв"…"Дек").
  - For the SAP-prefix rule: codes like \`601-04\`, \`701-01-02\`, \`721-02\` follow this convention. If you see a code that doesn't match, flag as anomaly category="other".`;

function buildUserMessage(input: MapperInput): string {
  const renderedInput = renderInputForPrompt(input);
  return `${renderedInput}

Return STRICT JSON in this exact shape (no markdown, no extra prose):

{
  "summary": "1-3 sentence description of what this sheet appears to represent",
  "overallConfidence": 0.0,
  "columns": [
    {"sourceIndex": 0, "role": "skip|code|label|amount:Jan|amount:Total|...", "confidence": 0.0, "reasoning": "one line"}
  ],
  "accountTypeOverrides": [
    {"code": "601-04", "accountType": "revenue", "confidence": 0.9, "reasoning": "601 prefix = revenue"}
  ],
  "anomalies": [
    {"row": 42, "severity": "critical|warning|info", "category": "sign_inversion|magnitude_outlier|category_mismatch|duplicate_row|missing_breakdown|currency_mix|implausible_ratio|other", "description": "one sentence"}
  ]
}`;
}

/**
 * Run the AI mapper. Throws on API failure (caller handles); returns
 * `MappingProposal` on success. **Does NOT write to DB** — pure proposal.
 *
 * @param input parsed xlsx structure (see `extractMapperInput`).
 * @param opts optional overrides — e.g. `model` for testing with cheaper tier.
 */
export async function runMapper(
  input: MapperInput,
  opts: { model?: string; maxTokens?: number } = {},
): Promise<MappingProposal> {
  const client = getAnthropicClient();
  const model = opts.model ?? AI_MODEL;
  const maxTokens = opts.maxTokens ?? 8192;

  const userMessage = buildUserMessage(input);

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  // Defensive: max_tokens cutoff loses the closing brace and breaks parse.
  // Surface explicitly per memory/feedback_llm_max_tokens.md.
  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      `AI Mapper truncated at max_tokens=${maxTokens}. Re-run with higher maxTokens (the response was clipped mid-JSON).`,
    );
  }

  // Anthropic SDK can return MULTIPLE text blocks (rare but documented for
  // streaming-style models). Concatenate all of them rather than picking
  // the first — `.find()` would lose content if the model split output.
  const textBlocks = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text);
  if (textBlocks.length === 0) {
    throw new Error(
      `AI Mapper response had no text content (got: ${JSON.stringify(response.content.map((b) => b.type))})`,
    );
  }
  const raw = textBlocks.join('\n').trim();

  // Defensive JSON extraction — handles markdown fences, prose around the
  // JSON, and stray `{...}` patterns that would confuse a naive regex.
  // See `json-extract.ts` for the longest-valid-substring algorithm.
  const jsonText = extractJsonFromText(raw);

  let parsed: Omit<MappingProposal, 'sourceFile' | 'sourceSheet' | 'usage'>;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `AI Mapper returned invalid JSON. Error: ${err instanceof Error ? err.message : err}.\nFirst 300 chars: ${jsonText.slice(0, 300)}`,
    );
  }

  // Light shape validation — fail loudly on missing fields rather than
  // letting downstream code dereference undefined.
  const requiredFields = ['summary', 'overallConfidence', 'columns', 'anomalies'] as const;
  for (const f of requiredFields) {
    if (!(f in parsed)) {
      throw new Error(
        `AI Mapper response missing required field "${f}". Keys present: ${Object.keys(parsed).join(', ')}`,
      );
    }
  }
  if (!Array.isArray(parsed.columns)) {
    throw new Error(`AI Mapper "columns" is not an array (got: ${typeof parsed.columns})`);
  }
  if (!Array.isArray(parsed.anomalies)) {
    throw new Error(`AI Mapper "anomalies" is not an array (got: ${typeof parsed.anomalies})`);
  }

  // Per-element shape validation. Without this, a malformed LLM response
  // like `[{role: 123, confidence: "high"}]` JSON-parses fine but breaks
  // every downstream consumer. Validate at the proposal boundary.
  for (let i = 0; i < parsed.columns.length; i++) {
    const c = parsed.columns[i] as unknown as Record<string, unknown>;
    if (typeof c.sourceIndex !== 'number') {
      throw new Error(`AI Mapper columns[${i}].sourceIndex must be number (got ${typeof c.sourceIndex})`);
    }
    if (typeof c.role !== 'string') {
      throw new Error(`AI Mapper columns[${i}].role must be string (got ${typeof c.role})`);
    }
    if (
      typeof c.confidence !== 'number' ||
      !Number.isFinite(c.confidence) ||
      c.confidence < 0 ||
      c.confidence > 1
    ) {
      throw new Error(
        `AI Mapper columns[${i}].confidence must be finite number in [0,1] (got ${c.confidence})`,
      );
    }
    if (typeof c.reasoning !== 'string') {
      throw new Error(`AI Mapper columns[${i}].reasoning must be string`);
    }
  }
  for (let i = 0; i < parsed.anomalies.length; i++) {
    const a = parsed.anomalies[i] as unknown as Record<string, unknown>;
    if (a.row !== null && typeof a.row !== 'number') {
      throw new Error(`AI Mapper anomalies[${i}].row must be number or null`);
    }
    if (typeof a.severity !== 'string' || !['critical', 'warning', 'info'].includes(a.severity)) {
      throw new Error(
        `AI Mapper anomalies[${i}].severity must be 'critical'|'warning'|'info' (got '${a.severity}')`,
      );
    }
    if (typeof a.category !== 'string') {
      throw new Error(`AI Mapper anomalies[${i}].category must be string`);
    }
    if (typeof a.description !== 'string') {
      throw new Error(`AI Mapper anomalies[${i}].description must be string`);
    }
  }

  return {
    sourceFile: input.sourceFile,
    sourceSheet: input.sourceSheet,
    summary: parsed.summary,
    overallConfidence: parsed.overallConfidence,
    columns: parsed.columns,
    accountTypeOverrides: parsed.accountTypeOverrides ?? [],
    anomalies: parsed.anomalies,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
