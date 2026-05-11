/**
 * AZMADE SOFP (Statement of Financial Position) xlsx adapter.
 *
 * Parses the `SOFP` sheet from each AZMADE budget workbook into balance
 * sheet rows ready for `BalanceSheetLine` insertion.
 *
 * --- SOFP shape (observed across rev6/rev7/rev8/rev9, 2026-04-24) ---
 *
 * Two layouts encountered:
 *
 *   (A) LLS / SPARK layout (simpler):
 *       R7: [_, "Balans hesabatı", <opening_date>, "Yanvar", ..., "Dekabr"]
 *       R9+: [_, "<AZ label>", <opening_value>, <jan>, ..., <dec>]
 *
 *   (B) ZTP layout (Plan/LE columns inserted between opening and Yanvar):
 *       R3: [_, "Balans hesabatı", _, "31.12.2025 Plan", "31.12.2025 LE",
 *            "Fərq", "%", _, "Yanvar", ..., "İyun", ...]
 *       R5+: [_, "<AZ label>", _, <plan>, <le>, <fərq>, <%>, _, <jan>, ...]
 *
 * Strategy: anchor on the row containing all 12 month names (Yanvar..Dekabr)
 * — that's where months live, regardless of how many decoration columns
 * sit between label and Yanvar. Reuse `MONTH_ALIASES` + `findHeaderRow`
 * from `azmade-sopl.ts` for consistency.
 *
 * Account code: SOFP has NO KOD column — labels only. We generate a
 * synthetic stable code from the AZ label (`BS-<slug>`) so the same
 * line on subsequent imports lands on the same `BalanceSheetLine`.
 *
 * Line type classification (asset / liability / equity) — keyword match
 * against the label, falling back to section context (last seen
 * "Uzunmüddətli aktiv" / "Öhdəlik" / "Kapital" header steers subsequent
 * lines until next section). Empty rows / signature rows / total rows
 * (CƏMİ ÖHDƏLİKLƏR VƏ KAPİTAL / Kontrol) are silent-skipped.
 */

import type * as XLSX from "xlsx"
import {
  MONTH_ALIASES,
  findHeaderRow,
  toNumberOrNull,
  isPlanMonthHeader,
} from "./azmade-sopl"

export type BsLineType = "asset" | "liability" | "equity"
export type BsSubType =
  | "current_asset"
  | "fixed_asset"
  | "current_liability"
  | "long_term_liability"
  | "equity"
  | null

export interface ParsedBalanceSheetLine {
  /** Synthetic stable code (`BS-<slug>` derived from label). */
  code: string
  label: string
  lineType: BsLineType
  subType: BsSubType
  /** Per-month values, length 12, index 0=Jan ... 11=Dec. */
  perMonth: number[]
}

export interface SofpParseWarning {
  row: number
  reason: string
}

export interface SofpParseResult {
  sheetName: string
  lines: ParsedBalanceSheetLine[]
  warnings: SofpParseWarning[]
  skippedRowCount: number
}

// --- Section + line-type classification ----------------------------------

/** Section header patterns — set the active section context. Subsequent
 *  data lines inherit the lineType + subType until the next section. */
const SECTION_PATTERNS: ReadonlyArray<{
  pattern: RegExp
  lineType: BsLineType
  subType: BsSubType
}> = [
  { pattern: /^Uzunmüddətli\s+aktiv/i, lineType: "asset", subType: "fixed_asset" },
  { pattern: /^Qısamüddətli\s+aktiv/i, lineType: "asset", subType: "current_asset" },
  { pattern: /^Uzunmüddətli\s+öhdəlik/i, lineType: "liability", subType: "long_term_liability" },
  { pattern: /^Qısamüddətli\s+öhdəlik/i, lineType: "liability", subType: "current_liability" },
  { pattern: /^Kapital$/i, lineType: "equity", subType: "equity" },
  { pattern: /^Səhmdar\s+kapital/i, lineType: "equity", subType: "equity" },
]

/** Skip patterns — totals, control rows, signature rows. */
const SKIP_PATTERNS: ReadonlyArray<RegExp> = [
  /^CƏMİ/i, // CƏMİ AKTİVLƏR / CƏMİ ÖHDƏLİKLƏR VƏ KAPİTAL
  /^Kontrol\b/i,
  /^"[^"]+"\s+(Direktor|Baş|Müdür|Müha)/i, // signature lines
]

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[əiıöüç]/g, (c) => {
      const map: Record<string, string> = { "ə": "e", "i": "i", "ı": "i", "ö": "o", "ü": "u", "ç": "c" }
      return map[c] || c
    })
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
}

/** Per-label keyword classification — fallback when no section context.
 *  Order matters: most-specific (liability/equity) checked BEFORE assets,
 *  because labels like "Bank kredit borcu" have BOTH "bank" (asset hint)
 *  and "kredit"/"borc" (liability hint) — debts must win. */
function classifyByLabel(label: string): { lineType: BsLineType; subType: BsSubType } | null {
  // 1. Liabilities — debt keywords are unambiguous markers
  if (/(öhdəlik|borc|kredit|təchizatçı.*borc)/i.test(label)) {
    return { lineType: "liability", subType: "current_liability" }
  }
  // 2. Equity — capital / share / retained earnings
  if (/(kapital|səhm|mənfəət|ehtiyat)/i.test(label)) {
    return { lineType: "equity", subType: "equity" }
  }
  // 3. Fixed assets — long-lived productive assets
  if (/(əsas vəsait|amortizasi|qeyri.maddi|bioloji|kapitallaşdır|investisi|torpaq|tikili)/i.test(label)) {
    return { lineType: "asset", subType: "fixed_asset" }
  }
  // 4. Current assets — cash, receivables, inventory
  if (/(pul|bank|kassa|debitor|xammal|məhsul|inventar)/i.test(label)) {
    return { lineType: "asset", subType: "current_asset" }
  }
  return null
}

// --- Core parser ----------------------------------------------------------

export function parseSofpSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
): SofpParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return {
      sheetName,
      lines: [],
      warnings: [{ row: 0, reason: `Sheet "${sheetName}" not found` }],
      skippedRowCount: 0,
    }
  }
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false }) as unknown[][]

  const headerRowIdx = findHeaderRow(aoa)
  if (headerRowIdx === -1) {
    return {
      sheetName,
      lines: [],
      warnings: [{ row: 0, reason: "No header row with 12 month names found (Yanvar..Dekabr)" }],
      skippedRowCount: 0,
    }
  }

  const headerRow = aoa[headerRowIdx] ?? []
  // Find the column for each month — strict left-to-right plan-shape match.
  const monthCols: number[] = []
  for (let m = 0; m < MONTH_ALIASES.length; m++) {
    const idx = headerRow.findIndex((v) => isPlanMonthHeader(v, m))
    if (idx === -1) {
      return {
        sheetName,
        lines: [],
        warnings: [{ row: headerRowIdx + 1, reason: `Month col for index ${m} not found in header row` }],
        skippedRowCount: 0,
      }
    }
    monthCols.push(idx)
  }

  // Label column = leftmost non-empty text cell BEFORE monthCols[0] in the header row.
  let labelCol = -1
  for (let c = 0; c < monthCols[0]; c++) {
    const v = headerRow[c]
    if (typeof v === "string" && v.trim().length > 0) {
      labelCol = c
      break
    }
  }
  if (labelCol === -1) labelCol = 0

  const lines: ParsedBalanceSheetLine[] = []
  const warnings: SofpParseWarning[] = []
  let skippedRowCount = 0
  const seenCodes = new Set<string>()

  // Section context — updated as we walk rows. Default null until we hit
  // a section header.
  let activeSection: { lineType: BsLineType; subType: BsSubType } | null = null

  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const labelRaw = row[labelCol]
    const label = typeof labelRaw === "string" ? labelRaw.trim() : ""
    if (!label) {
      skippedRowCount++
      continue
    }
    if (SKIP_PATTERNS.some((p) => p.test(label))) {
      skippedRowCount++
      continue
    }
    // Section header? Update context, do NOT emit a line.
    const sectionMatch = SECTION_PATTERNS.find((s) => s.pattern.test(label))
    if (sectionMatch) {
      activeSection = { lineType: sectionMatch.lineType, subType: sectionMatch.subType }
      // BUT: in some layouts the section row ALSO carries values (rollup).
      // We still skip — those are derived totals, not source line items.
      skippedRowCount++
      continue
    }

    // Extract 12 monthly values
    const perMonth: number[] = []
    let allZero = true
    for (let m = 0; m < 12; m++) {
      const v = toNumberOrNull(row[monthCols[m]])
      const num = v ?? 0
      perMonth.push(num)
      if (num !== 0) allZero = false
    }
    if (allZero) {
      // All 12 months are 0 — likely a structural placeholder row. Skip.
      skippedRowCount++
      continue
    }

    // Classify lineType/subType: prefer section context, fall back to label.
    let lineType: BsLineType
    let subType: BsSubType
    if (activeSection) {
      lineType = activeSection.lineType
      subType = activeSection.subType
    } else {
      const labelClass = classifyByLabel(label)
      if (!labelClass) {
        warnings.push({ row: r + 1, reason: `Could not classify lineType for "${label}"` })
        skippedRowCount++
        continue
      }
      lineType = labelClass.lineType
      subType = labelClass.subType
    }

    // Synthetic code — must be unique within sheet.
    let code = `BS-${slugify(label)}`
    let suffix = 1
    while (seenCodes.has(code)) {
      suffix++
      code = `BS-${slugify(label)}-${suffix}`
    }
    seenCodes.add(code)

    lines.push({ code, label, lineType, subType, perMonth })
  }

  return { sheetName, lines, warnings, skippedRowCount }
}
