/**
 * BU-column consolidated-statement splitter (2026-06-28).
 *
 * Why this exists
 * ───────────────
 * Some clients ship per-entity financial statements as ONE consolidated sheet
 * with a **"BU" (business-unit) column** that self-labels every data row's owning
 * entity, the entities stacked in vertical blocks. AzerSheker's
 * `actual-budget-v1.xlsx` is the canonical case — `PLF Actual 2025` is three
 * stacked P&L blocks (CPC rows 4-374 / AZSF=holding 377-910 / EDEN 913-1446),
 * each row carrying its code in col A and its entity in the "BU" column (col S).
 *
 * The flat cell-scan (`scanDominantEntity`) reads the SINGLE most-frequent entity
 * across the whole sheet and routes everything onto it — so a 4-entity P&L lands
 * on whichever block has the most rows (EDEN won 2025 by a 2-cell margin over the
 * holding). That silently destroys per-entity attribution — the recurring
 * "delete → AI-import is always wrong" class (see [[project_budget_plf_five_blocks]]).
 *
 * What this does
 * ──────────────
 * Unlike `consolidated-plf-split.ts` (which splits a `PLF.01`-marked PLF sheet and
 * attributes blocks by CALLER-supplied ORDER because that file has no per-block
 * label), these sheets are SELF-LABELED: the BU column names each block's entity.
 * So this splits a sheet into one virtual worksheet PER contiguous BU run, reading
 * each block's entity directly from its BU value (resolved through the same
 * `aliasMap` as the cell-scan: CPC→AZSEKER-CPC, AZSF→AZSEKER, …). Statement-
 * agnostic: works for PLF, BS and CF alike (it never inspects the code column).
 *
 * Each virtual sheet = the shared preamble (the header rows above the first
 * data row, incl. the 12-month header) + that block's rows, so it flows through
 * the EXISTING one-sheet→one-entity parse/write/reconcile pipeline unchanged.
 *
 * Pure apart from the workbook mutation in `applyBuColumnSplit`. No DB, no LLM.
 */
import type * as XLSX from "xlsx"
import type { SheetDataType } from "./sheet-classifier"
import type { PlanKind, SheetMapEntry } from "./sheet-routing"

/** Header label (exact, case-insensitive) that marks the owning-entity column. */
const BU_HEADER = "BU"
/** Rows from the top scanned for the BU header before giving up. */
const HEADER_SCAN_ROWS = 6
/** A block must carry at least this many rows to count (filters stray labels). */
const MIN_BLOCK_ROWS = 3

/**
 * Find the 0-based column index of the "BU" header within the top
 * `headerScanRows`. Returns -1 when the sheet has no BU column.
 */
export function findBuColumn(
  aoa: ReadonlyArray<ReadonlyArray<unknown>>,
  headerScanRows = HEADER_SCAN_ROWS,
): number {
  for (let r = 0; r < Math.min(headerScanRows, aoa.length); r++) {
    const row = aoa[r] ?? []
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      if (typeof v === "string" && v.trim().toUpperCase() === BU_HEADER) return c
    }
  }
  return -1
}

export interface BuBlock {
  /** Raw BU cell value that opened the block (e.g. "CPC"). */
  buValue: string
  /** Resolved canonical entity code, or null when the BU value is not a known alias. */
  entityCode: string | null
  /** Inclusive 0-based AOA row range of the block's own rows (excludes preamble). */
  rowStart: number
  rowEnd: number
  rowCount: number
  /** Virtual worksheet = shared preamble + this block's rows. */
  worksheet: XLSX.WorkSheet
}

export interface BuColumnSplitResult {
  /** 0-based index of the detected BU column, or -1 when none. */
  buColumn: number
  /** One per contiguous BU run (document order). 0 or 1 block ⇒ not consolidated. */
  blocks: BuBlock[]
  warnings: string[]
}

/**
 * Split a consolidated sheet into per-BU-block virtual worksheets.
 *
 * Block rule: walk the data rows (those at/after the first row carrying a BU
 * alias); each row inherits the most recent non-empty BU value, and a NEW block
 * starts whenever that value changes to a different alias. Rows above the first
 * BU value are the shared preamble (the month/code header) and are prepended to
 * every virtual sheet. Returns [] blocks (no-op) when there's no BU column or
 * fewer than two blocks — an ordinary single-entity sheet is left untouched.
 */
export function splitByBuColumn(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  aliasMap: Record<string, string>,
  opts: { minBlockRows?: number } = {},
): BuColumnSplitResult {
  const minBlockRows = opts.minBlockRows ?? MIN_BLOCK_ROWS
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return { buColumn: -1, blocks: [], warnings: [`Sheet "${sheetName}" not found`] }

  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown[][]

  const buCol = findBuColumn(aoa)
  if (buCol < 0) return { buColumn: -1, blocks: [], warnings: [] }

  // The "BU" header row itself must not open a block — data begins below it.
  let headerRow = 0
  for (let r = 0; r < Math.min(HEADER_SCAN_ROWS, aoa.length); r++) {
    const v = aoa[r]?.[buCol]
    if (typeof v === "string" && v.trim().toUpperCase() === BU_HEADER) {
      headerRow = r
      break
    }
  }

  // Raw (uppercased) BU label for a data row, or null for header/blank cells.
  // ANY non-empty label opens a block — an UNKNOWN entity (e.g. a not-yet-seeded
  // company) thus gets its OWN block that resolves to entityCode=null and is
  // skipped, never silently merged into a neighbour (that merge is exactly the
  // corruption this module exists to prevent).
  const buRaw = (r: number): string | null => {
    if (r <= headerRow) return null
    const v = aoa[r]?.[buCol]
    if (v === null || v === undefined) return null
    const s = String(v).trim().toUpperCase()
    return s || null
  }

  // First data row = first labelled row below the header.
  let firstData = -1
  for (let r = headerRow + 1; r < aoa.length; r++) {
    if (buRaw(r)) {
      firstData = r
      break
    }
  }
  if (firstData < 0) return { buColumn: buCol, blocks: [], warnings: [] }

  const preamble = aoa.slice(0, firstData)

  // Group data rows into contiguous runs by the inherited BU label (a blank BU
  // cell inherits the current block; a different label starts a new one).
  type Run = { buValue: string; start: number; end: number }
  const runs: Run[] = []
  let current: string | null = null
  for (let r = firstData; r < aoa.length; r++) {
    const a = buRaw(r)
    if (a) current = a
    if (current === null) continue
    if (runs.length && runs[runs.length - 1].buValue === current) {
      runs[runs.length - 1].end = r
    } else {
      runs.push({ buValue: current, start: r, end: r })
    }
  }

  const warnings: string[] = []
  const blocks: BuBlock[] = []
  for (const run of runs) {
    const rowCount = run.end - run.start + 1
    if (rowCount < minBlockRows) {
      warnings.push(
        `Sheet "${sheetName}": BU block "${run.buValue}" has only ${rowCount} row(s) (< ${minBlockRows}) — skipped`,
      )
      continue
    }
    const entityCode = aliasMap[run.buValue] ?? null
    const blockRows = aoa.slice(run.start, run.end + 1)
    const worksheet = xlsx.utils.aoa_to_sheet([...preamble, ...blockRows])
    blocks.push({
      buValue: run.buValue,
      entityCode,
      rowStart: run.start,
      rowEnd: run.end,
      rowCount,
      worksheet,
    })
  }

  return { buColumn: buCol, blocks, warnings }
}

export interface BuColumnSplitApplied {
  /** True iff the sheet was a consolidated multi-BU sheet and was split + removed. */
  applied: boolean
  sheetMapEntries: SheetMapEntry[]
  mapping: Array<{ sheetName: string; entityCode: string; buValue: string; rowCount: number }>
  warnings: string[]
}

/**
 * Detect + split a consolidated multi-BU statement, MUTATING the workbook: each
 * BU block becomes a new sheet `<sheetName> [<CODE>]`, and the raw sheet is
 * removed so the existing one-sheet→one-entity pipeline writes each block to its
 * own company.
 *
 * Applies ONLY when the BU column yields ≥2 blocks resolving to ≥2 DISTINCT known
 * entities — a single-entity sheet (or one whose BU values are all unknown
 * aliases) is left untouched (`applied:false`) so the normal classifier / cell-
 * scan flow handles it. A block whose BU value isn't a known alias is skipped
 * with a warning (never mis-attributed). `dataType`/`planKind` are pinned on each
 * virtual sheet's map entry so routing never depends on the LLM re-classifying it.
 */
export function applyBuColumnSplit(
  workbook: XLSX.WorkBook,
  xlsx: typeof XLSX,
  opts: {
    sheetName: string
    dataType: SheetDataType
    planKind?: PlanKind
    aliasMap: Record<string, string>
    minBlockRows?: number
  },
): BuColumnSplitApplied {
  const { sheetName, dataType, planKind, aliasMap } = opts
  const out: BuColumnSplitApplied = {
    applied: false,
    sheetMapEntries: [],
    mapping: [],
    warnings: [],
  }

  const split = splitByBuColumn(workbook, sheetName, xlsx, aliasMap, {
    minBlockRows: opts.minBlockRows,
  })
  out.warnings.push(...split.warnings)

  const resolved = split.blocks.filter((b) => b.entityCode)
  const distinct = new Set(resolved.map((b) => b.entityCode))
  // Need a genuinely cross-entity sheet: ≥2 blocks, ≥2 distinct entities.
  if (split.blocks.length < 2 || distinct.size < 2) return out

  const usedNames = new Set<string>(workbook.SheetNames)
  for (const block of split.blocks) {
    if (!block.entityCode) {
      out.warnings.push(
        `Sheet "${sheetName}": BU block "${block.buValue}" (${block.rowCount} rows) is not a known entity alias — skipped (not imported)`,
      )
      continue
    }
    let newName = `${sheetName} [${block.entityCode}]`
    let n = 2
    while (usedNames.has(newName)) newName = `${sheetName} [${block.entityCode}] #${n++}`
    usedNames.add(newName)

    workbook.Sheets[newName] = block.worksheet
    workbook.SheetNames.push(newName)
    out.sheetMapEntries.push({
      match: newName,
      dataType,
      ...(planKind ? { planKind } : {}),
      role: "source",
      entityCode: block.entityCode,
    })
    out.mapping.push({
      sheetName: newName,
      entityCode: block.entityCode,
      buValue: block.buValue,
      rowCount: block.rowCount,
    })
  }

  if (out.sheetMapEntries.length < 2) {
    // Fewer than two virtual sheets actually materialised (e.g. unknown aliases)
    // — undo nothing (the adds above are distinct names) but DON'T remove the raw
    // sheet; treat as no-op so the raw sheet still flows normally.
    return out
  }

  // Remove the raw consolidated sheet so it isn't classified / written again.
  delete workbook.Sheets[sheetName]
  workbook.SheetNames = workbook.SheetNames.filter((nm) => nm !== sheetName)
  out.applied = true
  return out
}

/** True when a sheet is a consolidated multi-BU statement (≥2 distinct entities). */
export function looksLikeBuConsolidated(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  aliasMap: Record<string, string>,
): boolean {
  const { blocks } = splitByBuColumn(workbook, sheetName, xlsx, aliasMap)
  const distinct = new Set(blocks.filter((b) => b.entityCode).map((b) => b.entityCode))
  return blocks.length >= 2 && distinct.size >= 2
}

/** Statement dataType + planKind inferred from a sheet NAME, or null if the name
 *  is not a PLF/BS/CF statement. Used to pin routing on the split virtual sheets. */
export function inferStatementMeta(
  sheetName: string,
): { dataType: SheetDataType; planKind?: PlanKind } | null {
  let dataType: SheetDataType | null = null
  if (/\bPLF\b/i.test(sheetName) || /^PLF/i.test(sheetName)) dataType = "PLF"
  else if (/\bBS\b/i.test(sheetName)) dataType = "BS"
  else if (/\bCF\b/i.test(sheetName)) dataType = "CF"
  if (!dataType) return null

  let planKind: PlanKind | undefined
  if (/\b(budget|büdcə|budcə|бюджет|proqnoz|forecast)\b/i.test(sheetName)) planKind = "budget"
  else if (/\b(actual|faktiki|fakt|факт\w*)\b/i.test(sheetName)) planKind = "actual"
  return { dataType, planKind }
}
