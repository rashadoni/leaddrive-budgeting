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
export function mapAuditCompany(raw: string): string | null {
  const n = raw.trim().toLowerCase()
  if (!n) return null
  if (n.includes("cpc")) return "AZSEKER-CPC"
  if (n.includes("eden")) return "AZSEKER-EDEN"
  if (n.includes("promalt") || n.includes("pro malt")) return "AZSEKER-PROMALT"
  if (/\bmalt\b/.test(n)) return "AZSEKER-MALT"
  if (n.includes("azərşəkər") || n.includes("azerseker") || n.includes("azersheker")) return "AZSEKER-AZSF"
  return null
}

export function parseAuditFindings(
  workbook: XLSXType.WorkBook,
  sheetName: string,
  XLSX: typeof XLSXType,
): AuditParseResult {
  const ws = workbook.Sheets[sheetName]
  if (!ws) return { byCompany: {}, warnings: [`Sheet "${sheetName}" not found`] }
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as unknown[][]
  // Header occupies the first rows; finding data starts at row index 2.
  const dataRows = aoa.slice(2).filter((r) => r && r.some((c) => c !== "" && c != null))
  const byCompany: Record<string, AuditAgg> = {}
  const unmapped = new Set<string>()
  for (const r of dataRows) {
    const severityRaw = String(r[1] ?? "").trim()
    const companyRaw = String(r[3] ?? "").trim()
    if (!severityRaw || !companyRaw) continue
    const code = mapAuditCompany(companyRaw)
    if (!code) {
      unmapped.add(companyRaw)
      continue
    }
    const bucket = severityBucket(severityRaw)
    const statusMng = String(r[6] ?? "").trim()
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
      audit: String(r[4] ?? "").trim(),
      status: statusMng,
      grouping: String(r[7] ?? "").trim(),
      findingStatusJan: String(r[9] ?? "").trim(),
    })
  }
  const warnings: string[] = []
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
