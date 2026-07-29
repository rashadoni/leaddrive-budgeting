/**
 * AzerSheker × Workbook Balance Sheet adapter.
 *
 * BS sheets ("BS Malt" / "BS CPC" / "BS AZSF" / "BS EDEN") shape:
 *   - R1: 12+ monthly date headers starting at col D (or C — varies).
 *     Multi-year coverage is normal: BS CPC spans 2020-01..2026-04
 *     (76 cols), BS EDEN spans 2024-12..2026-04, BS Malt 2025-01..
 *     2026-03. For a 2026 import we read only the 2026 columns.
 *   - R2+: data rows. Col A = "BS.XX.XX.XX" code, col B = label,
 *     cols C..+ = monthly snapshot values. Snapshots are point-in-
 *     time end-of-month positions (not aggregates), so partial-
 *     year coverage is fine — only months with data get written.
 *
 * Code → lineType / subType convention (lifted from
 * `classifyWorkbookCode` + Workbook CoA hierarchy):
 *   BS.01.*    → asset
 *     BS.01.01.* → non-current asset (subType: "non_current")
 *     BS.01.02.* → current asset     (subType: "current")
 *   BS.02.*    → equity
 *   BS.03.*    → liability
 *     BS.03.01.* → long-term liability (subType: "long_term")
 *     BS.03.02.* → short-term liability (subType: "short_term")
 *
 * Output `ParsedBsLine`s feed `BalanceSheetLine.createMany`. Each
 * leaf × month becomes one DB row (idempotent: caller does delete-
 * then-insert per (planId × accountCode × year × month) to make
 * re-applies safe).
 *
 * Why a deterministic adapter (not AI Mapper): same reasoning as
 * `parsePlfPlSheet` — Workbook coding is fully knowable from the
 * file shape; LLM cost adds nothing.
 */
import type * as XLSX from "xlsx"
import { numericCellValue } from "../numeric-cell"

export type BsLineType = "asset" | "liability" | "equity"
export type BsSubType =
  | "non_current"
  | "current"
  | "long_term"
  | "short_term"
  | null

export interface ParsedBsLine {
  code: string // BS.XX.XX.XX
  label: string
  lineType: BsLineType
  subType: BsSubType
  /** Sparse map { "2026-01": 12345.67, "2026-02": 12500.0, ... } */
  monthlyAmounts: Record<string, number>
}

export interface BsParseWarning {
  row: number
  reason: string
}

export interface BsParseResult {
  sheetName: string
  lines: ParsedBsLine[]
  warnings: BsParseWarning[]
  year: number | null
}

const LEAF_BS_RE = /^BS\.\d{2}\.\d{2}\.\d{1,2}$/

function classifyBsLineType(code: string): {
  lineType: BsLineType | null
  subType: BsSubType
} {
  const m = code.match(/^BS\.(\d{2})\.(\d{2})/)
  if (!m) return { lineType: null, subType: null }
  const top = m[1]
  const sub = m[2]
  if (top === "01") {
    // Asset family
    if (sub === "01") return { lineType: "asset", subType: "non_current" }
    if (sub === "02") return { lineType: "asset", subType: "current" }
    return { lineType: "asset", subType: null }
  }
  if (top === "02") return { lineType: "equity", subType: null }
  if (top === "03") {
    if (sub === "01") return { lineType: "liability", subType: "long_term" }
    if (sub === "02") return { lineType: "liability", subType: "short_term" }
    return { lineType: "liability", subType: null }
  }
  return { lineType: null, subType: null }
}

function excelSerialToDate(cell: unknown): Date | null {
  if (cell instanceof Date) return cell
  if (typeof cell !== "number" || !Number.isFinite(cell)) return null
  if (cell < 44000 || cell > 48000) return null
  const d = new Date((cell - 25569) * 86400 * 1000)
  if (isNaN(d.getTime())) return null
  return d
}

/**
 * Phase 11.31 (2026-07-29) — delegate to the canonical parser.
 *
 * This used to strip commas outright (`replace(/[,\s]/g,"")`), i.e. treat a
 * comma as a THOUSANDS separator, while `dynamic-bs-adapter.ts` — which this
 * very handler falls through to when this parser yields zero rows — replaced
 * the first comma with a dot, i.e. treated it as a DECIMAL separator. `"1,5"`
 * therefore landed as 15 here and 1.5 there: a 10x error in a balance sheet,
 * with no warning on either path.
 */
function toNumber(cell: unknown): number | null {
  return numericCellValue(cell)
}

interface BsLayout {
  headerRow: number
  /** Map of "YYYY-MM" period → column index. Sparse (only months
   *  for the target year). Empty if no target-year columns found. */
  monthColsForYear: Record<string, number>
  year: number
}

/**
 * Locate the BS header row + the 2026 (or any `preferYear`) monthly
 * date column indices. Unlike PL/CF, BS sheets need a SPARSE map —
 * the target year may have only a few months populated (e.g. Malt
 * has only 2026-01..03; CPC has only 2026-01..04). Each present
 * month is written; missing months produce no row.
 */
function findBsLayout(
  aoa: unknown[][],
  preferYear: number,
): BsLayout | null {
  for (let i = 0; i < Math.min(aoa.length, 5); i++) {
    const row = aoa[i] ?? []
    const monthCols: Record<string, number> = {}
    for (let c = 0; c < row.length; c++) {
      const d = excelSerialToDate(row[c])
      if (!d) continue
      const y = d.getUTCFullYear()
      if (y !== preferYear) continue
      const m = d.getUTCMonth()
      const key = `${y}-${String(m + 1).padStart(2, "0")}`
      if (monthCols[key] === undefined) {
        monthCols[key] = c
      }
    }
    if (Object.keys(monthCols).length > 0) {
      return { headerRow: i, monthColsForYear: monthCols, year: preferYear }
    }
  }
  return null
}

/**
 * Parse a "BS X" sheet for the target year. Returns
 * `ParsedBsLine[]` — one entry per leaf code that has at least one
 * non-zero monthly amount.
 */
export function parseWorkbookBsSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  opts: { preferYear: number },
): BsParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return {
      sheetName,
      lines: [],
      warnings: [{ row: 0, reason: `Sheet "${sheetName}" not found in workbook` }],
      year: null,
    }
  }
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown[][]

  const layout = findBsLayout(aoa, opts.preferYear)
  if (!layout) {
    return {
      sheetName,
      lines: [],
      warnings: [
        {
          row: 0,
          reason: `No ${opts.preferYear} monthly date columns found in header rows 1..5`,
        },
      ],
      year: null,
    }
  }

  const lines: ParsedBsLine[] = []
  const warnings: BsParseWarning[] = []
  const monthKeys = Object.keys(layout.monthColsForYear).sort()

  for (let r = layout.headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const codeRaw = row[0]
    const code = typeof codeRaw === "string" ? codeRaw.trim() : ""
    if (!LEAF_BS_RE.test(code)) continue
    const { lineType, subType } = classifyBsLineType(code)
    if (!lineType) {
      warnings.push({
        row: r + 1,
        reason: `Unknown BS code prefix: ${code}`,
      })
      continue
    }
    const labelRaw = row[1]
    const label = typeof labelRaw === "string" ? labelRaw.trim() : code
    const monthlyAmounts: Record<string, number> = {}
    let nonZero = false
    for (const key of monthKeys) {
      const col = layout.monthColsForYear[key]
      const v = toNumber(row[col])
      if (v === null) continue
      monthlyAmounts[key] = v
      if (v !== 0) nonZero = true
    }
    // Keep leaves even when current-year is all-zero — they're still
    // legitimate accounts. Caller can decide whether to skip via the
    // dispatcher. Empty-month map means no data at all for the year:
    if (Object.keys(monthlyAmounts).length === 0) continue
    if (!nonZero) continue // skip all-zero leaves for noise reduction
    lines.push({ code, label, lineType, subType, monthlyAmounts })
  }

  return { sheetName, lines, warnings, year: layout.year }
}
