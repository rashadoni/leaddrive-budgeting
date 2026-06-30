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
import type { compactWorkbookProfileForClassifier } from "@/lib/onboarding/ai-import/workbook-profile"

export const SHEET_CLASSIFIER_SYSTEM_PROMPT = `You are an expert financial-data analyst routing sheets from an uploaded Excel workbook to the correct parser.

For each sheet, given its name, headers, sample rows, column type profiles, and optional workbookProfile hints, decide:

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
   - "OPS_FACTS"     = Generic flat operational-facts sheet. Headers MUST include all of: companyCode (or "company"/"code"), metric (or "kpi"), date (or "period"), value (or "amount"/"qty"), unit — case/whitespace insensitive. Each row is one (company, metric, date, value, unit) fact. Distinct from KPI_FARMING / KPI_PROCESSING which are Azik-shape sheets with hardcoded metric positions per row/column. If a sheet has these exact five+ headers and one fact per row, classify as OPS_FACTS regardless of which metrics appear.
   - "BUDGET_ACTUALS" = Flat tabular budget-actuals sheet. Headers MUST include: category (or "account"), amount (or "sum"), date (or "period"); MAY also include department, description (or "memo"), lineType (or "type"), companyCode (or "company"). Each row is one expense/revenue actual transaction (e.g. "Office rent | Admin | 5000 | 2026-03-15 | March rent"). Distinct from PLF which has month columns spanning Jan-Dec — BUDGET_ACTUALS has DATE in a column, one row per transaction. Classify as BUDGET_ACTUALS when sheet has these row-shape signals AND no Jan/Feb/Mar/.../Dec or 2026-01/2026-02/... period columns.
   - "SALES_FORECAST" = Department × month forecast grid. Col 1 = department/team label (e.g. "Sales", "Marketing", "Online", "Retail", "B2B", "Wholesale", "Direct"), cols 2-13 = 12 month columns (Jan/Feb/.../Dec full or short, EN/RU/AZ; or 1/2/.../12; or "Yan"/"Fev" etc.). Each cell = forecast amount for (department, month). Distinct from PLF whose rows are P&L line items (Revenue/COGS/Gross Profit/OPEX/EBITDA). Distinct from SALES (which has product-line volumes in Azik-shape Sales sheets, written to operational_facts). Classify as SALES_FORECAST when col-1 labels are department-like (not P&L line items) AND remaining columns are months.
   - "COUNTERPARTY"   = Counterparty concentration register — top CUSTOMERS or SUPPLIERS listed by company NAME with a single turnover/amount each. Often several entities side-by-side, each a block: an entity header (e.g. "AZƏRŞƏKƏR MMC", "EDEN AGRO MMC", "CPC MMC") then rows of "<counterparty company name> | <turnover>". Tab names like "Top 10", "Customer", "Supplier", "Müştəri", "Təchizatçı", "Alıcılar". CRITICAL: classify as COUNTERPARTY, NOT "SALES" — SALES is product-line volumes/prices; COUNTERPARTY rows are NAMED third-party companies each with one turnover figure. "Customer"/"Supplier" tab of named firms with turnover ⇒ COUNTERPARTY. Feeds customer/supplier concentration (HHI).
   - "LEGAL_CASES"    = Court cases / legal disputes register — each row is one case (case #, date, court, claimant/plaintiff, defendant entity, claim amount, case description, status). Tab names like "Məhkəmə", "court", "disputes", "litigation", "mübahisə". Feeds active-legal-cases count.
   - "AUDIT_FINDINGS" = Internal-audit findings / observations register — rows are audit observations with a severity (Major / Minor / Observation / OFI), responsible unit/department, action plan, and a status (open / closed / in progress). Tab names like "Follow-up", "Audit", "PBC", "observations", "müşahidə". Feeds audit-closure %.
   - "RISK_REGISTER"  = Enterprise risk register / KRI taxonomy — hierarchical risk categories (Level 1 / Level 2 / Level 3), key risk indicators (KRI), a criticality/severity score, and risk descriptions. Tab names like "Top risk", "risk register", "KRI", "risklər". Recognized so it is NOT misclassified; a dedicated importer is wired once a KRI consumer indicator exists.
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
  - Use workbookProfile only as deterministic context: source_like sheets are usually safer write candidates than summary_like / pivot / duplicate / elimination sheets, but never override clear sheet evidence.
  - If workbookProfile marks a sheet with eliminationSignalCount > 0, duplicateGroupId, or summary_like role, be conservative: classify EJE/AJE/elimination/intercompany/pivot/summary views as INFO_SUMMARY unless the sheet is clearly the only source-of-record. Do NOT guess an operational entity for elimination sheets.
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
  workbookProfile?: ReturnType<typeof compactWorkbookProfileForClassifier>
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
  const workbookProfileLine = payload.workbookProfile
    ? `\n\nWorkbook profile hints (deterministic, compact; use for source-vs-summary, actual-vs-budget, BU/entity, formula, elimination, duplicate context):\n${JSON.stringify(payload.workbookProfile, null, 2)}`
    : ""
  const sheetsJson = JSON.stringify(payload.sheets, null, 2)
  return `Classify each of these ${payload.sheets.length} sheets.${hint}${industryLine}${filenameLine}${workbookProfileLine}

Sheets:
${sheetsJson}

Return STRICT JSON in this exact shape (no markdown, no extra prose):

{
  "classifications": [
    {
      "sheetName": "<exactly as in input>",
      "dataType": "PLF|BS|CF|KPI_FARMING|KPI_PROCESSING|CAPEX|SALES|LAND_REGISTRY|DESCRIPTIONS|INFO_SUMMARY|COMPANIES|OPS_FACTS|BUDGET_ACTUALS|SALES_FORECAST|COUNTERPARTY|LEGAL_CASES|AUDIT_FINDINGS|RISK_REGISTER|UNKNOWN",
      "entityCode": "AZSEKER-CPC" | null,
      "confidence": 0.0,
      "reasoning": "one line — what signal drove this"
    }
  ]
}`
}
