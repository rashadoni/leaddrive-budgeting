/**
 * AZMADE per-product sales adapter — parses the `S-all` sheet from
 * AAC's xlsx workbook into per-product monthly sales totals ready for
 * `SalesBudgetLine` insertion.
 *
 * --- S-all shape (observed in 2026 Budget - AAC.xlsx, 2026-04-24) ---
 *
 * Repeating per-product sections, each:
 *   Row N:   [_, <ProductName>, "Jan", "Feb", ..., "Dec", "CƏMİ:"]
 *   Row N+1..M: optional sub-type rows ("1-ci növ", "2-ci növ" — only MHB)
 *   Row K:   [_, "CƏMİ məbləğ:", <jan>, <feb>, ..., <dec>, <annual>]
 *
 * 6 products in current AAC workbook:
 *   - MHB (gas concrete blocks)
 *   - Əhəng yanmış (burnt lime)
 *   - Əhəng sönmüş (slaked lime)
 *   - Yapışqan (adhesive)
 *   - Əhəng tullantı (lime waste)
 *   - U-block
 *
 * Detection: a header row has "Jan" in col 3 (or wherever col 3 first has
 * a string starting with "Jan"). The product name lives in col 2.
 * The values come from the "CƏMİ məbləğ:" total row that follows. Detail
 * sub-type rows are skipped (we want only the per-product total — sub-types
 * are accounting-internal grades, not separate ProductLine rows).
 */

import type * as XLSX from "xlsx"
import { toNumberOrNull } from "./azmade-sopl"

export interface ParsedSalesProduct {
  /** Synthetic stable code derived from AZ name. */
  code: string
  /** Original AZ product name. */
  name: string
  /** Per-month amount, length 12, index 0=Jan ... 11=Dec. */
  perMonth: number[]
  /** Annual sum (rendered into the "CƏMİ məbləğ:" row in the source xlsx). */
  totalAnnual: number
}

export interface SalesParseWarning {
  row: number
  reason: string
}

export interface SalesParseResult {
  sheetName: string
  products: ParsedSalesProduct[]
  warnings: SalesParseWarning[]
}

// AZ → canonical code map. New products fall back to slugified label.
const NAME_TO_CODE: ReadonlyArray<{ pattern: RegExp; code: string }> = [
  { pattern: /^MHB/i, code: "MHB" },
  { pattern: /^Əhəng\s+yanmış/i, code: "LIME_BURNT" },
  { pattern: /^Əhəng\s+sönmüş/i, code: "LIME_SLAKED" },
  { pattern: /^Yapışqan/i, code: "ADHESIVE" },
  { pattern: /^Əhəng\s+tullantı/i, code: "LIME_WASTE" },
  { pattern: /^U.?block/i, code: "UBLOCK" },
]

function codeFromName(name: string): string {
  for (const m of NAME_TO_CODE) {
    if (m.pattern.test(name.trim())) return m.code
  }
  // Fallback: slugified UPPERCASE
  return name
    .trim()
    .toUpperCase()
    .replace(/[Əİ]/g, "I")
    .replace(/[Ş]/g, "S")
    .replace(/[Ç]/g, "C")
    .replace(/Ö/g, "O")
    .replace(/Ü/g, "U")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 30)
}

const TOTAL_ROW_PATTERN = /^CƏMİ\s+məbləğ/i
const HEADER_FIRST_MONTH_PATTERN = /^jan/i

export function parseAacSalesAllSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
): SalesParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return {
      sheetName,
      products: [],
      warnings: [{ row: 0, reason: `Sheet "${sheetName}" not found` }],
    }
  }
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false }) as unknown[][]

  const products: ParsedSalesProduct[] = []
  const warnings: SalesParseWarning[] = []
  const seenCodes = new Set<string>()

  // Walk rows: when we find a row where SOME column is "Jan" (case-insensitive),
  // treat as a product header. Product name = the column to the LEFT of "Jan".
  // The 12 monthly cols start at the "Jan" col. Then walk forward looking for
  // the "CƏMİ məbləğ:" total row; pull values from the same monthly cols.
  // Robust to differing leading-blank-col counts (xlsx vs openpyxl shape diffs).
  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    let janCol = -1
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      if (typeof v === "string" && HEADER_FIRST_MONTH_PATTERN.test(v.trim())) {
        janCol = c
        break
      }
    }
    if (janCol === -1) continue
    // Verify it's a real product header: cols janCol+1..janCol+11 should also
    // be string month names. (Otherwise a stray "Jan" cell could trip us.)
    if (janCol + 11 >= row.length) continue
    const allMonthsString = [
      "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ].every((expected, idx) => {
      const cell = row[janCol + 1 + idx]
      return typeof cell === "string" && cell.trim().toLowerCase().startsWith(expected.toLowerCase())
    })
    if (!allMonthsString) continue

    // Product name: leftmost non-empty string cell BEFORE janCol
    let productName = ""
    let productNameCol = -1
    for (let c = janCol - 1; c >= 0; c--) {
      const v = row[c]
      if (typeof v === "string" && v.trim().length > 0) {
        productName = v.trim()
        productNameCol = c
        break
      }
    }
    if (!productName) {
      warnings.push({ row: r + 1, reason: `Product header row has no name to the left of "Jan" col` })
      continue
    }

    // Look ahead up to 10 rows for the total row (CƏMİ məbləğ: in any col
    // up to janCol-1)
    let totalRowIdx = -1
    for (let k = r + 1; k < Math.min(r + 11, aoa.length); k++) {
      const candRow = aoa[k] ?? []
      for (let c = 0; c < janCol; c++) {
        const labelRaw = candRow[c]
        const label = typeof labelRaw === "string" ? labelRaw.trim() : ""
        if (TOTAL_ROW_PATTERN.test(label)) {
          totalRowIdx = k
          break
        }
      }
      if (totalRowIdx !== -1) break
    }
    if (totalRowIdx === -1) {
      warnings.push({ row: r + 1, reason: `No "CƏMİ məbləğ:" row found within 10 rows after product "${productName}"` })
      continue
    }

    const totalRow = aoa[totalRowIdx] ?? []
    const perMonth: number[] = []
    let totalAnnual = 0
    for (let m = 0; m < 12; m++) {
      const v = toNumberOrNull(totalRow[janCol + m])
      const num = v ?? 0
      perMonth.push(num)
      totalAnnual += num
    }
    if (totalAnnual === 0) continue
    void productNameCol // silence unused-var lint; kept for future use

    let code = codeFromName(productName)
    let suffix = 1
    while (seenCodes.has(code)) {
      suffix++
      code = `${codeFromName(productName)}_${suffix}`
    }
    seenCodes.add(code)

    products.push({ code, name: productName, perMonth, totalAnnual })

    // Skip past the total row to avoid re-processing
    r = totalRowIdx
  }

  return { sheetName, products, warnings }
}
