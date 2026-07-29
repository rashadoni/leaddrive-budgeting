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
import { toNumberOrNull } from "./azmade-sopl"
import {
  resolveCostSigns,
  type CostSignDecision,
} from "../ai-import/cost-sign"
import {
  classifyCashFlowCode,
  selectLeafMostCashFlowBridgeCodes,
  type CashFlowStoredActivity,
} from "../cf-bridge"

export type PlfAccountType = "revenue" | "cogs" | "expense"
export type CfActivityType = CashFlowStoredActivity
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
  /** null means absent source evidence; numeric zero is explicit evidence. */
  perMonth: Array<number | null>
}

export interface PlfParseWarning {
  row: number
  reason: string
}

export interface PlfParseResult {
  sheetName: string
  lines: ParsedPlfLine[]
  warnings: PlfParseWarning[]
  /**
   * Phase 11.9b (2026-07-29) — which cost-sign convention the FILE was found
   * to use, and whether the values above were flipped as a result. Absent on
   * the early-return error paths, which parse nothing.
   *
   * This used to be an unconditional `-raw` on every cogs/expense cell. It is
   * correct for AZSEKER's own workbooks (costs stored negative), which is
   * exactly why it stayed invisible — a debit-convention file (SAP/1C export)
   * had every cost sign flipped, turning gross profit into revenue PLUS cost.
   */
  signConvention?: CostSignDecision
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
  if (section === "10") return null // computed Net Profit — skip
  if (/^0[3-9]$/.test(section)) return "expense"
  if (section === "12") return "expense" // PROVISIONS (Unused Vacations, Impairment, etc.)
  return null
}

/** Excel serial → {year, month0Based} or null. Wrapping `excelSerialToMonth`
 *  but keeping the year too — needed for multi-year-coverage sheets where
 *  picking the FIRST 12 dates gives the WRONG year (e.g. Workbook Fin has
 *  PL Malt = 2025-Jan..2026-Dec; first-12 picks 2025, but the user is
 *  loading the 2026 budget).
 */
function excelSerialToYearMonth(cell: unknown): { year: number; month: number } | null {
  let date: Date | null = null
  if (cell instanceof Date) date = cell
  else if (typeof cell === "number" && Number.isFinite(cell)) {
    if (cell < 44000 || cell > 48000) return null
    date = new Date((cell - 25569) * 86400 * 1000)
  }
  if (!date || isNaN(date.getTime())) return null
  const y = date.getUTCFullYear()
  if (y < 2020 || y > 2031) return null
  return { year: y, month: date.getUTCMonth() }
}

/** Find header row + month column positions.
 *
 *  Accepts optional `preferYear` — when present, only collect candidate
 *  date cells with that calendar year. When absent, pick the year with
 *  the largest count of distinct months (covers single-year sheets and
 *  multi-year where one year dominates).
 *
 *  Why this matters: the Workbook Fin xlsx has sheets that cover multiple
 *  years (e.g. PLF CPC spans 2022..2026). The original implementation
 *  picked the FIRST 12 valid date cells which always meant the earliest
 *  year — for a 2026 budget upload, that produced all-zero rows because
 *  2022 actuals weren't populated. Year-aware detection fixes this.
 */
export function findPlfHeaderRow(
  aoa: unknown[][],
  opts?: { preferYear?: number },
): { row: number; monthCols: number[]; year: number } | null {
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const row = aoa[i] ?? []
    const byYear = new Map<number, number[]>() // year → cols[12] (-1 default)
    for (let c = 0; c < row.length; c++) {
      const ym = excelSerialToYearMonth(row[c])
      if (!ym) continue
      let cols = byYear.get(ym.year)
      if (!cols) {
        cols = Array(12).fill(-1)
        byYear.set(ym.year, cols)
      }
      if (cols[ym.month] === -1) cols[ym.month] = c
    }
    if (byYear.size === 0) continue

    // Prefer requested year if it has all 12; else pick year with most months;
    // tie-break by latest year (the user is more likely loading next year's
    // budget than ancient history).
    let candidates = Array.from(byYear.entries())
      .map(([year, cols]) => ({ year, cols, filled: cols.filter((v) => v !== -1).length }))
      .filter((c) => c.filled === 12)
    // STRICT preferYear (Codex re-review 2026-06-20): when a target year is
    // requested, ONLY accept that year's full band — never fall back to another
    // year. Otherwise a 2026-only sheet rescued with preferYear=2025 would write
    // 2026 values into the 2025 plan (the `apply-multi` Workbook-fallback path).
    if (opts?.preferYear !== undefined) {
      candidates = candidates.filter((c) => c.year === opts.preferYear)
    }
    if (candidates.length === 0) continue
    candidates.sort((a, b) => {
      if (a.filled !== b.filled) return b.filled - a.filled
      return b.year - a.year
    })
    const pick = candidates[0]

    // Sanity: monotonic ascending col indices for Jan..Dec
    let mono = true
    for (let k = 1; k < 12; k++) if (pick.cols[k] <= pick.cols[k - 1]) { mono = false; break }
    if (mono) return { row: i, monthCols: pick.cols, year: pick.year }
  }
  return null
}

// Leaf items: numeric like PLF.05.01.01 OR letter-keyed like PLF.05.01.R (G&A rollup lines)
const LEAF_CODE_RE = /^(PLF|CF)\.\d{2}\.\d{2}\.([0-9]{1,2}|[A-Za-z]{1,2})$/

/** Parse PL_X or PLF_X sheet → ParsedPlfLine[] (only leaves).
 *
 *  Optional `preferYear` — for workbooks where one sheet covers multiple
 *  years (e.g. Workbook Fin's PLF CPC spans 2022..2026), this hint scopes
 *  the column lookup to the user's intended budget year.
 */
export function parsePlfPlSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  opts?: {
    preferYear?: number
    /**
     * Phase 11.36 (2026-07-29) — use THIS verdict instead of classifying the
     * sheet in isolation.
     *
     * `reporting-pack-detail.ts` splits one worksheet into a synthetic sheet
     * per `BU` and calls this parser once per entity. Each call therefore saw
     * only one entity's rows and could reach a DIFFERENT conclusion about the
     * same workbook — most sharply when a BU's costs are all zero, which
     * classifies as `no_evidence` and falls back to the default flip while a
     * sibling BU reads `positive_costs` and does not flip. One file, two
     * conventions, no signal.
     *
     * The convention is a property of the FILE, so the caller classifies once
     * over every row and passes the verdict down.
     */
    signOverride?: CostSignDecision
  },
): PlfParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return { sheetName, lines: [], warnings: [{ row: 0, reason: `Sheet "${sheetName}" not found` }] }
  }
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false }) as unknown[][]

  const header = findPlfHeaderRow(aoa, { preferYear: opts?.preferYear })
  if (!header) {
    return { sheetName, lines: [], warnings: [{ row: 0, reason: "No 12-month date header row found" }] }
  }
  const { row: headerRowIdx, monthCols } = header

  const lines: ParsedPlfLine[] = []
  // Phase 11.9b — raw per-row annuals feeding the cost-sign classifier.
  const cogsRawAnnuals: number[] = []
  const expenseRawAnnuals: number[] = []
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

    // Phase 11.9b (2026-07-29) — pass 1 keeps RAW values. The cogs/expense
    // sign convention is INFERRED from the file after this loop and applied
    // in pass 2, instead of being assumed here.
    //
    // The original note still holds for AZSEKER's own files: this source
    // stores cogs/expense NEGATIVE (additive convention: gross_margin =
    // revenue + cogs in the sheet), and negating — not abs() — is what makes
    // a provision reversal (positive in Excel) land as negative expense
    // rather than inflating the charge. What changed is that this is no
    // longer ASSUMED: a debit-convention file (SAP/1C export) would have had
    // every cost sign flipped, turning gross profit into revenue PLUS cost.
    // Revenue rows are never flipped (negative revenue = returns, which net
    // correctly).
    const perMonth: number[] = []
    let rawAnnual = 0
    let allZero = true
    for (let m = 0; m < 12; m++) {
      const raw = toNumberOrNull(row[monthCols[m]]) ?? 0
      perMonth.push(raw)
      rawAnnual += raw
      if (raw !== 0) allZero = false
    }
    if (allZero) continue

    if (accountType === "cogs") cogsRawAnnuals.push(rawAnnual)
    else if (accountType === "expense") expenseRawAnnuals.push(rawAnnual)

    lines.push({ code, label, accountType, perMonth, totalAnnual: rawAnnual })
  }

  // ── Pass 2: apply the INFERRED cost-sign convention ────────────────────
  // 11.36 — a caller that split this sheet out of a larger one classifies over
  // the WHOLE sheet and passes the verdict in; only a standalone sheet decides
  // for itself.
  const signDecision = opts?.signOverride ?? resolveCostSigns(cogsRawAnnuals, expenseRawAnnuals)
  for (const line of lines) {
    const flip =
      line.accountType === "cogs"
        ? signDecision.flipCogs
        : line.accountType === "expense"
          ? signDecision.flipExpense
          : false
    if (!flip) continue
    for (let m = 0; m < 12; m++) line.perMonth[m] = -line.perMonth[m]
    line.totalAnnual = -line.totalAnnual
  }
  // `warnings` is a row-level PROBLEM channel — callers treat an empty list as
  // "clean parse" — so the routine verdict travels on the result instead, and
  // only a genuinely blocking one is raised as a warning.
  if (signDecision.blockedReason) {
    warnings.push({ row: 0, reason: `BLOCKED: ${signDecision.blockedReason}` })
  }

  return { sheetName, lines, warnings, signConvention: signDecision }
}

/** Parse CF_X sheet → ParsedCfLine[] (only leaves).
 *  Same `preferYear` hint as `parsePlfPlSheet`.
 */
export function parsePlfCfSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  opts?: { preferYear?: number },
): CfParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return { sheetName, entries: [], warnings: [{ row: 0, reason: `Sheet "${sheetName}" not found` }] }
  }
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false }) as unknown[][]

  const header = findPlfHeaderRow(aoa, { preferYear: opts?.preferYear })
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
    const classification = classifyCashFlowCode(code)
    if (!classification) continue
    const isBridge = classification.activityType === "bridge"
    // Movement rows remain leaf-only to avoid importing computed subtotals.
    // Bridge rows are canonical statement evidence and can be top-level
    // (CF.04) or source-specific descendants (CF.04.01.01).
    if (!isBridge && !LEAF_CODE_RE.test(code)) continue
    const activityType = classification.activityType

    const labelRaw = row[1]
    const label = typeof labelRaw === "string" ? labelRaw.trim() : code

    // Default entryType for the LINE from its code segment (used downstream
    // only for the account-type classification, inflow→revenue/outflow→expense).
    // CF.XX.01.XX = inflow segment; CF.XX.02.XX = outflow segment.
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

    // 2026-06-02 fix: keep the SIGNED monthly value. A positive month inside
    // an outflow line (or negative inside an inflow line) is a refund /
    // reversal and must net correctly. The previous `Math.abs()` + one
    // entryType-per-line flipped those refunds into same-direction flows,
    // overstating MALT operating CF by 2× the refund (204K) and AZSF by 40K.
    // The handler derives the per-MONTH inflow/outflow direction from this
    // sign (see makeCfHandler).
    const perMonth: Array<number | null> = []
    let hasSourceEvidence = false
    let hasNonZeroMovement = false
    for (let m = 0; m < 12; m++) {
      const v = toNumberOrNull(row[monthCols[m]])
      perMonth.push(v)
      if (v !== null) hasSourceEvidence = true
      if (v !== null && v !== 0) hasNonZeroMovement = true
    }
    // For ordinary movements retain the established sparse behavior: a line
    // with no non-zero movement creates no rows. For bridge evidence, an
    // explicit numeric zero is meaningful and must not collapse into absence.
    if (isBridge ? !hasSourceEvidence : !hasNonZeroMovement) continue

    entries.push({ code, label, activityType, entryType, perMonth })
  }

  // Leaf-most selection is MONTH-SCOPED. A child evidenced in January must
  // suppress its ancestor only in January; a sparse parent value in February
  // remains valid evidence when the child is blank there.
  const selectedBridgeCodesByMonth = Array.from({ length: 12 }, (_, month) =>
    selectLeafMostCashFlowBridgeCodes(
      entries
        .filter(
          (entry) =>
            entry.activityType === "bridge" && entry.perMonth[month] !== null,
        )
        .map((entry) => entry.code),
    ),
  )
  const partiallySuppressedBridgeCodes = new Set<string>()
  const filteredEntries = entries
    .map((entry): ParsedCfLine => {
      if (entry.activityType !== "bridge") return entry
      const perMonth = entry.perMonth.map((value, month) => {
        if (
          value !== null &&
          !selectedBridgeCodesByMonth[month].has(entry.code)
        ) {
          partiallySuppressedBridgeCodes.add(entry.code)
          return null
        }
        return value
      })
      return { ...entry, perMonth }
    })
    .filter(
      (entry) =>
        entry.activityType !== "bridge" ||
        entry.perMonth.some((value) => value !== null),
    )
  for (const code of partiallySuppressedBridgeCodes) {
    warnings.push({
      row: 0,
      reason: `Bridge subtotal ${code} skipped only for periods with more specific descendant evidence`,
    })
  }

  return { sheetName, entries: filteredEntries, warnings }
}

/**
 * Extract the source's OWN EBITDA subtotal row (col-B label contains "EBITDA",
 * excluding margin/% variants) → monthly values for `preferYear`. The PLF
 * leaves lump D&A + interest + tax into one `expense` type, so deriving EBITDA
 * from them collapses it to NET (2026-05-31 audit); capturing the author's own
 * EBITDA subtotal as `pl_ebitda` operational_facts lets the recompute report it
 * correctly. Returns [] when no EBITDA row / year header exists (non-PLF or
 * cross-entity summary sheets).
 */
export function parsePlfEbitdaSubtotal(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  opts?: { preferYear?: number },
): { month: number; value: number }[] {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown[][]
  const header = findPlfHeaderRow(aoa, { preferYear: opts?.preferYear })
  if (!header) return []
  const { monthCols } = header
  const ebitdaRow = aoa.find((r) => {
    const label = String((r as unknown[])[1] ?? "").toUpperCase()
    return label.includes("EBITDA") && !label.includes("MARGIN") && !label.includes("%")
  })
  if (!ebitdaRow) return []
  const out: { month: number; value: number }[] = []
  for (let m = 0; m < 12; m++) {
    const v = (ebitdaRow as unknown[])[monthCols[m]]
    if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) > 0.005) {
      out.push({ month: m + 1, value: v })
    }
  }
  return out
}

/**
 * Like `parsePlfEbitdaSubtotal`, but extracts the EBITDA subtotal for EVERY year
 * present in the sheet — a single PLF header row carries each year's 12 month
 * columns side by side (Guvven Fin.xlsx spans 2022..2026). Returns one entry per
 * year that has at least one non-trivial EBITDA month, sorted ascending.
 *
 * Why the AI import needs this: the per-sheet import targets ONE `year`, so it
 * only ever captured that year's `pl_ebitda` — a workbook's prior-year EBITDA
 * subtotals were never loaded, and a re-import that target-year-scoped its delete
 * could silently drop a year whose parse came back empty. Capturing all years
 * (each gated per-year by the caller on having data) makes the EBITDA history
 * self-sufficient and re-import-safe.
 */
export function parsePlfEbitdaSubtotalAllYears(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
): { year: number; monthly: { month: number; value: number }[] }[] {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown[][]

  // Detect ALL fully-populated, monotonic year column-blocks from the header
  // band (mirrors findPlfHeaderRow's per-year detection, but keeps EVERY year
  // rather than picking one).
  let yearCols: Map<number, number[]> | null = null
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const row = aoa[i] ?? []
    const byYear = new Map<number, number[]>()
    for (let c = 0; c < row.length; c++) {
      const ym = excelSerialToYearMonth(row[c])
      if (!ym) continue
      let cols = byYear.get(ym.year)
      if (!cols) {
        cols = Array(12).fill(-1)
        byYear.set(ym.year, cols)
      }
      if (cols[ym.month] === -1) cols[ym.month] = c
    }
    const full = new Map<number, number[]>()
    for (const [year, cols] of byYear) {
      if (cols.filter((v) => v !== -1).length !== 12) continue
      let mono = true
      for (let k = 1; k < 12; k++) if (cols[k] <= cols[k - 1]) { mono = false; break }
      if (mono) full.set(year, cols)
    }
    if (full.size > 0) {
      yearCols = full
      break
    }
  }
  if (!yearCols) return []

  const ebitdaRow = aoa.find((r) => {
    const label = String((r as unknown[])[1] ?? "").toUpperCase()
    return label.includes("EBITDA") && !label.includes("MARGIN") && !label.includes("%")
  })
  if (!ebitdaRow) return []

  const out: { year: number; monthly: { month: number; value: number }[] }[] = []
  for (const [year, cols] of [...yearCols.entries()].sort((a, b) => a[0] - b[0])) {
    const monthly: { month: number; value: number }[] = []
    for (let m = 0; m < 12; m++) {
      const v = (ebitdaRow as unknown[])[cols[m]]
      if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) > 0.005) {
        monthly.push({ month: m + 1, value: v })
      }
    }
    if (monthly.length > 0) out.push({ year, monthly })
  }
  return out
}
