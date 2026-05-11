/**
 * Phase 7.G CXLV — Azərşəkər PLF/CF code-format xlsx adapter.
 *
 * Parses the PL_X / CF_X / PLF_X sheets from the Consolidated Azərşəkər
 * file (Consolidated budget 2026_AHMAD_NEW.xlsx — 5 entities: EDEN /
 * AZSF / HORIZON / Farm / CPC).
 *
 * --- Sheet shape (observed 2026-04-22) ---
 *
 *   R1: optional flag (e.g. "AFF")
 *   R2: header row — col B = "CASH FLOW STATEMENT" / etc, cols D..O = 12
 *       Excel date headers (2026-01-01 .. 2026-12-01), col Q = annual "2026"
 *   R3: blank
 *   R4+: data rows
 *     col A = PLF/CF code (e.g. "PLF.01", "PLF.01.01", "PLF.01.01.01")
 *     col B = English label
 *     col D..O = 12 monthly values
 *     col Q = annual total
 *
 * --- Code hierarchy (only LEAVES are imported, parents skipped) ---
 *
 *   PLF.XX        — top-level section (REVENUE / COGS / etc.)        SKIP
 *   PLF.XX.XX     — sub-section (Revenue from Products Sold)         SKIP
 *   PLF.XX.XX.XX  — leaf line item (Revenue from Sale of Wheat)      INSERT
 *
 * Parent rows have aggregate values (sum of children) — including them
 * causes ~3× double-counting. Leaf detection: dot-count === 3 (4 segments).
 *
 * --- Account type from PLF prefix ---
 *
 *   PLF.01.*  → revenue
 *   PLF.02.*  → cogs
 *   PLF.03.*  → expense (sales & marketing)
 *   PLF.04.*  → expense (admin)
 *   PLF.05.*  → expense (other operating + depreciation/amortization)
 *   PLF.06.*  → expense (subsidies / income — neg expense)
 *   PLF.07.*  → expense (other income)
 *   PLF.08.*  → expense (interest)
 *   PLF.09.*  → expense (tax)
 *   PLF.10    → SKIP (computed Net Profit)
 *
 * --- CF code prefix (for cash_flow_entries imports) ---
 *
 *   CF.01.* → operating activity
 *   CF.02.* → investing activity
 *   CF.03.* → financing activity
 *
 *   CF.XX.01.XX = INFLOW (positive amounts)
 *   CF.XX.02.XX = OUTFLOW (negative amounts)
 */

import type * as XLSX from "xlsx"
import { excelSerialToMonth, toNumberOrNull } from "./azmade-sopl"

export type PlfAccountType = "revenue" | "cogs" | "expense"
export type CfActivityType = "operating" | "investing" | "financing"
export type CfEntryType = "inflow" | "outflow"

export interface ParsedPlfLine {
  code: string
  label: string
  accountType: PlfAccountType
  perMonth: number[]
  totalAnnual: number
}

export interface ParsedCfLine {
  code: string
  label: string
  activityType: CfActivityType
  entryType: CfEntryType
  perMonth: number[]
}

export interface PlfParseWarning {
  row: number
  reason: string
}

export interface PlfParseResult {
  sheetName: string
  lines: ParsedPlfLine[]
  warnings: PlfParseWarning[]
}

export interface CfParseResult {
  sheetName: string
  entries: ParsedCfLine[]
  warnings: PlfParseWarning[]
}

// PLF prefix → accountType map
function plfAccountType(code: string): PlfAccountType | null {
  const m = code.trim().match(/^PLF\.(\d{2})/)
  if (!m) return null
  const section = m[1]
  if (section === "01") return "revenue"
  if (section === "02") return "cogs"
  if (section === "10") return null // skip computed Net Profit
  if (/^0[3-9]$/.test(section)) return "expense"
  return null
}

// CF prefix → activityType
function cfActivityType(code: string): CfActivityType | null {
  const m = code.trim().match(/^CF\.(\d{2})/)
  if (!m) return null
  const section = m[1]
  if (section === "01") return "operating"
  if (section === "02") return "investing"
  if (section === "03") return "financing"
  return null
}

// Find header row + month column positions by scanning for 12 consecutive
// Date-typed cells (or Excel serial numbers in 2025-2027 range).
export function findPlfHeaderRow(aoa: unknown[][]): { row: number; monthCols: number[] } | null {
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const row = aoa[i] ?? []
    const candidates: Array<{ col: number; month: number }> = []
    for (let c = 0; c < row.length; c++) {
      const m = excelSerialToMonth(row[c])
      if (m === null) continue
      candidates.push({ col: c, month: m })
    }
    if (candidates.length < 12) continue
    // Pick first 12 in monotonic-month order to ensure Jan..Dec sequence
    const cols: number[] = Array(12).fill(-1)
    for (const cand of candidates) {
      if (cols[cand.month] === -1) cols[cand.month] = cand.col
    }
    if (cols.every((v) => v !== -1)) {
      // Sanity: monotonic
      let mono = true
      for (let k = 1; k < 12; k++) if (cols[k] <= cols[k - 1]) { mono = false; break }
      if (mono) return { row: i, monthCols: cols }
    }
  }
  return null
}

const LEAF_CODE_RE = /^(PLF|CF)\.\d{2}\.\d{2}\.\d{1,2}$/

/** Parse PL_X or PLF_X sheet → ParsedPlfLine[] (only leaves). */
export function parsePlfPlSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
): PlfParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return { sheetName, lines: [], warnings: [{ row: 0, reason: `Sheet "${sheetName}" not found` }] }
  }
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false }) as unknown[][]

  const header = findPlfHeaderRow(aoa)
  if (!header) {
    return { sheetName, lines: [], warnings: [{ row: 0, reason: "No 12-month date header row found" }] }
  }
  const { row: headerRowIdx, monthCols } = header

  const lines: ParsedPlfLine[] = []
  const warnings: PlfParseWarning[] = []

  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const codeRaw = row[0]
    const code = typeof codeRaw === "string" ? codeRaw.trim() : ""
    if (!code) continue
    if (!LEAF_CODE_RE.test(code)) continue // only leaves
    const accountType = plfAccountType(code)
    if (!accountType) continue

    const labelRaw = row[1]
    const label = typeof labelRaw === "string" ? labelRaw.trim() : code

    const perMonth: number[] = []
    let totalAnnual = 0
    let allZero = true
    // CXLIX sign normalization: source xlsx stores cogs/expense as NEGATIVE
    // (additive convention: gross_margin = revenue + cogs in the sheet).
    // The risk resolver expects positive magnitudes (formula:
    // gross_profit = revenue - cogs). Take ABS for cogs/expense to bridge.
    // Revenue rows kept as-is (negative revenue = legitimate returns/discounts
    // that net out correctly in the sum).
    const normalizeSign = accountType === "cogs" || accountType === "expense"
    for (let m = 0; m < 12; m++) {
      const v = toNumberOrNull(row[monthCols[m]])
      const raw = v ?? 0
      const num = normalizeSign ? Math.abs(raw) : raw
      perMonth.push(num)
      totalAnnual += num
      if (num !== 0) allZero = false
    }
    if (allZero) continue

    lines.push({ code, label, accountType, perMonth, totalAnnual })
  }

  return { sheetName, lines, warnings }
}

/** Parse CF_X sheet → ParsedCfLine[] (only leaves). */
export function parsePlfCfSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
): CfParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return { sheetName, entries: [], warnings: [{ row: 0, reason: `Sheet "${sheetName}" not found` }] }
  }
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false }) as unknown[][]

  const header = findPlfHeaderRow(aoa)
  if (!header) {
    return { sheetName, entries: [], warnings: [{ row: 0, reason: "No 12-month date header row found" }] }
  }
  const { row: headerRowIdx, monthCols } = header

  const entries: ParsedCfLine[] = []
  const warnings: PlfParseWarning[] = []

  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const codeRaw = row[0]
    const code = typeof codeRaw === "string" ? codeRaw.trim() : ""
    if (!code) continue
    if (!LEAF_CODE_RE.test(code)) continue
    const activityType = cfActivityType(code)
    if (!activityType) continue

    const labelRaw = row[1]
    const label = typeof labelRaw === "string" ? labelRaw.trim() : code

    // Determine inflow vs outflow from sign of values + code segment
    // CF.XX.01.XX = inflow segment (CF.01.01.XX = inflow from operations)
    // CF.XX.02.XX = outflow segment (CF.01.02.XX = outflow from operations)
    const segMatch = code.match(/^CF\.\d{2}\.(\d{2})\./)
    const segment = segMatch ? segMatch[1] : null
    let entryType: CfEntryType
    if (segment === "01") entryType = "inflow"
    else if (segment === "02") entryType = "outflow"
    else {
      // Fallback: derive from sum of values
      let sum = 0
      for (let m = 0; m < 12; m++) {
        const v = toNumberOrNull(row[monthCols[m]])
        sum += v ?? 0
      }
      entryType = sum >= 0 ? "inflow" : "outflow"
    }

    const perMonth: number[] = []
    let allZero = true
    for (let m = 0; m < 12; m++) {
      const v = toNumberOrNull(row[monthCols[m]])
      const num = Math.abs(v ?? 0)
      perMonth.push(num)
      if (num !== 0) allZero = false
    }
    if (allZero) continue

    entries.push({ code, label, activityType, entryType, perMonth })
  }

  return { sheetName, entries, warnings }
}
