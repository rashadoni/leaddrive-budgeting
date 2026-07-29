/**
 * Phase 11.31 (2026-07-29) — the one numeric cell parser.
 *
 * The defect this replaces
 * ───────────────────────
 * The import tree grew ~8 independent string→number parsers with two
 * IRRECONCILABLE comma conventions, and two of them are fallbacks for each
 * other inside a single handler:
 *
 *   azseker-workbook-bs.ts   `replace(/[,\s]/g,"")`  → comma is a THOUSANDS sep
 *   dynamic-bs-adapter.ts    `replace(",",".")`      → comma is a DECIMAL sep
 *
 * `production-adapter-handlers-financial.ts` calls the first and falls through
 * to the second when it yields zero rows. So `"1,5"` lands as **15** on one
 * path and **1.5** on the other — a 10× error in a balance sheet, with no
 * warning either way.
 *
 * A third (`azmade-sopl.ts`) replaces EVERY comma with a dot, so the perfectly
 * ordinary `"1,234,56"` becomes `1.234.56` → NaN, and `applier.ts` then
 * coerces that NaN to a silent **zero** rather than dropping the row.
 *
 * What this does instead
 * ──────────────────────
 * Decides the separator from the string's STRUCTURE rather than from a
 * per-file assumption, and — where the structure genuinely cannot settle it —
 * says so instead of guessing. `"1,5"` is the one shape that is truly
 * ambiguous; every other real-world shape resolves.
 *
 * Deliberately NOT a locale setting: these workbooks mix conventions between
 * sheets (and sometimes within one), so a per-import locale would be wrong
 * about half the file.
 */

export interface NumericCell {
  /** Parsed value, or null when the cell holds no usable number. */
  value: number | null
  /**
   * True when the separator could not be settled from structure and a
   * convention had to be assumed. The caller should surface it — this is
   * exactly the `"1,5"` = 15-or-1.5 case that silently produced a 10× error.
   */
  ambiguous: boolean
  /** Present when `value` is null or `ambiguous` is true. */
  reason?: string
}

/** Currency symbols, unit suffixes and every space Excel emits (incl. NBSP
 *  and narrow NBSP, which xlsx uses for grouping in several locales). */
const NOISE = /[\s   ₼$€£₽]/g

function ok(value: number): NumericCell {
  return { value, ambiguous: false }
}

/**
 * Parse one spreadsheet cell into a number.
 *
 * Handles: native numbers, thousands grouping (`1,234` / `1 234` / `1.234`),
 * both decimal conventions, accounting negatives `(1 234)`, trailing minus
 * `1234-`, currency symbols, and Excel's non-breaking spaces.
 *
 * An empty cell is `null` with no complaint — absent is not invalid. A cell
 * that holds text is `null` WITH a reason, so the caller can report a row it
 * dropped rather than silently coercing it to zero.
 */
export function parseNumericCell(cell: unknown): NumericCell {
  if (cell === null || cell === undefined) return { value: null, ambiguous: false }
  if (typeof cell === "number") {
    return Number.isFinite(cell)
      ? ok(cell)
      : { value: null, ambiguous: false, reason: "non-finite number" }
  }
  // A Date is never an amount. Excel serials arrive as numbers and are handled
  // above; a real Date here means the column was misidentified.
  if (cell instanceof Date) {
    return { value: null, ambiguous: false, reason: "cell is a date, not an amount" }
  }
  if (typeof cell !== "string") {
    return { value: null, ambiguous: false, reason: `unsupported cell type ${typeof cell}` }
  }

  let s = cell.trim()
  if (s === "") return { value: null, ambiguous: false }

  // Accounting negative: (1 234.56) — must be detected before noise-stripping
  // so the parentheses are still adjacent to the digits.
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1).trim()
  }

  s = s.replace(NOISE, "")

  // Leading or trailing sign. Trailing minus is common in ERP exports.
  if (s.endsWith("-")) {
    negative = !negative
    s = s.slice(0, -1)
  }
  if (s.startsWith("-")) {
    negative = !negative
    s = s.slice(1)
  } else if (s.startsWith("+")) {
    s = s.slice(1)
  }

  if (s === "") return { value: null, ambiguous: false, reason: "no digits" }
  if (!/^[\d.,]+$/.test(s)) {
    return { value: null, ambiguous: false, reason: `not numeric: "${cell}"` }
  }

  const dots = (s.match(/\./g) ?? []).length
  const commas = (s.match(/,/g) ?? []).length

  const finish = (normalized: string, ambiguous = false, reason?: string): NumericCell => {
    const n = Number(normalized)
    if (!Number.isFinite(n)) {
      return { value: null, ambiguous: false, reason: `not numeric: "${cell}"` }
    }
    const v = negative ? -n : n
    return ambiguous ? { value: v, ambiguous: true, reason } : ok(v)
  }

  // Both separators present → the RIGHTMOST one is the decimal point.
  // "1.234,56" (European) and "1,234.56" (Anglo) both resolve here.
  if (dots > 0 && commas > 0) {
    return s.lastIndexOf(",") > s.lastIndexOf(".")
      ? finish(s.replace(/\./g, "").replace(",", "."))
      : finish(s.replace(/,/g, ""))
  }

  const only = dots > 0 ? "." : commas > 0 ? "," : null
  if (only === null) return finish(s)

  const count = dots + commas
  const parts = s.split(only)
  const tail = parts[parts.length - 1]

  // More than one occurrence can only be grouping — "1,234,567".
  if (count > 1) return finish(s.split(only).join(""))

  // A single separator. The group after it decides:
  //   - exactly 3 digits AND digits before it → grouping ("1,234")
  //   - anything else → decimal ("1,5" / "12,45" / "0,12345")
  // The 3-digit case is the genuinely ambiguous one: "1,234" is 1234 under
  // grouping and 1.234 under the decimal reading. Grouping is the far more
  // common intent in these workbooks, so that is what we return — but we
  // flag it, because guessing silently is precisely what produced the 10×
  // balance-sheet error.
  if (tail.length === 3 && parts[0] !== "") {
    return finish(
      s.replace(only, ""),
      true,
      `"${cell}" — a single ${only === "," ? "comma" : "dot"} before exactly 3 digits ` +
        `is either thousands grouping (${s.replace(only, "")}) or a decimal ` +
        `(${parts[0]}.${tail}); read as grouping`,
    )
  }

  return finish(only === "," ? s.replace(",", ".") : s)
}

/** Convenience for call sites that only need the number. Returns null on
 *  anything unparseable — never 0, so a failed parse cannot masquerade as a
 *  real zero. */
export function numericCellValue(cell: unknown): number | null {
  return parseNumericCell(cell).value
}
