/**
 * AZMADE CFS (Cash Flow Statement / Pul axını Hesabatı) xlsx adapter.
 *
 * Parses the `CFS` sheet from each AZMADE budget workbook into entries
 * ready for `CashFlowEntry` insertion.
 *
 * --- CFS shape (observed across rev6/rev7/rev8/rev9, 2026-04-24) ---
 *
 * Same row layout as SOFP — anchor on the row containing all 12 month
 * names (Yanvar..Dekabr). Each data row carries a label + opening balance
 * + 12 monthly amounts.
 *
 * Crucial difference from SOFP: CFS rows split into **3 activity sections**:
 *
 *   - "Əsas Fəaliyyəti ilə..."  → activityType = "operating"
 *   - "Maliyyə Fəaliyyəti..."   → activityType = "financing"
 *   - "Investisiya Fəaliyyəti..." → activityType = "investing"
 *
 * Above the operating section sits an "opening balance" block (Pul və pul
 * vəsaiti / Bank hesabı / Kassa / ƏDV depozit) — NOT cash flow entries
 * but balance snapshots; we tag those with `category="opening_balance"`
 * and skip them in the inflow/outflow split (caller can ignore).
 *
 * inflow vs outflow inferred from sign:
 *   - amount > 0 → inflow
 *   - amount < 0 → outflow
 *   - amount === 0 → row skipped (no cash movement)
 *
 * Sub-section markers like "Cəmi Mədaxil" (total inflow) / "Cəmi Məxaric"
 * (total outflow) are skipped — they're derived totals.
 */

import type * as XLSX from "xlsx"
import {
  MONTH_ALIASES,
  findHeaderRow,
  toNumberOrNull,
  isPlanMonthHeader,
} from "./azmade-sopl"

export type CashFlowActivityType = "operating" | "investing" | "financing" | "opening_balance"
export type CashFlowEntryType = "inflow" | "outflow"

export interface ParsedCashFlowEntry {
  /** Synthetic stable code used by callers to dedupe across re-imports. */
  code: string
  label: string
  activityType: CashFlowActivityType
  /** Inferred from sign of amount. For opening_balance rows it's "inflow"
   *  by convention but caller should ignore those for entry creation. */
  entryType: CashFlowEntryType
  /** Per-month values, length 12, index 0=Jan ... 11=Dec. Always |value|
   *  (positive); sign is captured by `entryType`. */
  perMonth: number[]
}

export interface CfsParseWarning {
  row: number
  reason: string
}

export interface CfsParseResult {
  sheetName: string
  entries: ParsedCashFlowEntry[]
  warnings: CfsParseWarning[]
  skippedRowCount: number
}

// --- Section detection ----------------------------------------------------

const SECTION_PATTERNS: ReadonlyArray<{
  pattern: RegExp
  activityType: CashFlowActivityType
}> = [
  { pattern: /^Əsas\s+Fəaliyyət/i, activityType: "operating" },
  { pattern: /^Əməliyyat\s+Fəaliyyət/i, activityType: "operating" },
  { pattern: /^Maliyyə\s+Fəaliyyət/i, activityType: "financing" },
  { pattern: /^[İI]nvestisiya\s+Fəaliyyət/i, activityType: "investing" },
  // Opening balance section above the activity sections
  { pattern: /^Pul\s+və\s+pul\s+vəsaiti/i, activityType: "opening_balance" },
]

const SKIP_PATTERNS: ReadonlyArray<RegExp> = [
  /^Cəmi\s+(Mədaxil|Məxaric|Pul|Pul axını)/i, // totals
  /^"[^"]+"\s+(Direktor|Baş|Müdür|Müha)/i, // signatures
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

// --- Core parser ----------------------------------------------------------

export function parseCfsSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
): CfsParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return {
      sheetName,
      entries: [],
      warnings: [{ row: 0, reason: `Sheet "${sheetName}" not found` }],
      skippedRowCount: 0,
    }
  }
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false }) as unknown[][]

  const headerRowIdx = findHeaderRow(aoa)
  if (headerRowIdx === -1) {
    return {
      sheetName,
      entries: [],
      warnings: [{ row: 0, reason: "No header row with 12 month names found (Yanvar..Dekabr)" }],
      skippedRowCount: 0,
    }
  }

  const headerRow = aoa[headerRowIdx] ?? []
  const monthCols: number[] = []
  for (let m = 0; m < MONTH_ALIASES.length; m++) {
    const idx = headerRow.findIndex((v) => isPlanMonthHeader(v, m))
    if (idx === -1) {
      return {
        sheetName,
        entries: [],
        warnings: [{ row: headerRowIdx + 1, reason: `Month col for index ${m} not found` }],
        skippedRowCount: 0,
      }
    }
    monthCols.push(idx)
  }

  // Label column = leftmost non-empty text cell BEFORE monthCols[0]
  let labelCol = -1
  for (let c = 0; c < monthCols[0]; c++) {
    const v = headerRow[c]
    if (typeof v === "string" && v.trim().length > 0) {
      labelCol = c
      break
    }
  }
  if (labelCol === -1) labelCol = 0

  const entries: ParsedCashFlowEntry[] = []
  const warnings: CfsParseWarning[] = []
  let skippedRowCount = 0
  const seenCodes = new Set<string>()

  let activeSection: CashFlowActivityType = "opening_balance"

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
    // Section header? Update context, do NOT emit an entry.
    const sectionMatch = SECTION_PATTERNS.find((s) => s.pattern.test(label))
    if (sectionMatch) {
      activeSection = sectionMatch.activityType
      skippedRowCount++
      continue
    }

    // Extract 12 monthly values; preserve sign for entryType inference,
    // store |value| in perMonth.
    const perMonth: number[] = []
    let totalAbs = 0
    let netSign = 0 // sum of signs to determine inflow/outflow majority
    for (let m = 0; m < 12; m++) {
      const v = toNumberOrNull(row[monthCols[m]])
      const num = v ?? 0
      perMonth.push(Math.abs(num))
      totalAbs += Math.abs(num)
      if (num > 0) netSign += 1
      else if (num < 0) netSign -= 1
    }
    if (totalAbs === 0) {
      skippedRowCount++
      continue
    }

    // For opening_balance rows we don't actually emit — they're snapshots.
    if (activeSection === "opening_balance") {
      skippedRowCount++
      continue
    }

    const entryType: CashFlowEntryType = netSign >= 0 ? "inflow" : "outflow"

    let code = `CF-${slugify(label)}`
    let suffix = 1
    while (seenCodes.has(code)) {
      suffix++
      code = `CF-${slugify(label)}-${suffix}`
    }
    seenCodes.add(code)

    entries.push({ code, label, activityType: activeSection, entryType, perMonth })
  }

  return { sheetName, entries, warnings, skippedRowCount }
}
