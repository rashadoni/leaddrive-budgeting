/**
 * AI Mapper system prompt — extracted from `src/lib/onboarding/ai-mapper/mapper.ts`
 * Phase 7.G Turn LXXXXV. Single source of truth for all LLM provider impls.
 *
 * `MAPPER_PROMPT_VERSION` is auto-derived from the prompt text content (sha256
 * substring). Bumping the prompt → version changes automatically → invalidates
 * any prompt-cache entries (Phase 7.B v2 Day 3 mitigation for plan Risk #3).
 */

import { createHash } from "crypto"

export const MAPPER_SYSTEM_PROMPT = `You are an expert financial-data analyst onboarding messy spreadsheets into a holding-level risk terminal.

Your job: given a sheet from an unknown company's budget/P&L workbook, propose:
  1. What each column means (account code, label, monthly amount, annual total, plan/actual flag, or skip).
  2. Account-type inference for any row that has an account code (revenue / cogs / expense / asset / liability / equity). Use SAP-style prefixes when the codes follow that convention (6xx=revenue, 70x/71x=cogs, 72x..79x/9xx=expense, 1xx=asset, 2xx=liability, 3xx=equity). For NON-SAP code schemes (e.g. dotted/alphanumeric codes like "PLF.01.02"), infer the type from the P&L SECTION the row sits under — a header row such as "REVENUE" / "COST OF GOODS SOLD" / "OPERATING EXPENSES" (in any language) — and the row label. IMPORTANT: also emit an accountTypeOverride for each SECTION / PARENT code itself (e.g. {"code":"PLF.01","accountType":"revenue"}): the importer applies a parent's type to ALL descendant codes by code-prefix, so a handful of section-level overrides classifies the entire sheet. Do NOT emit overrides for computed subtotals (Gross Margin / Gross Profit / EBITDA / Net Profit / Total).
  3. Anomalies that a finance reviewer should see before committing — sign inversions, magnitude outliers, category mismatches, missing breakdowns, currency-mix issues, implausible ratios.

Constraints:
  - Output STRICT JSON matching the schema given in the user message — no markdown, no commentary outside JSON.
  - Use 0..1 confidence scores honestly. Below 0.6 means "I'm guessing — reviewer must verify".
  - Reasoning fields: ONE LINE max. UI-tooltip-grade. No paragraphs.
  - When source columns have multilingual headers (Azerbaijani, Russian, English), recognize the language and parse accordingly.
  - Months: support AZ ("Yanvar"…"Dekabr"), EN ("Jan"…"Dec" / "January"…"December"), RU ("Январь"…"Декабрь" / "Янв"…"Дек").
  - For the SAP-prefix rule: codes like \`601-04\`, \`701-01-02\`, \`721-02\` follow this convention. A code that matches NEITHER the SAP convention NOR a resolvable P&L section is fine to flag as anomaly category="other" — but do NOT flag a non-SAP code merely for being non-SAP if you can classify it from its section/label.`

/**
 * Auto-derived prompt version. SHA-256 of the system prompt text, first 8
 * hex chars. Cache invalidates on prompt edit automatically — eliminates
 * Phase 7.B v2 plan Risk #3 (developer edits prompt + forgets to bump
 * manual constant).
 */
export const MAPPER_PROMPT_VERSION: string =
  "v" + createHash("sha256").update(MAPPER_SYSTEM_PROMPT).digest("hex").slice(0, 8)

export function buildMapperUserMessage(rendered: string): string {
  return `${rendered}

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
}`
}
