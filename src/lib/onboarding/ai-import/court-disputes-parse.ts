/**
 * Court-disputes register parser ("Açıq məhkəmə mübahisələri.xlsx").
 *
 * Ports the proven logic of scripts/import-court-disputes-detailed.mjs into a
 * pure function the AI-import LEGAL_CASES adapter calls. Each data row is one
 * case (num | date | court | claimant | defendant | disputeType | caseDesc |
 * dept | lawyer | status); a case is attributed to whichever AzerSheker entities
 * appear in its claimant/defendant text, and aggregated per company into the 5
 * `court_disputes_*` counts the OperationalFact resolver reads (court_disputes_open
 * → LEGAL_CASES_ACTIVE via the compliance alias).
 *
 * Pure: no DB, no LLM.
 */
import type * as XLSXType from "xlsx"

export interface CourtCase {
  date: string
  court: string
  claimant: string
  defendant: string
  disputeType: string
  status: string
  closed: boolean
}
import type { CompanyMatcher } from "./soft-entity-match"

export interface CourtCaseAgg {
  total: number
  open: number
  as_defendant: number
  as_plaintiff: number
  money_claims: number
  cases: CourtCase[]
}
export interface CourtDisputesParseResult {
  byCompany: Record<string, CourtCaseAgg>
  warnings: string[]
}

// Substring → company code, tested case-insensitively against claimant+defendant.
// Order matters (CPC before the broad Azərşəkər root).
const COMPANY_MATCHERS: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /cpc/i, code: "AZSEKER-CPC" },
  { pattern: /eden\s*agro/i, code: "AZSEKER-EDEN" },
  { pattern: /promalt|pro\s*malt/i, code: "AZSEKER-PROMALT" },
  { pattern: /\bmalt\b/i, code: "AZSEKER-MALT" },
  { pattern: /azərşəkər/i, code: "AZSEKER-AZSF" },
]
const CLOSED_KEYWORDS = [
  /icraata xitam/i,
  /təmin edilməyib/i,
  /təmin edilmiş/i,
  /mümkün sayılmamış/i,
  /qətnamə.*çıxarıl/i,
  /qərardad/i,
  /icra edilmiş/i,
  /bağlanmışdır/i,
  /xitam verilib/i,
]
const ENTITY_RE = /azərşəkər|cpc|eden|malt|promalt/i

/**
 * Phase 11.33 — attribute a case to companies.
 *
 * `matcher` resolves against the ORG's own companies (see
 * `soft-entity-match.ts`). Omitting it keeps the historical AzerSheker-only
 * behaviour, which is what the pure-parser tests exercise.
 *
 * Multiple codes are legitimate here and are NOT an ambiguity: a case can name
 * two group companies, one as claimant and one as defendant.
 */
export function attributeCompanies(
  claimant: string,
  defendant: string,
  matcher?: CompanyMatcher,
): string[] {
  const text = `${claimant} || ${defendant}`
  if (matcher) return matcher(text).codes
  const codes = new Set<string>()
  for (const { pattern, code } of COMPANY_MATCHERS) if (pattern.test(text)) codes.add(code)
  return [...codes]
}
function isClosed(status: string): boolean {
  return !!status && CLOSED_KEYWORDS.some((re) => re.test(status))
}
function hasMoneyClaim(disputeType: string, caseDescription: string): boolean {
  return /pul tələb|kommersiya|borc|cərimə|məbləğ/i.test(`${disputeType} ${caseDescription}`)
}

export function parseCourtDisputes(
  workbook: XLSXType.WorkBook,
  sheetName: string,
  XLSX: typeof XLSXType,
  /** Phase 11.33 — org-derived matcher. Absent → legacy AzerSheker patterns. */
  matcher?: CompanyMatcher,
): CourtDisputesParseResult {
  const ws = workbook.Sheets[sheetName]
  if (!ws) return { byCompany: {}, warnings: [`Sheet "${sheetName}" not found`] }
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as unknown[][]
  // Header occupies the first rows; case data starts at row index 3.
  const dataRows = aoa.slice(3).filter((r) => r && r[0] !== "" && r[0] != null)
  const byCompany: Record<string, CourtCaseAgg> = {}
  let unattributable = 0
  const unattributableSamples: string[] = []
  for (const r of dataRows) {
    const cells = r.map((c) => (c == null ? "" : String(c).trim()))
    const [, date, court, claimant, defendant, disputeType, caseDesc, , , status] = cells
    const codes = attributeCompanies(claimant ?? "", defendant ?? "", matcher)
    if (codes.length === 0) {
      // Phase 11.33 — this was a bare `continue`. An unattributable case is
      // now COUNTED, so a register that resolves to nothing reports the size
      // of what it dropped instead of importing silently as zero cases.
      unattributable += 1
      if (unattributableSamples.length < 5 && (claimant || defendant)) {
        unattributableSamples.push(`${claimant || "—"} / ${defendant || "—"}`)
      }
      continue
    }
    const closed = isClosed(status ?? "")
    const isDefendant = ENTITY_RE.test(defendant ?? "")
    const isPlaintiff = ENTITY_RE.test(claimant ?? "")
    const money = hasMoneyClaim(disputeType ?? "", caseDesc ?? "")
    for (const code of codes) {
      const c = (byCompany[code] ??= {
        total: 0,
        open: 0,
        as_defendant: 0,
        as_plaintiff: 0,
        money_claims: 0,
        cases: [],
      })
      c.total += 1
      if (!closed) c.open += 1
      if (isDefendant) c.as_defendant += 1
      if (isPlaintiff) c.as_plaintiff += 1
      if (money) c.money_claims += 1
      c.cases.push({
        date: date ?? "",
        court: court ?? "",
        claimant: claimant ?? "",
        defendant: defendant ?? "",
        disputeType: disputeType ?? "",
        status: (status ?? "").slice(0, 200),
        closed,
      })
    }
  }
  const warnings: string[] = []
  if (unattributable > 0) {
    warnings.push(
      `${unattributable} of ${dataRows.length} court cases on "${sheetName}" named no company ` +
        `known to this organization and were dropped` +
        (unattributableSamples.length
          ? ` (e.g. ${unattributableSamples.join("; ")})`
          : ""),
    )
  }
  if (Object.keys(byCompany).length === 0) warnings.push(`No attributable court cases on "${sheetName}"`)
  return { byCompany, warnings }
}

/** The 5 OperationalFact metrics this register writes (count, dated year-end). */
export const COURT_DISPUTE_METRICS = [
  "court_disputes_total",
  "court_disputes_open",
  "court_disputes_as_defendant",
  "court_disputes_as_plaintiff",
  "court_disputes_money_claims",
] as const
