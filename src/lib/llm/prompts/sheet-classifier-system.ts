/**
 * Phase 7.M Tier 4 (2026-05-19) — Sheet classifier system prompt.
 *
 * Single source of truth for the LLM that decides what KIND of financial
 * data is in each sheet of an uploaded workbook. Used by AI Import to
 * route each sheet to the correct adapter.
 *
 * `SHEET_CLASSIFIER_PROMPT_VERSION` is auto-derived from prompt content
 * (sha256 substring) — cache invalidates automatically on prompt edits.
 */
import { createHash } from "crypto"

export const SHEET_CLASSIFIER_SYSTEM_PROMPT = `You are an expert financial-data analyst routing sheets from an uploaded Excel workbook to the correct parser.

For each sheet, given its name, headers, sample rows, and column type profiles, decide:

1. **dataType** — exactly one of:
   - "PLF"           = Profit & Loss / Income Statement (Revenue, COGS, OPEX rows)
   - "BS"            = Balance Sheet (Assets, Liabilities, Equity)
   - "CF"            = Cash Flow Statement (Operating / Investing / Financing flows)
   - "KPI_FARMING"   = Agricultural KPIs (crop volumes, yields, hectares per farm)
   - "KPI_PROCESSING"= Production-line KPIs (capacity utilization, extraction rates)
   - "CAPEX"         = Capital expenditure plan (assets, vehicles, equipment with quantities)
   - "SALES"         = Sales plan / volumes per product or customer
   - "LAND_REGISTRY" = Land lease registry (hectares, lessor, registry numbers)
   - "DESCRIPTIONS"  = Strategic narrative / company description text
   - "INFO_SUMMARY"  = High-level summary / index of other sheets
   - "COMPANIES"     = Org-structure sheet listing entity tree (headers include some of: code, name, industry, level, parentCompanyCode — case/whitespace insensitive). NOT a financial sheet — used to bootstrap or update the company hierarchy.
   - "UNKNOWN"       = Cannot determine; reviewer must classify manually

2. **entityCode** — the AZSEKER-* (or other) operational entity this sheet belongs to:
   - Match against the user-supplied "knownEntityCodes" hint if any
   - Common patterns:
       "PLF CPC" / "BS CPC" / "CF CPC" → AZSEKER-CPC
       "PLF AZSF" / "BS AZSF" → AZSEKER-AZSF
       "PLF EDEN" / "BS EDEN" → AZSEKER-EDEN
       "PL Malt" / "BS Malt" → AZSEKER-MALT
       "CAPEX_Farm" → AZSEKER-EDEN (farms operate under Eden Agro per holding policy)
       "CAPEX_CPC" → AZSEKER-CPC
       "Satış ProMalt" → AZSEKER-PROMALT (separate sales entity for Promalt MMC)
   - For cross-entity sheets (e.g. Farming KPI lists multiple farms by cost-centre),
     return null and let the adapter handle per-row attribution.

3. **confidence** — 0.0..1.0 honesty. Below 0.6 = "guessing, reviewer must verify".

4. **reasoning** — ONE LINE max (tooltip-grade). Cite the specific signal that drove the call
   (e.g. "headers contain PLF.01.X codes → P&L"; "sheet name 'BS XXX' is balance-sheet pattern").

Constraints:
  - Output STRICT JSON matching the schema in the user message — no markdown, no commentary.
  - Recognise multilingual sheet names (Azerbaijani / Russian / English / Turkish).
  - If a sheet name contains ">>>" or "<<<" markers, classify as INFO_SUMMARY (it's a section separator).
  - When in doubt between PLF and BS: PLF has month columns + Revenue/COGS labels;
    BS has period snapshots (year-end values) + Assets/Liabilities/Equity labels.
  - Confidence calibration: if sheet name + headers + sample rows all point to the same
    type → 0.9+. If only sheet name signals it → 0.7. If only inference from samples → 0.6.
    If nothing matches → UNKNOWN at confidence 0.3.`

export const SHEET_CLASSIFIER_PROMPT_VERSION: string =
  "v" +
  createHash("sha256")
    .update(SHEET_CLASSIFIER_SYSTEM_PROMPT)
    .digest("hex")
    .slice(0, 8)

export function buildSheetClassifierUserMessage(payload: {
  sheets: Array<{
    sheetName: string
    totalRows: number
    totalColumns: number
    headers: string[]
    sample: string[][]
    columnProfiles: Array<{
      header: string | null
      types: Record<string, number>
      sampleValues: string[]
    }>
  }>
  knownEntityCodes?: string[]
  orgIndustry?: string
  /** Phase 7.M Tier 5 (2026-05-20) — filename hint as soft prior.
   *  E.g. "Farming strategy - Guvven.xlsx" suggests forward-forecast
   *  shape (10-year projection in İcmal). Use only when sheet evidence
   *  is ambiguous; do NOT override clear sheet-shape evidence. */
  filenameHint?: string
}): string {
  const hint =
    payload.knownEntityCodes && payload.knownEntityCodes.length
      ? `\n\nKnown entity codes in this organisation: ${payload.knownEntityCodes.join(", ")}`
      : ""
  const industryLine = payload.orgIndustry
    ? `\nOrg primary industry: ${payload.orgIndustry}`
    : ""
  const filenameLine = payload.filenameHint
    ? `\nSource filename: "${payload.filenameHint}" — use as soft prior when sheet content is ambiguous (e.g. "Farming strategy" or "strategy" in name → likely forward-forecast file; "land" / "Çıxar" → land registry; "actuals" → actual financial data). Do NOT override clear sheet-shape evidence.`
    : ""
  const sheetsJson = JSON.stringify(payload.sheets, null, 2)
  return `Classify each of these ${payload.sheets.length} sheets.${hint}${industryLine}${filenameLine}

Sheets:
${sheetsJson}

Return STRICT JSON in this exact shape (no markdown, no extra prose):

{
  "classifications": [
    {
      "sheetName": "<exactly as in input>",
      "dataType": "PLF|BS|CF|KPI_FARMING|KPI_PROCESSING|CAPEX|SALES|LAND_REGISTRY|DESCRIPTIONS|INFO_SUMMARY|COMPANIES|UNKNOWN",
      "entityCode": "AZSEKER-CPC" | null,
      "confidence": 0.0,
      "reasoning": "one line — what signal drove this"
    }
  ]
}`
}
