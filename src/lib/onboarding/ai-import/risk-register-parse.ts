/**
 * Enterprise risk-register / KRI parser ("Top risk - <entity>.xlsx").
 *
 * Shape: a flat KRI taxonomy — Level 1 | Level 2 | Level 3 | KRI | Criticality |
 * description | note (header row, then one risk per row). Columns are located by
 * header text so a column shift doesn't break it.
 *
 * NOTE: greenfield — no indicator consumes this yet, so the handler only lands
 * the register in Company.settings.riskRegister (a drill-down surface, like
 * courtDisputes / auditFindings) and writes NO OperationalFacts. A dedicated KRI
 * indicator can read it later. Pure: no DB, no LLM.
 */
import type * as XLSXType from "xlsx"

export interface RiskEntry {
  level1: string
  level2: string
  level3: string
  kri: string
  criticality: number | null
  description: string
  note: string
}
export interface RiskParseResult {
  risks: RiskEntry[]
  byCriticality: Record<string, number>
  warnings: string[]
}

export function parseRiskRegister(
  workbook: XLSXType.WorkBook,
  sheetName: string,
  XLSX: typeof XLSXType,
): RiskParseResult {
  const ws = workbook.Sheets[sheetName]
  if (!ws) return { risks: [], byCriticality: {}, warnings: [`Sheet "${sheetName}" not found`] }
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as unknown[][]
  const header = (aoa[0] ?? []).map((c) => String(c ?? "").toLowerCase().trim())
  const col = (re: RegExp, dflt: number) => {
    const i = header.findIndex((h) => re.test(h))
    return i >= 0 ? i : dflt
  }
  const cL1 = col(/level\s*1|risk category/, 0)
  const cL2 = col(/level\s*2/, 1)
  const cL3 = col(/level\s*3/, 2)
  const cKri = col(/\bkri\b|key risk|indicator/, 3)
  const cCrit = col(/critical/, 4)
  const cDesc = col(/description|təsvir/, 5)
  const cNote = col(/note|qeyd/, 6)

  const risks: RiskEntry[] = []
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const level1 = String(row[cL1] ?? "").trim()
    const level3 = String(row[cL3] ?? "").trim()
    const kri = String(row[cKri] ?? "").trim()
    if (!level1 && !level3 && !kri) continue // wholly empty row
    const critRaw = row[cCrit]
    let criticality: number | null = null
    if (typeof critRaw === "number" && isFinite(critRaw)) criticality = critRaw
    else {
      const n = parseInt(String(critRaw ?? "").trim(), 10)
      criticality = Number.isFinite(n) ? n : null
    }
    risks.push({
      level1,
      level2: String(row[cL2] ?? "").trim(),
      level3,
      kri,
      criticality,
      description: String(row[cDesc] ?? "").trim(),
      note: String(row[cNote] ?? "").trim(),
    })
  }

  const byCriticality: Record<string, number> = {}
  for (const r of risks) {
    if (r.criticality != null) {
      const k = String(r.criticality)
      byCriticality[k] = (byCriticality[k] ?? 0) + 1
    }
  }
  const warnings: string[] = []
  if (risks.length === 0) warnings.push(`No risk rows parsed on "${sheetName}"`)
  return { risks, byCriticality, warnings }
}
