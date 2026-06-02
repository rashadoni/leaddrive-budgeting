/**
 * Phase 7.M Tier 4 (2026-05-19) — AI Import: Sheet meta extractor.
 *
 * Pure stateless function that walks a loaded XLSX workbook and produces
 * compact metadata for each sheet — enough for an LLM classifier to
 * decide WHAT KIND of data is in the sheet (P&L / BS / CF / KPI / CAPEX /
 * Land registry / Sales / Strategic descriptions / Unknown) without
 * sending the full multi-megabyte workbook content.
 *
 * Output is designed to be:
 *   • Compact — at most ~2KB per sheet, hard-capped via sampleRows
 *   • Information-rich — header row + first/last data rows + cell type
 *     histogram so the LLM can see "this column is dates", "this is
 *     account codes", etc.
 *   • LLM-friendly — flat JSON-serialisable shape, no nested generics
 *
 * Reuses no LLM. Tested in isolation. Output feeds `sheet-classifier.ts`.
 */

export interface SheetMeta {
  /** Sheet name as it appears in the xlsx (e.g. "PLF CPC", "Farming KPI"). */
  sheetName: string
  /** A1:Z123 range string from xlsx `!ref`. Null if sheet is empty. */
  range: string | null
  /** Total row count (including blanks within !ref). */
  totalRows: number
  /** Total column count (visible — i.e. max column index in any row + 1). */
  totalColumns: number
  /** Heuristic: which row most likely contains column headers (0-indexed). */
  headerRowIndex: number | null
  /** The header row values (first 20 columns), as strings. */
  headers: string[]
  /** Sample data rows — up to `sampleRows` rows, each first 20 cols, stringified. */
  sample: string[][]
  /** Per-column cell-type histogram, computed from first 100 data rows. */
  columnProfiles: ColumnProfile[]
  /** Is the sheet a section-separator? (e.g. ">>>" markers like "Actual >>>") */
  isSectionSeparator: boolean
  /**
   * Which workbook section this sheet falls under, derived from the nearest
   * preceding separator (e.g. sheets after "Actual >>>" → "actual", after
   * "KPI >>>" → "kpi"). null before any separator. Drives actual-vs-budget
   * routing on import (a PLF/BS/CF sheet under "actual" is realized results,
   * under "budget" is a forward target). Set by `extractWorkbookMeta` (needs
   * sheet order); `extractSheetMetaFromAoa` defaults it to null.
   */
  sectionContext: "actual" | "budget" | "kpi" | "capex" | null
}

/** Map a section-separator sheet name → the section it starts. */
export function separatorSection(name: string): "actual" | "budget" | "kpi" | "capex" | null {
  if (/actual|факт/i.test(name)) return "actual"
  if (/kpi/i.test(name)) return "kpi"
  if (/capex|capital/i.test(name)) return "capex"
  if (/budget|plan|forecast|план|бюджет/i.test(name)) return "budget"
  return null
}

export interface ColumnProfile {
  /** 0-based column index. */
  columnIndex: number
  /** Inferred column header from headerRowIndex; null if no header. */
  header: string | null
  /** Type distribution of non-empty values in first 100 data rows. */
  types: {
    /** Pure numbers. */
    number: number
    /** Strings that look like dates (DD.MM.YYYY, MM/DD/YYYY, ISO). */
    date: number
    /** Strings that look like account codes (PLF.XX.XX, CF.XX.XX, etc.). */
    code: number
    /** Other text. */
    text: number
    /** Empty / null / undefined. */
    empty: number
  }
  /** Up to 3 sample values from this column for the LLM to see. */
  sampleValues: string[]
}

const DATE_PATTERNS = [
  /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/, // DD.MM.YYYY, MM/DD/YYYY
  /^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/, // YYYY-MM-DD
]

const CODE_PATTERNS = [
  /^(PLF|PL|BS|CF|HRZN)[._-]\d/i, // P&L/BS/CF account codes
  /^[A-Z]{2,5}-\d/, // Generic short prefix + digits
  /^\d{2,4}-\d{2}-\d{2}/, // 711-02-01 style SAP codes
]

function classifyCell(v: unknown): "number" | "date" | "code" | "text" | "empty" {
  if (v === null || v === undefined || v === "") return "empty"
  if (typeof v === "number" && Number.isFinite(v)) return "number"
  if (v instanceof Date) return "date"
  if (typeof v === "string") {
    const t = v.trim()
    if (!t) return "empty"
    if (DATE_PATTERNS.some((re) => re.test(t))) return "date"
    if (CODE_PATTERNS.some((re) => re.test(t))) return "code"
    return "text"
  }
  return "text"
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === "string") return v.length > 200 ? v.slice(0, 197) + "..." : v
  return String(v)
}

/**
 * Find the row most likely to be the header row.
 *
 * Heuristic: scan the first 15 rows; pick the one with the highest
 * count of non-empty STRING cells (i.e. text labels, not numbers).
 * Ties broken by earliest row.
 */
function detectHeaderRow(aoa: unknown[][]): number | null {
  let bestRow = -1
  let bestScore = -1
  const upper = Math.min(aoa.length, 15)
  for (let r = 0; r < upper; r++) {
    const row = aoa[r]
    if (!row) continue
    let stringCount = 0
    for (const c of row) {
      if (typeof c === "string" && c.trim().length > 0) stringCount++
    }
    if (stringCount > bestScore) {
      bestScore = stringCount
      bestRow = r
    }
  }
  return bestRow >= 0 && bestScore >= 2 ? bestRow : null
}

function profileColumns(
  aoa: unknown[][],
  headerRowIndex: number | null,
  maxColumns: number,
  scanRows: number,
): ColumnProfile[] {
  const profiles: ColumnProfile[] = []
  const dataStart = headerRowIndex !== null ? headerRowIndex + 1 : 0
  const upper = Math.min(aoa.length, dataStart + scanRows)
  for (let c = 0; c < maxColumns; c++) {
    const types = { number: 0, date: 0, code: 0, text: 0, empty: 0 }
    const sampleValues: string[] = []
    for (let r = dataStart; r < upper; r++) {
      const row = aoa[r] || []
      const v = row[c]
      const cls = classifyCell(v)
      types[cls]++
      if (cls !== "empty" && sampleValues.length < 3) {
        const s = stringify(v)
        if (s && !sampleValues.includes(s)) sampleValues.push(s)
      }
    }
    const header =
      headerRowIndex !== null && typeof aoa[headerRowIndex]?.[c] === "string"
        ? (aoa[headerRowIndex]![c] as string).trim()
        : null
    profiles.push({
      columnIndex: c,
      header,
      types,
      sampleValues,
    })
  }
  return profiles
}

function isSeparatorName(name: string): boolean {
  // Workbooks frequently use ">>>" or "—" rows as section separators
  // (e.g. "Actual >>>", "KPI >>>", "CAPEX >>>"). Don't classify these.
  return />>>|<<<|━+|═+/.test(name)
}

export interface ExtractOptions {
  /** Number of sample rows to include per sheet. Default 8. */
  sampleRows?: number
  /** Number of data rows to use for column profiling. Default 100. */
  profileRows?: number
  /** Max columns to keep in headers/sample/profiles. Default 20. */
  maxColumns?: number
  /** Truncate string cells to this many chars in sample. Default 80. */
  truncateCellChars?: number
}

/**
 * Extract metadata for a single sheet given its AOA (array-of-arrays)
 * representation — pure, no I/O. Use when you already have the AOA
 * loaded (e.g. from `XLSX.utils.sheet_to_json(sheet, {header:1})`).
 */
export function extractSheetMetaFromAoa(
  sheetName: string,
  aoa: unknown[][],
  range: string | null,
  opts: ExtractOptions = {},
): SheetMeta {
  const sampleRows = opts.sampleRows ?? 8
  const profileRows = opts.profileRows ?? 100
  const maxColumns = opts.maxColumns ?? 20
  const truncate = opts.truncateCellChars ?? 80

  if (isSeparatorName(sheetName)) {
    return {
      sheetName,
      range,
      totalRows: aoa.length,
      totalColumns: 0,
      headerRowIndex: null,
      headers: [],
      sample: [],
      columnProfiles: [],
      isSectionSeparator: true,
      sectionContext: null,
    }
  }

  const totalRows = aoa.length
  let totalColumns = 0
  for (const row of aoa) {
    if (row && row.length > totalColumns) totalColumns = row.length
  }
  const headerRowIndex = detectHeaderRow(aoa)
  const headers: string[] =
    headerRowIndex !== null
      ? (aoa[headerRowIndex] || [])
          .slice(0, maxColumns)
          .map((v) => stringify(v).slice(0, truncate))
      : []
  const dataStart = headerRowIndex !== null ? headerRowIndex + 1 : 0
  const sampleEnd = Math.min(aoa.length, dataStart + sampleRows)
  const sample: string[][] = []
  for (let r = dataStart; r < sampleEnd; r++) {
    const row = aoa[r] || []
    const stringified: string[] = []
    let hasContent = false
    for (let c = 0; c < maxColumns; c++) {
      const s = stringify(row[c]).slice(0, truncate)
      stringified.push(s)
      if (s) hasContent = true
    }
    if (hasContent) sample.push(stringified)
  }
  const columnProfiles = profileColumns(
    aoa,
    headerRowIndex,
    maxColumns,
    profileRows,
  )
  return {
    sheetName,
    range,
    totalRows,
    totalColumns,
    headerRowIndex,
    headers,
    sample,
    columnProfiles,
    isSectionSeparator: false,
    sectionContext: null,
  }
}

/**
 * Extract metadata for all sheets in a workbook. Pass in the loaded
 * xlsx module (e.g. `import * as XLSX from "xlsx"`) to avoid hard-coupling.
 */
export function extractWorkbookMeta(
  workbook: { Sheets: Record<string, unknown>; SheetNames: string[] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  XLSX: any,
  opts: ExtractOptions = {},
): SheetMeta[] {
  const out: SheetMeta[] = []
  // Track the running section as we walk the sheets in order: a separator like
  // "Actual >>>" starts the "actual" section for every following sheet until
  // the next separator. This is what lets the importer route a PLF/BS/CF sheet
  // under "Actual >>>" to the actuals plan vs a budget/plan sheet to the budget.
  let currentSection: "actual" | "budget" | "kpi" | "capex" | null = null
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName] as {
      "!ref"?: string
    }
    const range = sheet["!ref"] ?? null
    const aoa = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      blankrows: false,
    }) as unknown[][]
    const meta = extractSheetMetaFromAoa(sheetName, aoa, range, opts)
    if (meta.isSectionSeparator) {
      currentSection = separatorSection(sheetName)
    } else {
      meta.sectionContext = currentSection
    }
    out.push(meta)
  }
  return out
}
