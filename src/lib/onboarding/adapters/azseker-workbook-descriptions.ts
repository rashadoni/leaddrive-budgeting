/**
 * Phase 7.M Tier 3 (2026-05-19) — parse "Təsvir" sheet from the AZSEKER
 * workbook (May 19 version of "Guvven Fin.xlsx") into per-entity strategic
 * descriptions that get persisted on `Company.settings.strategicDescription`.
 *
 * Sheet layout (per Azik's docx response to my "missing data" item B.4):
 *
 *   Row 2 (headers):  "Şirkət"        | "Təsvir"
 *   Row 3 (entity 1): "EDEN AGRO"     | <long description in Azerbaijani>
 *   Row 4 (advantage):                | <competitive advantage>
 *   Row 5: (blank separator)
 *   Row 6 (entity 2): "CPC"           | <description>
 *   Row 7 (advantage):                | <competitive advantage>
 *   ... possibly more entities (AZSF, MALT) in future revisions ...
 *
 * The parser is robust to:
 *   • Entities missing (Azik may not have filled them all yet)
 *   • Order changes (we map by `Şirkət` column value, not row index)
 *   • Extra rows / spacing
 *   • Per-entity having only 1 row (description only, no advantage)
 *
 * Entity-code resolution: Azik writes "EDEN AGRO", "CPC", "AZSF", "Malt"
 * etc. in human form; we map to canonical company codes.
 */

export interface WorkbookEntityDescription {
  /** Canonical AZSEKER-* company code. */
  companyCode: string
  /** Human-readable entity label as seen in xlsx (e.g. "EDEN AGRO"). */
  entityLabel: string
  /** First column-C cell — main strategic description text. */
  description: string
  /** Second column-C cell (if present) — competitive advantage / additional context. */
  competitiveAdvantage: string | null
  /** Concatenated full text for storage / search. */
  fullText: string
}

export interface WorkbookDescriptionsParseResult {
  descriptions: WorkbookEntityDescription[]
  warnings: string[]
  /** Row count actually examined (for diagnostics). */
  rowsExamined: number
}

/**
 * Map the human-readable entity label from the Təsvir sheet to a canonical
 * AZSEKER-* company code. Case-insensitive, transliteration-tolerant.
 */
export function resolveEntityCodeFromTesvirLabel(
  raw: string,
): string | null {
  const norm = raw.trim().toUpperCase()
  // Order matters — longer matches before shorter (so "EDEN AGRO" wins
  // over the substring "EDEN" if both appeared, etc.).
  if (norm.startsWith("EDEN")) return "AZSEKER-EDEN"
  if (norm === "CPC" || norm.includes("CPC")) return "AZSEKER-CPC"
  if (norm === "AZSF" || norm.includes("AZSF") || norm.includes("AZƏRŞƏKƏR"))
    return "AZSEKER-AZSF"
  if (norm.startsWith("MALT") || norm === "MALT") return "AZSEKER-MALT"
  if (norm.startsWith("PROMALT") || norm.includes("PROMALT"))
    return "AZSEKER-PROMALT"
  if (norm.startsWith("HORIZON") || norm.includes("HORIZON"))
    return "AZSEKER-HORIZON"
  return null
}

/**
 * Detect which columns hold (label, description) in the supplied AOA.
 * XLSX's `sheet_to_json(..., {header:1})` strips leading empty columns
 * when a sheet's data range starts at column B (or further right). So
 * the actual May 19 workbook puts the label at index 0 + description
 * at index 1, while a hypothetical re-export starting at A1 would put
 * label at index 1 + description at index 2. We auto-detect by scanning
 * the first ~10 rows and finding the column with the most known entity
 * labels.
 */
function detectColumns(aoa: unknown[][]): { labelCol: number; descCol: number } {
  let bestCol = 0
  let bestHits = -1
  // Examine columns 0..3; pick the one with most rows matching a known label.
  for (let col = 0; col < 4; col++) {
    let hits = 0
    for (let r = 0; r < Math.min(aoa.length, 15); r++) {
      const row = aoa[r]
      if (!row) continue
      const cell = row[col]
      if (typeof cell !== "string") continue
      if (resolveEntityCodeFromTesvirLabel(cell)) hits++
    }
    if (hits > bestHits) {
      bestHits = hits
      bestCol = col
    }
  }
  return { labelCol: bestCol, descCol: bestCol + 1 }
}

/**
 * Pure parser — takes an array-of-arrays representation of the Təsvir
 * sheet (typically from `XLSX.utils.sheet_to_json(sheet, {header:1})`)
 * and emits per-entity descriptions. Stateless / no I/O.
 *
 * The walk strategy is "anchor-based": find any row whose label column
 * is a known entity label (per `resolveEntityCodeFromTesvirLabel`), then
 * collect description from the next column, and (optionally) from the
 * NEXT row if its label column is blank — interpreting it as a
 * continuation (e.g. competitive advantage).
 */
export function parseTesvirSheetFromAoa(
  aoa: unknown[][],
): WorkbookDescriptionsParseResult {
  const descriptions: WorkbookEntityDescription[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  const { labelCol, descCol } = detectColumns(aoa)

  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r]
    if (!row) continue
    const labelCell = row[labelCol]
    if (typeof labelCell !== "string") continue
    const label = labelCell.trim()
    if (!label) continue
    const code = resolveEntityCodeFromTesvirLabel(label)
    if (!code) continue
    if (seen.has(code)) {
      warnings.push(`Duplicate Təsvir entry for ${code} at row ${r + 1}`)
      continue
    }
    seen.add(code)
    const desc = typeof row[descCol] === "string" ? row[descCol].trim() : ""
    // Look-ahead one row for continuation: blank label cell + non-blank desc cell.
    let advantage: string | null = null
    const nextRow = aoa[r + 1]
    if (nextRow) {
      const nextLabel =
        typeof nextRow[labelCol] === "string" ? nextRow[labelCol].trim() : ""
      const nextDesc =
        typeof nextRow[descCol] === "string" ? nextRow[descCol].trim() : ""
      if (!nextLabel && nextDesc) advantage = nextDesc
    }
    if (!desc) {
      warnings.push(`Empty description for ${code} at row ${r + 1}`)
      continue
    }
    const fullText = advantage ? `${desc}\n\n${advantage}` : desc
    descriptions.push({
      companyCode: code,
      entityLabel: label,
      description: desc,
      competitiveAdvantage: advantage,
      fullText,
    })
  }

  return { descriptions, warnings, rowsExamined: aoa.length }
}

/**
 * Convenience wrapper around `parseTesvirSheetFromAoa` that takes an
 * already-loaded xlsx workbook + sheet name. Caller is responsible for
 * passing in the XLSX module (avoids hard-coupling for tree-shake).
 */
export function parseTesvirSheet(
  workbook: { Sheets: Record<string, unknown>; SheetNames: string[] },
  sheetName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  XLSX: any,
): WorkbookDescriptionsParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return {
      descriptions: [],
      warnings: [`Sheet "${sheetName}" not found in workbook`],
      rowsExamined: 0,
    }
  }
  const aoa = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: true, // keep blanks so look-ahead works
  }) as unknown[][]
  return parseTesvirSheetFromAoa(aoa)
}
