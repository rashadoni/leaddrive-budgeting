/**
 * Reporting-pack detail adapter ("Reporting 2026.xlsx" family).
 *
 * The FO Holding monthly reporting pack stores its leaf-level financials in
 * three long-format detail sheets:
 *
 *   • "Actual PLF" / "Budget PLF"  — P&L,  codes PLF.xx.xx.xx
 *   • "BS Actual"                  — Balance Sheet, codes BS.xx.xx.xx
 *   • "CF Actual" / "Budget CF"    — Cash Flow, codes CF.xx.xx.xx
 *
 * Layout (observed 2026-06-20 against the real file):
 *
 *   col 0   = account code (PLF.01 / PLF.01.01.01 / BS.01 / CF.01 …)
 *   col 1   = English label
 *   cols N… = TWO monthly bands (2025 Jan-Dec AND 2026 Jan-Dec) plus
 *             annual / YTD / MTD helper columns
 *   col "BU" (≈37 PLF / 20 BS / 33 CF) = the entity each row belongs to:
 *             AZSF / EDEN / CPC / ProMalt / EJE  (each a contiguous block)
 *
 * Why this module exists: the canonical AZSEKER adapters
 * (`parsePlfPlSheet` / `parseWorkbookBsSheet` / `parsePlfCfSheet`) read the
 * code from col 0 and the year-band month columns — but they are BLIND to
 * the `BU` column, so on this file they merge all five entities' rows into
 * one undifferentiated stream (same leaf code appears once per BU → silent
 * cross-entity collapse). See the 2026-06-20 dry-run that proved this.
 *
 * Approach: split the sheet into one synthetic single-entity worksheet per
 * `BU` value, then delegate to the EXISTING, unit-tested canonical parsers.
 * This reuses all leaf-detection, sign-normalisation and year-aware header
 * logic verbatim — this module only adds the BU split + entity mapping.
 */
import type * as XLSX from "xlsx"
import {
  parsePlfPlSheet,
  parsePlfCfSheet,
  type ParsedPlfLine,
  type ParsedCfLine,
} from "./azseker-plf"
import {
  parseWorkbookBsSheet,
  type ParsedBsLine,
} from "./azseker-workbook-bs"

/** `BU` cell value → canonical Company.code in the FO Holding org. */
export const REPORTING_PACK_BU_TO_ENTITY: Record<string, string> = {
  AZSF: "AZSEKER-AZSF",
  EDEN: "AZSEKER-EDEN",
  CPC: "AZSEKER-CPC",
  PROMALT: "AZSEKER-PROMALT",
}

/**
 * BU values that are NOT a standalone entity and must be excluded from a
 * per-entity load. `EJE` = consolidation elimination journal entries; they
 * only make sense against the consolidated view, and loading them as a real
 * company would distort that company's statements.
 */
export const REPORTING_PACK_SKIP_BU = new Set(["EJE"])

/** Map a raw BU cell to a canonical entity code (or null when unmappable). */
export function mapReportingPackBu(bu: string): string | null {
  return REPORTING_PACK_BU_TO_ENTITY[bu.trim().toUpperCase()] ?? null
}

export interface ReportingPackEntityResult<L> {
  /** Raw BU cell value (e.g. "ProMalt", "EJE"). */
  buCode: string
  /** Canonical Company.code, or null when the BU is unmapped/skipped. */
  entityCode: string | null
  /** Whether this BU was skipped (EJE / unmapped) — caller should not write. */
  skipped: boolean
  lines: L[]
}

export interface ReportingPackParseResult<L> {
  sheetName: string
  entities: ReportingPackEntityResult<L>[]
  warnings: string[]
}

interface BuLocation {
  headerRow: number
  buCol: number
}

/** Locate the `BU` header cell (first exact "BU" match, scanning top rows). */
function locateBuColumn(aoa: unknown[][]): BuLocation | null {
  const limit = Math.min(aoa.length, 30)
  for (let r = 0; r < limit; r++) {
    const row = aoa[r] ?? []
    for (let c = 0; c < row.length; c++) {
      if (String(row[c] ?? "").trim() === "BU") return { headerRow: r, buCol: c }
    }
  }
  return null
}

/**
 * Split a detail sheet's AoA into one synthetic worksheet per BU value.
 * Each synthetic sheet keeps the original header row (so the downstream
 * parser's year-aware header detection still fires) followed by only that
 * BU's data rows (full-width, original column positions preserved).
 */
function splitByBu(
  aoa: unknown[][],
  xlsx: typeof XLSX,
): { groups: Array<{ bu: string; sheet: XLSX.WorkSheet }>; warnings: string[] } {
  const loc = locateBuColumn(aoa)
  const warnings: string[] = []
  if (!loc) {
    return {
      groups: [],
      warnings: ['No "BU" column found — not a reporting-pack detail sheet'],
    }
  }
  const headerRow = aoa[loc.headerRow]
  const byBu = new Map<string, unknown[][]>()
  for (let r = loc.headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const bu = String(row[loc.buCol] ?? "").trim()
    if (!bu) continue
    let rows = byBu.get(bu)
    if (!rows) {
      rows = [headerRow]
      byBu.set(bu, rows)
    }
    rows.push(row)
  }
  const groups = Array.from(byBu.entries()).map(([bu, rows]) => ({
    bu,
    sheet: xlsx.utils.aoa_to_sheet(rows),
  }))
  return { groups, warnings }
}

const SYNTH_SHEET = "__bu__"

/** Parse a reporting-pack P&L detail sheet (Actual PLF / Budget PLF). */
export function parseReportingPackPlf(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  opts: { preferYear: number },
): ReportingPackParseResult<ParsedPlfLine> {
  return parseDetailSheet(workbook, sheetName, xlsx, (sheet) => {
    const wb = { SheetNames: [SYNTH_SHEET], Sheets: { [SYNTH_SHEET]: sheet } } as XLSX.WorkBook
    const res = parsePlfPlSheet(wb, SYNTH_SHEET, xlsx, { preferYear: opts.preferYear })
    return { lines: res.lines, warnings: res.warnings.map((w) => w.reason) }
  })
}

/** Parse a reporting-pack Cash Flow detail sheet (CF Actual / Budget CF). */
export function parseReportingPackCf(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  opts: { preferYear: number },
): ReportingPackParseResult<ParsedCfLine> {
  return parseDetailSheet(workbook, sheetName, xlsx, (sheet) => {
    const wb = { SheetNames: [SYNTH_SHEET], Sheets: { [SYNTH_SHEET]: sheet } } as XLSX.WorkBook
    const res = parsePlfCfSheet(wb, SYNTH_SHEET, xlsx, { preferYear: opts.preferYear })
    return { lines: res.entries, warnings: res.warnings.map((w) => w.reason) }
  })
}

/** Parse a reporting-pack Balance Sheet detail sheet (BS Actual). */
export function parseReportingPackBs(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  opts: { preferYear: number },
): ReportingPackParseResult<ParsedBsLine> {
  return parseDetailSheet(workbook, sheetName, xlsx, (sheet) => {
    const wb = { SheetNames: [SYNTH_SHEET], Sheets: { [SYNTH_SHEET]: sheet } } as XLSX.WorkBook
    const res = parseWorkbookBsSheet(wb, SYNTH_SHEET, xlsx, { preferYear: opts.preferYear })
    return { lines: res.lines, warnings: res.warnings.map((w) => w.reason) }
  })
}

/** Shared skeleton: AoA → BU split → per-BU delegate parser → entity results. */
function parseDetailSheet<L>(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  parseOneBu: (sheet: XLSX.WorkSheet) => { lines: L[]; warnings: string[] },
): ReportingPackParseResult<L> {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return { sheetName, entities: [], warnings: [`Sheet "${sheetName}" not found`] }
  }
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown[][]

  const { groups, warnings } = splitByBu(aoa, xlsx)
  const entities: ReportingPackEntityResult<L>[] = []
  for (const { bu, sheet: buSheet } of groups) {
    const entityCode = mapReportingPackBu(bu)
    const skipped = REPORTING_PACK_SKIP_BU.has(bu.trim().toUpperCase()) || entityCode === null
    const { lines, warnings: subWarnings } = parseOneBu(buSheet)
    entities.push({ buCode: bu, entityCode, skipped, lines })
    for (const w of subWarnings) warnings.push(`[BU ${bu}] ${w}`)
    if (entityCode === null && !REPORTING_PACK_SKIP_BU.has(bu.trim().toUpperCase())) {
      warnings.push(`Unmapped BU "${bu}" — ${lines.length} lines skipped (add to REPORTING_PACK_BU_TO_ENTITY)`)
    }
  }
  return { sheetName, entities, warnings }
}
