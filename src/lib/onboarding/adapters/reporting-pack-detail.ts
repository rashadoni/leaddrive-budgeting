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
  HORIZON: "AZSEKER-HORIZON",
}

/**
 * BU values that are NOT a standalone entity and must be excluded from a
 * per-entity load:
 *   • EJE / AJE — elimination / adjustment journal entries (the actuals
 *     sheets use "EJE", the budget P&L's BU_3 uses "AJE"); they only make
 *     sense against the consolidated view, so loading them as a real company
 *     would distort that company's statements.
 *   • CONSOLIDATED — the rollup block (budget CF carries one); loading it
 *     alongside the children would double-count.
 */
export const REPORTING_PACK_SKIP_BU = new Set(["EJE", "AJE", "CONSOLIDATED"])

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

/**
 * Locate the BU header cell (first exact `buHeader` match, scanning top rows).
 * Most sheets label it "BU"; the budget P&L uses a `BU_1..BU_4` hierarchy
 * where `BU_3` is the operating-entity leaf (separates CPC from EDEN), so the
 * header name is configurable per sheet.
 */
function locateBuColumn(aoa: unknown[][], buHeader: string): BuLocation | null {
  const limit = Math.min(aoa.length, 30)
  for (let r = 0; r < limit; r++) {
    const row = aoa[r] ?? []
    for (let c = 0; c < row.length; c++) {
      if (String(row[c] ?? "").trim() === buHeader) return { headerRow: r, buCol: c }
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
  buHeader: string,
): { groups: Array<{ bu: string; sheet: XLSX.WorkSheet }>; warnings: string[] } {
  const loc = locateBuColumn(aoa, buHeader)
  const warnings: string[] = []
  if (!loc) {
    return {
      groups: [],
      warnings: [`No "${buHeader}" column found — not a reporting-pack detail sheet`],
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

/**
 * Split a detail sheet into one single-entity WORKBOOK per BU value, each
 * holding the sheet under its ORIGINAL name. This is the apply-path seam:
 * each synthetic workbook can be fed straight to the existing production
 * adapter handlers (makePlfHandler / makeBsHandler / makeCfHandler), which
 * read `workbook.Sheets[sheetName]` — so the entire audited write path
 * (CoA upsert + clean-slate + collateral-guard + reconciliation) is reused
 * verbatim, once per entity, with no new DB-mutating code.
 */
export interface ReportingPackBuWorkbook {
  buCode: string
  entityCode: string | null
  /** EJE / unmapped BU — caller must NOT write this entity. */
  skipped: boolean
  workbook: XLSX.WorkBook
}

export function splitWorkbookByBu(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  opts: { buHeader?: string } = {},
): { sheetName: string; splits: ReportingPackBuWorkbook[]; warnings: string[] } {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return { sheetName, splits: [], warnings: [`Sheet "${sheetName}" not found`] }
  }
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown[][]
  const { groups, warnings } = splitByBu(aoa, xlsx, opts.buHeader ?? "BU")
  const splits: ReportingPackBuWorkbook[] = groups.map(({ bu, sheet: buSheet }) => {
    const entityCode = mapReportingPackBu(bu)
    const skipped =
      REPORTING_PACK_SKIP_BU.has(bu.trim().toUpperCase()) || entityCode === null
    return {
      buCode: bu,
      entityCode,
      skipped,
      workbook: {
        SheetNames: [sheetName],
        Sheets: { [sheetName]: buSheet },
      } as XLSX.WorkBook,
    }
  })
  return { sheetName, splits, warnings }
}

const SYNTH_SHEET = "__bu__"

/** Parse a reporting-pack P&L detail sheet (Actual PLF / Budget PLF). */
export function parseReportingPackPlf(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  opts: { preferYear: number; buHeader?: string },
): ReportingPackParseResult<ParsedPlfLine> {
  return parseDetailSheet(workbook, sheetName, xlsx, opts.buHeader ?? "BU", (sheet) => {
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
  opts: { preferYear: number; buHeader?: string },
): ReportingPackParseResult<ParsedCfLine> {
  return parseDetailSheet(workbook, sheetName, xlsx, opts.buHeader ?? "BU", (sheet) => {
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
  opts: { preferYear: number; buHeader?: string },
): ReportingPackParseResult<ParsedBsLine> {
  return parseDetailSheet(workbook, sheetName, xlsx, opts.buHeader ?? "BU", (sheet) => {
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
  buHeader: string,
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

  const { groups, warnings } = splitByBu(aoa, xlsx, buHeader)
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
