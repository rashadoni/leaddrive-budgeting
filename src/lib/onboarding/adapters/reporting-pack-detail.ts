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
import { isAdjustmentEntityValue } from "../ai-import/entity-alias-utils"
import {
  findBuDimensionColumns,
  resolveAdjustmentOwner,
} from "../ai-import/bu-adjustment"

/** `BU` cell value → canonical Company.code in the FO Holding org. */
export const REPORTING_PACK_BU_TO_ENTITY: Record<string, string> = {
  AZSF: "AZSEKER-AZSF",
  EDEN: "AZSEKER-EDEN",
  CPC: "AZSEKER-CPC",
  PROMALT: "AZSEKER-PROMALT",
  HORIZON: "AZSEKER-HORIZON",
}

/**
 * BU values that are NOT a standalone entity and must never be loaded AS a
 * company:
 *   • EJE — intragroup elimination journal entries. They cancel trade between
 *     group members and belong to no single company; loading them as one would
 *     distort that company's statements. Correctly skipped.
 *   • AJE — a management ADJUSTMENT journal entry. Also not a company — which
 *     is why it stays in this set — but unlike an elimination it belongs to
 *     one, and the workbook's parent BU column says which. `splitByBu` folds
 *     such a block into its owner's rows BEFORE this set is consulted, so the
 *     money lands; the entry here is the fallback for when no owner can be
 *     named (then it is skipped LOUDLY, never silently). See
 *     `../ai-import/bu-adjustment.ts` for the rule and the evidence.
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
  /**
   * 11.83 — an adjustment BU (AJE) whose rows were appended to another BU's
   * sheet. `skipped` stays true (it is not written on its own) and `lines` is
   * empty: the lines are counted once, on the owner.
   */
  foldedInto?: string
  /** Adjustment BUs whose rows were folded INTO this one (owner side). */
  foldedFrom?: Array<{ buCode: string; rowCount: number; viaHeader: string }>
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
/** Rows from the top scanned for the BU header (and its sibling dimensions). */
const BU_HEADER_SCAN_ROWS = 30

function locateBuColumn(aoa: unknown[][], buHeader: string): BuLocation | null {
  const limit = Math.min(aoa.length, BU_HEADER_SCAN_ROWS)
  for (let r = 0; r < limit; r++) {
    const row = aoa[r] ?? []
    for (let c = 0; c < row.length; c++) {
      if (String(row[c] ?? "").trim() === buHeader) return { headerRow: r, buCol: c }
    }
  }
  return null
}

interface BuGroup {
  bu: string
  sheet: XLSX.WorkSheet
  /** Rows moved into another BU's sheet — this group must not be written. */
  foldedInto?: string
  /** Adjustment BUs merged into this group's sheet. */
  foldedFrom?: Array<{ buCode: string; rowCount: number; viaHeader: string }>
}

/**
 * Split a detail sheet's AoA into one synthetic worksheet per BU value.
 * Each synthetic sheet keeps the original header row (so the downstream
 * parser's year-aware header detection still fires) followed by only that
 * BU's data rows (full-width, original column positions preserved).
 *
 * 11.83 — a management-ADJUSTMENT BU (AJE) is not a company, but it belongs
 * to one and the sheet's parent BU column names it. Its rows are appended to
 * that company's group rather than dropped; the adjustment group itself is
 * left with only the header row and marked `foldedInto`, so it can be reported
 * without being written twice. An adjustment whose owner cannot be named keeps
 * the old behaviour (skipped) but now says so.
 */
function splitByBu(
  aoa: unknown[][],
  xlsx: typeof XLSX,
  buHeader: string,
): { groups: BuGroup[]; warnings: string[] } {
  const loc = locateBuColumn(aoa, buHeader)
  const warnings: string[] = []
  if (!loc) {
    return {
      groups: [],
      warnings: [`No "${buHeader}" column found — not a reporting-pack detail sheet`],
    }
  }
  const headerRow = aoa[loc.headerRow]
  /** BU → its own data rows, in document order (header prepended at the end). */
  const byBu = new Map<string, unknown[][]>()
  for (let r = loc.headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const bu = String(row[loc.buCol] ?? "").trim()
    if (!bu) continue
    let rows = byBu.get(bu)
    if (!rows) {
      rows = []
      byBu.set(bu, rows)
    }
    rows.push(row)
  }

  // ── Fold adjustment BUs into the company their parent column names ──────
  const dimensionColumns = findBuDimensionColumns(aoa, BU_HEADER_SCAN_ROWS)
  const foldedInto = new Map<string, string>()
  const foldedFrom = new Map<string, Array<{ buCode: string; rowCount: number; viaHeader: string }>>()
  for (const [bu, rows] of byBu) {
    if (mapReportingPackBu(bu) !== null) continue
    if (!isAdjustmentEntityValue(bu)) continue
    const owner = resolveAdjustmentOwner({
      buValue: bu,
      blockRows: rows,
      entityColumn: loc.buCol,
      dimensionColumns,
      resolveEntity: mapReportingPackBu,
    })
    if (!owner.ok) {
      warnings.push(
        `BU "${bu}" (${rows.length} rows) is a management adjustment, not an elimination, but ` +
          `${owner.reason} — NOT imported. Its amounts are missing from the group until the ` +
          `owning company is named.`,
      )
      continue
    }
    const ownerBu = [...byBu.keys()].find((k) => mapReportingPackBu(k) === owner.entityCode)
    if (!ownerBu) {
      warnings.push(
        `BU "${bu}" (${rows.length} rows) is attributed to ${owner.entityCode} by column ` +
          `"${owner.viaHeader}", but that company has no block on this sheet — NOT imported.`,
      )
      continue
    }
    byBu.get(ownerBu)!.push(...rows)
    byBu.set(bu, [])
    foldedInto.set(bu, owner.entityCode)
    const list = foldedFrom.get(ownerBu) ?? []
    list.push({ buCode: bu, rowCount: rows.length, viaHeader: owner.viaHeader })
    foldedFrom.set(ownerBu, list)
    warnings.push(
      `BU "${bu}" (${rows.length} rows) is a management adjustment attributed to "${owner.label}" ` +
        `by column "${owner.viaHeader}" — folded into ${owner.entityCode} (it is not an ` +
        `elimination and must not be dropped).`,
    )
  }

  const groups: BuGroup[] = Array.from(byBu.entries()).map(([bu, rows]) => ({
    bu,
    sheet: xlsx.utils.aoa_to_sheet([headerRow, ...rows]),
    ...(foldedInto.has(bu) ? { foldedInto: foldedInto.get(bu)! } : {}),
    ...(foldedFrom.has(bu) ? { foldedFrom: foldedFrom.get(bu)! } : {}),
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
  /** Adjustment BU folded into another BU's workbook — skipped here, written there. */
  foldedInto?: string
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
  const splits: ReportingPackBuWorkbook[] = groups.map(({ bu, sheet: buSheet, foldedInto }) => {
    const entityCode = mapReportingPackBu(bu)
    const skipped =
      REPORTING_PACK_SKIP_BU.has(bu.trim().toUpperCase()) ||
      entityCode === null ||
      foldedInto !== undefined
    return {
      buCode: bu,
      entityCode,
      skipped,
      ...(foldedInto ? { foldedInto } : {}),
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
  // Phase 11.36 — classify the cost-sign convention ONCE, over every row of
  // the sheet, before splitting. The convention belongs to the FILE; running
  // the classifier per BU let one workbook land two different conventions (an
  // all-zero BU falls to `no_evidence` → default flip, while a sibling reads
  // `positive_costs` and does not flip).
  //
  // The whole-sheet pass merges the entities — which is precisely the defect
  // this module exists to fix — but that collapse cannot change a SIGN, and
  // reusing the canonical parser keeps leaf detection identical to the per-BU
  // calls rather than duplicating it here.
  const wholeSheet = parsePlfPlSheet(workbook, sheetName, xlsx, {
    preferYear: opts.preferYear,
  })
  const signOverride = wholeSheet.signConvention
  const signWarnings: string[] = []
  if (signOverride) {
    signWarnings.push(`Cost-sign convention (whole sheet): ${signOverride.notes.join("; ")}`)
    if (signOverride.blockedReason) {
      signWarnings.push(`BLOCKED: ${signOverride.blockedReason}`)
    }
  } else {
    // No header row → nothing was classified. Each BU then decides for itself,
    // which is the pre-11.36 behaviour; say so rather than imply a shared one.
    signWarnings.push(
      `Cost-sign convention could not be read from the whole sheet — each BU classified independently`,
    )
  }

  const result = parseDetailSheet(workbook, sheetName, xlsx, opts.buHeader ?? "BU", (sheet) => {
    const wb = { SheetNames: [SYNTH_SHEET], Sheets: { [SYNTH_SHEET]: sheet } } as XLSX.WorkBook
    const res = parsePlfPlSheet(wb, SYNTH_SHEET, xlsx, {
      preferYear: opts.preferYear,
      signOverride,
    })
    return { lines: res.lines, warnings: res.warnings.map((w) => w.reason) }
  })
  return { ...result, warnings: [...signWarnings, ...result.warnings] }
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
  for (const { bu, sheet: buSheet, foldedInto, foldedFrom } of groups) {
    const entityCode = mapReportingPackBu(bu)
    const skipped =
      REPORTING_PACK_SKIP_BU.has(bu.trim().toUpperCase()) ||
      entityCode === null ||
      foldedInto !== undefined
    if (foldedInto) {
      // Its rows now live on the owner's sheet and are counted there exactly
      // once. Parsing this stub would double-count nothing (it is empty) but
      // would emit a spurious "no data" warning.
      entities.push({ buCode: bu, entityCode, skipped: true, foldedInto, lines: [] })
      continue
    }
    const { lines, warnings: subWarnings } = parseOneBu(buSheet)
    entities.push({
      buCode: bu,
      entityCode,
      skipped,
      ...(foldedFrom ? { foldedFrom } : {}),
      lines,
    })
    for (const w of subWarnings) warnings.push(`[BU ${bu}] ${w}`)
    if (entityCode === null && !REPORTING_PACK_SKIP_BU.has(bu.trim().toUpperCase())) {
      warnings.push(`Unmapped BU "${bu}" — ${lines.length} lines skipped (add to REPORTING_PACK_BU_TO_ENTITY)`)
    }
  }
  return { sheetName, entities, warnings }
}
