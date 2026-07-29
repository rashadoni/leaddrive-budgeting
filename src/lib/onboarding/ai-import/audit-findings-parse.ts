/**
 * Internal-audit findings parser ("Follow up - For GTC.xlsx", "Follow-up" sheet).
 *
 * Ports the proven logic of scripts/import-audit-findings.mjs into a pure
 * function the AI-import AUDIT_FINDINGS adapter calls. Each data row is one
 * finding (col 1 = severity Major/Minor/Observation/OFI, col 3 = company, col 6
 * = MNG status); aggregated per company into the 6 `audit_findings_*` metrics the
 * OperationalFact resolver reads (audit_findings_completed_pct → AUDIT_CLOSED_PCT,
 * audit_findings_major_open → AUDIT_MAJOR_OPEN).
 *
 * Pure: no DB, no LLM.
 */
import type * as XLSXType from "xlsx"

export interface AuditFinding {
  severity: string
  audit: string
  status: string
  grouping: string
  findingStatusJan: string
}
export interface AuditAgg {
  total: number
  completed: number
  major_open: number
  minor_open: number
  observation_open: number
  findings: AuditFinding[]
}
import type { CompanyMatcher } from "./soft-entity-match"

export interface AuditParseResult {
  byCompany: Record<string, AuditAgg>
  warnings: string[]
}

const COMPLETED_RE = /yerinə yetirilib/i

function severityBucket(raw: string): string {
  const s = raw.trim().toLowerCase()
  if (s === "major" || s === "major nc") return "major"
  if (s === "minor" || s === "minor nc") return "minor"
  if (s === "observation" || s === "ofi") return "observation"
  return "other"
}

/** Map an audit "Şirkət" cell → company code. Mirrors the .mjs COMPANY_MAP
 *  ("Azərşəkər"→AZSF, "CPC MMC"→CPC) with a normalized fallback for the other
 *  AzerSheker entities; unmapped → null (skipped, never guessed). */
export function mapAuditCompany(raw: string, matcher?: CompanyMatcher): string | null {
  const n = raw.trim().toLowerCase()
  if (!n) return null
  if (matcher) {
    // Phase 11.33 — resolve against the ORG's companies. A cell naming two of
    // them is NOT attributed to whichever pattern came first: the "Şirkət"
    // column holds one owner per finding, so two hits means the cell is not
    // the signal it was assumed to be, and the caller reports it.
    const { codes } = matcher(raw)
    return codes.length === 1 ? codes[0] : null
  }
  if (n.includes("cpc")) return "AZSEKER-CPC"
  if (n.includes("eden")) return "AZSEKER-EDEN"
  if (n.includes("promalt") || n.includes("pro malt")) return "AZSEKER-PROMALT"
  if (/\bmalt\b/.test(n)) return "AZSEKER-MALT"
  if (n.includes("azərşəkər") || n.includes("azerseker") || n.includes("azersheker")) return "AZSEKER-AZSF"
  return null
}

/**
 * Phase 11.25 (2026-07-29) — locate the header row and the columns by LABEL,
 * instead of assuming `slice(2)` and fixed indices r[1]/r[3]/r[4]/r[6]/r[7]/r[9].
 *
 * Positional parsing is silent when it is wrong: insert one column in the
 * source workbook and every finding is read from the neighbouring field —
 * severity becomes a date, the company becomes an audit name, and the import
 * still reports success. The register feeds AUDIT_CLOSED_PCT and
 * AUDIT_MAJOR_OPEN, so a shifted read moves compliance indicators without any
 * signal.
 *
 * Labels are matched loosely (lower-cased substring) because the source mixes
 * Azerbaijani and English headings. When a column cannot be found by label the
 * legacy index is used AND reported, so the fallback is visible rather than
 * assumed.
 */
const AUDIT_COLUMN_HINTS: Record<string, { hints: string[]; legacy: number }> = {
  severity: { hints: ["severity", "əhəmiyyət", "ciddilik", "rating"], legacy: 1 },
  company: { hints: ["company", "şirkət", "entity", "müəssisə"], legacy: 3 },
  audit: { hints: ["audit", "yoxlama"], legacy: 4 },
  statusMng: { hints: ["management", "status", "vəziyyət"], legacy: 6 },
  grouping: { hints: ["group", "qrup", "category", "kateqoriya"], legacy: 7 },
  findingStatusJan: { hints: ["jan", "yanvar"], legacy: 9 },
}

function locateAuditColumns(aoa: unknown[][]): {
  headerRow: number
  index: Record<string, number>
  warnings: string[]
} {
  const warnings: string[] = []
  // The header is the first row within the top 10 that matches at least two
  // known labels — one match could be a stray data cell.
  let headerRow = -1
  let best = 1
  for (let r = 0; r < Math.min(10, aoa.length); r++) {
    const cells = (aoa[r] ?? []).map((c) => String(c ?? "").toLowerCase().trim())
    let hits = 0
    for (const { hints } of Object.values(AUDIT_COLUMN_HINTS)) {
      if (cells.some((c) => c && hints.some((h) => c.includes(h)))) hits++
    }
    if (hits > best) {
      best = hits
      headerRow = r
    }
  }
  const index: Record<string, number> = {}
  if (headerRow === -1) {
    warnings.push(
      "audit findings: no header row recognised in the first 10 rows — falling back to " +
        "fixed column positions. Verify the columns before trusting AUDIT_* indicators.",
    )
    for (const [k, v] of Object.entries(AUDIT_COLUMN_HINTS)) index[k] = v.legacy
    return { headerRow: 1, index, warnings }
  }
  const cells = (aoa[headerRow] ?? []).map((c) =>
    String(c ?? "").toLowerCase().trim(),
  )
  for (const [key, { hints, legacy }] of Object.entries(AUDIT_COLUMN_HINTS)) {
    const found = cells.findIndex((c) => c && hints.some((h) => c.includes(h)))
    if (found >= 0) {
      index[key] = found
    } else {
      index[key] = legacy
      warnings.push(
        `audit findings: column "${key}" not found by label — using legacy position ${legacy}.`,
      )
    }
  }
  return { headerRow, index, warnings }
}

export function parseAuditFindings(
  workbook: XLSXType.WorkBook,
  sheetName: string,
  XLSX: typeof XLSXType,
  /** Phase 11.33 — org-derived matcher. Absent → legacy AzerSheker patterns. */
  matcher?: CompanyMatcher,
): AuditParseResult {
  const ws = workbook.Sheets[sheetName]
  if (!ws) return { byCompany: {}, warnings: [`Sheet "${sheetName}" not found`] }
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as unknown[][]
  // Phase 11.25 — header located by label, not assumed at a fixed offset.
  const located = locateAuditColumns(aoa)
  const col = located.index
  const dataRows = aoa
    .slice(located.headerRow + 1)
    .filter((r) => r && r.some((c) => c !== "" && c != null))
  const byCompany: Record<string, AuditAgg> = {}
  const unmapped = new Set<string>()
  for (const r of dataRows) {
    const severityRaw = String(r[col.severity] ?? "").trim()
    const companyRaw = String(r[col.company] ?? "").trim()
    if (!severityRaw || !companyRaw) continue
    const code = mapAuditCompany(companyRaw, matcher)
    if (!code) {
      unmapped.add(companyRaw)
      continue
    }
    const bucket = severityBucket(severityRaw)
    const statusMng = String(r[col.statusMng] ?? "").trim()
    const completed = COMPLETED_RE.test(statusMng)
    const c = (byCompany[code] ??= {
      total: 0,
      completed: 0,
      major_open: 0,
      minor_open: 0,
      observation_open: 0,
      findings: [],
    })
    c.total += 1
    if (completed) c.completed += 1
    else if (bucket === "major") c.major_open += 1
    else if (bucket === "minor") c.minor_open += 1
    else if (bucket === "observation") c.observation_open += 1
    c.findings.push({
      severity: severityRaw,
      audit: String(r[col.audit] ?? "").trim(),
      status: statusMng,
      grouping: String(r[col.grouping] ?? "").trim(),
      findingStatusJan: String(r[col.findingStatusJan] ?? "").trim(),
    })
  }
  const warnings: string[] = [...located.warnings]
  for (const u of unmapped) warnings.push(`Unmapped company "${u}" — audit findings skipped`)
  if (Object.keys(byCompany).length === 0) warnings.push(`No attributable audit findings on "${sheetName}"`)
  return { byCompany, warnings }
}

export function auditCompletedPct(agg: AuditAgg): number {
  return agg.total > 0 ? Math.round((agg.completed / agg.total) * 100) : 0
}

/** The 6 OperationalFact metrics this register writes (counts + one _pct). */
export const AUDIT_FINDING_METRICS = [
  "audit_findings_total",
  "audit_findings_completed",
  "audit_findings_major_open",
  "audit_findings_minor_open",
  "audit_findings_observation_open",
  "audit_findings_completed_pct",
] as const
