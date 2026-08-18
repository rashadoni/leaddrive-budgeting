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
import { findPlfHeaderRow } from "../adapters/azseker-plf"
import type { SheetDataType } from "./sheet-classifier"
import type { PlanKind, SheetMapEntry } from "./sheet-routing"
import {
  isAdjustmentEntityValue,
  isEliminationLikeEntityValue,
} from "./entity-alias-utils"
import {
  findBuDimensionColumns,
  resolveAdjustmentOwner,
  BU_DIMENSION_SCAN_ROWS,
} from "./bu-adjustment"
import { isIntragroupEliminationBuValue } from "../adapters/bs-eliminations"

/** Header label (exact, case-insensitive) that marks the owning-entity column. */
const BU_HEADER = "BU"
/** BU dimension header incl. numbered variants ("BU_1", "BU_3") that some
 *  workbooks use for MULTI-dimensional tagging (entity × sub-unit). */
const BU_HEADER_RE = /^BU(_\d+)?$/i
/** Rows from the top scanned for the BU header before giving up. */
const HEADER_SCAN_ROWS = 6
/** A block must carry at least this many rows to count (filters stray labels). */
const MIN_BLOCK_ROWS = 3

/**
 * Find the 0-based column index of the owning-entity column within the top
 * `headerScanRows`. Returns -1 when the sheet has no usable BU column.
 *
 * Without an `aliasMap`, only the exact "BU" header is accepted (legacy
 * behaviour). With one, numbered "BU_N" dimension columns become candidates
 * too — needed for workbooks that ship NO plain "BU" header (e.g. a "PLF
 * Budget" whose entity column is "BU_3" while "BU_1" tags the parent group,
 * mislabelling subsidiary blocks). Candidates are scored by how many DISTINCT
 * known entities their values resolve to via the aliasMap — the true entity
 * column names every stacked block, so it maximises that count; a parent/
 * sub-unit dimension collapses several blocks onto one label and scores lower.
 * Ties prefer the exact "BU" header, then more distinct elimination-like
 * labels (AJE/EJE — evidence of a genuine block column), then the leftmost.
 */
export function findBuColumn(
  aoa: ReadonlyArray<ReadonlyArray<unknown>>,
  aliasMapOrScanRows?: Record<string, string> | number,
  headerScanRows = HEADER_SCAN_ROWS,
): number {
  const aliasMap =
    typeof aliasMapOrScanRows === "object" ? aliasMapOrScanRows : undefined
  const scanRows =
    typeof aliasMapOrScanRows === "number" ? aliasMapOrScanRows : headerScanRows

  // Candidate columns: header row index + exactness per column.
  const candidates: Array<{ col: number; headerRow: number; exact: boolean }> = []
  for (let r = 0; r < Math.min(scanRows, aoa.length); r++) {
    const row = aoa[r] ?? []
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      if (typeof v !== "string") continue
      const label = v.trim().toUpperCase()
      if (!BU_HEADER_RE.test(label)) continue
      if (!candidates.some((cand) => cand.col === c)) {
        candidates.push({ col: c, headerRow: r, exact: label === BU_HEADER })
      }
    }
  }
  if (candidates.length === 0) return -1

  const exact = candidates.find((c) => c.exact)
  // Legacy path (no aliasMap): exact "BU" or nothing.
  if (!aliasMap) return exact ? exact.col : -1

  let best: { col: number; known: number; exact: boolean; elim: number } | null =
    null
  for (const cand of candidates) {
    const known = new Set<string>()
    const elim = new Set<string>()
    for (let r = cand.headerRow + 1; r < aoa.length; r++) {
      const v = aoa[r]?.[cand.col]
      if (v === null || v === undefined) continue
      const s = String(v).trim().toUpperCase()
      if (!s) continue
      if (isEliminationLikeEntityValue(s)) elim.add(s)
      else if (aliasMap[s]) known.add(aliasMap[s])
    }
    const score = { col: cand.col, known: known.size, exact: cand.exact, elim: elim.size }
    if (
      !best ||
      score.known > best.known ||
      (score.known === best.known && score.exact && !best.exact) ||
      (score.known === best.known &&
        score.exact === best.exact &&
        score.elim > best.elim)
    ) {
      best = score
    }
  }
  // No candidate resolves ANY known entity — fall back to the exact "BU"
  // column when present (legacy behaviour: downstream yields null-entity
  // blocks and the split is not applied), else report no BU column.
  if (best && best.known > 0) return best.col
  return exact ? exact.col : -1
}

/**
 * True when a sheet carries a "BU"/"BU_N" dimension column in which ≥2 DISTINCT
 * known entities appear — i.e. a consolidated cross-entity statement.
 *
 * Such a sheet must NEVER be cell-scan-collapsed onto its majority entity. A
 * clean single-"BU" sheet is split per-entity by `applyBuColumnSplit` upstream;
 * a sheet whose BU dimensions are ambiguous (several BU_N columns disagreeing —
 * the same row tagged with different entities, e.g. an entity×sub-unit budget)
 * CAN'T be split deterministically, so the cell-scan uses this guard to leave it
 * a no-op (entity null) for one-time review instead of a wrong single-entity
 * write. Cheap header-region scan; returns false for ordinary single-entity or
 * BU-less sheets so the normal cell-scan path is untouched.
 */
export function hasMultiEntityBuColumn(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  aliasMap: Record<string, string>,
): boolean {
  const buCols: number[] = []
  for (let r = 0; r < Math.min(HEADER_SCAN_ROWS, rows.length); r++) {
    const row = rows[r] ?? []
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      if (typeof v === "string" && BU_HEADER_RE.test(v.trim())) buCols.push(c)
    }
  }
  for (const c of buCols) {
    const distinct = new Set<string>()
    for (const row of rows) {
      const v = row[c]
      if (v === null || v === undefined) continue
      const code = aliasMap[String(v).trim().toUpperCase()]
      if (code) distinct.add(code)
    }
    if (distinct.size >= 2) return true
  }
  return false
}

export interface BuBlock {
  /** Raw BU cell value that opened the block (e.g. "CPC"). */
  buValue: string
  /** Resolved canonical entity code, or null when the BU value is not a known alias. */
  entityCode: string | null
  /** Why a null-entity block is skipped. */
  skipReason?: "elimination" | "unknown_alias" | "adjustment"
  /**
   * 11.83 — a management-adjustment block (AJE) whose rows were APPENDED to
   * the named entity's virtual worksheet instead of being dropped. The block
   * keeps `entityCode: null` because it is not an entity of its own; the rows
   * are written under `foldedInto.entityCode`. See `bu-adjustment.ts`.
   */
  foldedInto?: { entityCode: string; viaHeader: string; label: string }
  /** Inclusive 0-based AOA row range of the block's own rows (excludes preamble). */
  rowStart: number
  rowEnd: number
  rowCount: number
  /** BU labels whose rows were folded INTO this block's worksheet (owner side). */
  foldedFrom?: Array<{ buValue: string; rowCount: number; viaHeader: string }>
  /** Virtual worksheet = shared preamble + this block's rows (+ folded rows). */
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

  const buCol = findBuColumn(aoa, aliasMap)
  if (buCol < 0) return { buColumn: -1, blocks: [], warnings: [] }

  // The BU header row itself must not open a block — data begins below it.
  // Match any "BU"/"BU_N" label since the chosen column may be a numbered one.
  let headerRow = 0
  for (let r = 0; r < Math.min(HEADER_SCAN_ROWS, aoa.length); r++) {
    const v = aoa[r]?.[buCol]
    if (typeof v === "string" && BU_HEADER_RE.test(v.trim().toUpperCase())) {
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

  // ── Pass 1: classify every surviving run ────────────────────────────────
  interface Classified {
    run: Run
    rowCount: number
    entityCode: string | null
    skipReason?: "elimination" | "unknown_alias" | "adjustment"
    foldedInto?: { entityCode: string; viaHeader: string; label: string }
  }
  const dimensionColumns = findBuDimensionColumns(aoa, BU_DIMENSION_SCAN_ROWS)
  const classified: Classified[] = []
  for (const run of runs) {
    const rowCount = run.end - run.start + 1
    if (rowCount < minBlockRows) {
      warnings.push(
        `Sheet "${sheetName}": BU block "${run.buValue}" has only ${rowCount} row(s) (< ${minBlockRows}) — skipped`,
      )
      continue
    }
    const entityCode = isEliminationLikeEntityValue(run.buValue)
      ? null
      : (aliasMap[run.buValue] ?? null)
    if (entityCode) {
      classified.push({ run, rowCount, entityCode })
      continue
    }
    // 11.83 — before calling a non-entity block an elimination, ask whether the
    // sheet's own BU hierarchy attributes it to a company. EJE is its own
    // parent and stays skipped; AJE's parent is a real entity, and dropping it
    // is what removed 1,677,015 AZN of EDEN's cost from the group.
    if (isAdjustmentEntityValue(run.buValue)) {
      const owner = resolveAdjustmentOwner({
        buValue: run.buValue,
        blockRows: aoa.slice(run.start, run.end + 1),
        entityColumn: buCol,
        dimensionColumns,
        resolveEntity: (label) => aliasMap[label] ?? null,
      })
      if (owner.ok) {
        classified.push({
          run,
          rowCount,
          entityCode: null,
          skipReason: "adjustment",
          foldedInto: {
            entityCode: owner.entityCode,
            viaHeader: owner.viaHeader,
            label: owner.label,
          },
        })
      } else {
        classified.push({ run, rowCount, entityCode: null, skipReason: "adjustment" })
        warnings.push(
          `Sheet "${sheetName}": BU block "${run.buValue}" (${rowCount} rows) is a management ` +
            `adjustment, not an elimination, but ${owner.reason} — NOT imported. Its amounts are ` +
            `missing from the group until the owning company is named.`,
        )
      }
      continue
    }
    classified.push({
      run,
      rowCount,
      entityCode: null,
      skipReason: isEliminationLikeEntityValue(run.buValue) ? "elimination" : "unknown_alias",
    })
  }

  // ── Pass 2: attach each folded adjustment to its owner's FIRST block ─────
  // First, not "a new sheet of its own": one entity gets one virtual sheet per
  // batch because the write path clean-slates by (plan × company × year) per
  // sheet — a second sheet for the same company would archive the first one's
  // rows. Appending keeps it a single write; duplicate account codes inside a
  // sheet are already summed per (entity, code, period) by the PLF handler.
  const ownerIndex = new Map<string, number>()
  classified.forEach((c, i) => {
    if (c.entityCode && !ownerIndex.has(c.entityCode)) ownerIndex.set(c.entityCode, i)
  })
  const foldedRowsByOwnerIndex = new Map<number, Classified[]>()
  for (const c of classified) {
    if (!c.foldedInto) continue
    const idx = ownerIndex.get(c.foldedInto.entityCode)
    if (idx === undefined) {
      warnings.push(
        `Sheet "${sheetName}": BU block "${c.run.buValue}" (${c.rowCount} rows) is attributed to ` +
          `${c.foldedInto.entityCode} by column "${c.foldedInto.viaHeader}", but that company has no ` +
          `block on this sheet — NOT imported.`,
      )
      delete c.foldedInto
      continue
    }
    const list = foldedRowsByOwnerIndex.get(idx) ?? []
    list.push(c)
    foldedRowsByOwnerIndex.set(idx, list)
    warnings.push(
      `Sheet "${sheetName}": BU block "${c.run.buValue}" (${c.rowCount} rows) is a management ` +
        `adjustment attributed to "${c.foldedInto.label}" by column "${c.foldedInto.viaHeader}" — ` +
        `folded into ${c.foldedInto.entityCode} (it is not an elimination and must not be dropped).`,
    )
  }

  // ── Pass 3: materialise the virtual worksheets ──────────────────────────
  const blocks: BuBlock[] = classified.map((c, i) => {
    const folded = foldedRowsByOwnerIndex.get(i) ?? []
    const blockRows = [
      ...aoa.slice(c.run.start, c.run.end + 1),
      ...folded.flatMap((f) => aoa.slice(f.run.start, f.run.end + 1)),
    ]
    return {
      buValue: c.run.buValue,
      entityCode: c.entityCode,
      ...(c.skipReason ? { skipReason: c.skipReason } : {}),
      ...(c.foldedInto ? { foldedInto: c.foldedInto } : {}),
      rowStart: c.run.start,
      rowEnd: c.run.end,
      rowCount: c.rowCount,
      ...(folded.length > 0
        ? {
            foldedFrom: folded.map((f) => ({
              buValue: f.run.buValue,
              rowCount: f.rowCount,
              viaHeader: f.foldedInto!.viaHeader,
            })),
          }
        : {}),
      worksheet: xlsx.utils.aoa_to_sheet([...preamble, ...blockRows]),
    }
  })

  return { buColumn: buCol, blocks, warnings }
}

export interface BuColumnSplitApplied {
  /** True iff the sheet was a consolidated multi-BU sheet and was split + removed. */
  applied: boolean
  sheetMapEntries: SheetMapEntry[]
  mapping: Array<{
    sheetName: string
    entityCode: string | null
    buValue: string
    rowCount: number
    action: "write" | "skip"
    reason?: "elimination" | "unknown_alias" | "adjustment"
    /** Set when an adjustment block's rows were folded into another block's
     *  sheet: `entityCode` is the owner and `action` is "write". */
    foldedInto?: { entityCode: string; viaHeader: string }
  }>
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
/**
 * 11.73 — how much MONEY a skipped block carries, so the warning about it is a
 * decision rather than a shrug.
 *
 * The skip messages have always named the row count, and a row count is the
 * wrong unit for this: "12 rows skipped" reads as housekeeping. Measured on
 * `actual-budget-v1.xlsx`, those rows are 1.08M on the actual P&L, 8.39M on
 * the budget P&L and 1.95B by absolute value on the balance sheet — present
 * in the file, absent from the database, and until now disclosed only as a
 * count. Excluding eliminations is correct; not saying what they weigh is not.
 *
 * Deliberately ABSOLUTE, and labelled as such at the call site. An elimination
 * block nets to roughly nothing by design, so a net total would report ~0 and
 * restate the invisibility it is meant to cure. The absolute sum answers the
 * only question a reader has here — "is this a rounding difference or a third
 * of the group?" — and answers nothing else.
 *
 * Returns null when the block has no resolvable 12-month header. Balance-sheet
 * blocks fall in that group; a made-up number for them would be worse than the
 * count they already get.
 */
function blockAbsoluteMagnitude(
  worksheet: XLSX.WorkSheet,
  xlsx: typeof XLSX,
): number | null {
  try {
    const aoa = xlsx.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: true,
      blankrows: false,
    }) as unknown[][]
    const header = findPlfHeaderRow(aoa)
    if (!header) return null
    let total = 0
    for (let r = header.row + 1; r < aoa.length; r++) {
      const row = aoa[r] ?? []
      for (const col of header.monthCols) {
        const v = row[col]
        if (typeof v === "number" && Number.isFinite(v)) total += Math.abs(v)
      }
    }
    return total > 0 ? total : null
  } catch {
    // A magnitude is a courtesy on top of a warning that already fires. It
    // must never be the reason a split throws.
    return null
  }
}

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
  const skipped = split.blocks.filter((b) => !b.entityCode)
  const distinct = new Set(resolved.map((b) => b.entityCode))
  // Need a genuine routing decision: either cross-entity writes, or at least one
  // write block plus skipped elimination/unknown blocks. The latter prevents a
  // raw CPC+EJE sheet from flowing downstream and writing EJE rows as CPC.
  if (
    split.blocks.length < 2 ||
    resolved.length < 1 ||
    (distinct.size < 2 && skipped.length === 0)
  ) {
    return out
  }

  // Pass 1 — materialise a sheet per entity block, remembering the sheet each
  // entity landed on so a folded adjustment can point at it (its rows are
  // already inside that sheet; see splitByBuColumn pass 2).
  const usedNames = new Set<string>(workbook.SheetNames)
  const sheetNameByBlock = new Map<BuBlock, string>()
  const firstSheetByEntity = new Map<string, string>()
  /**
   * Phase 14.8 — the elimination block gets a sheet too, on a BALANCE SHEET.
   *
   * It stays entity-less: `dataType: "BS_ELIMINATIONS"` and no `entityCode`,
   * so nothing downstream can mistake it for a company's own position. The
   * handler writes it with `companyId: null, isElimination: true`, and only
   * the group-level balance-sheet read admits those rows.
   *
   * 2026-08-18 — and now the P&L too, which 14.8 deliberately left open.
   * Same shape, same reasoning: `PLF_ELIMINATIONS`, no `entityCode`, written
   * with `companyId: null, isElimination: true`, and taken by the group P&L
   * read only. The gap it closes is measurable on the client's own file —
   * consolidated EBITDA 271,160 against the workbook's own 255,942, because
   * the block that nets 15,218 of intercompany result out of the four
   * entities was dropped here.
   *
   * Still only ONE such block per sheet: two would each clean-slate the
   * other's rows — the write path resets per (plan × scope × year) once per
   * sheet, which is the 2026-06-11 collateral-wipe shape — so that case falls
   * through to the old skip-with-a-warning path, which is what it got before
   * this existed.
   *
   * `isIntragroupEliminationBuValue` and NOT `skipReason === "elimination"`.
   * `skipReason` comes from `isEliminationLikeEntityValue`, which answers "is
   * this not a company?" and therefore also matches `CONSOLIDATED` — a block
   * of the group's TOTALS, the arithmetic opposite of an elimination. Feeding
   * that to the elimination writer would add a whole second balance sheet to
   * the group instead of subtracting the intercompany balances, and the
   * parser's `A + L + E = 0` gate would wave it through, because a
   * consolidated balance sheet balances too.
   */
  const eliminationBlocks =
    dataType === "BS" || dataType === "PLF"
      ? split.blocks.filter(
          (b) =>
            !b.entityCode &&
            b.skipReason === "elimination" &&
            isIntragroupEliminationBuValue(b.buValue),
        )
      : []
  const eliminationBlock = eliminationBlocks.length === 1 ? eliminationBlocks[0] : null
  if (eliminationBlocks.length > 1) {
    out.warnings.push(
      `Sheet "${sheetName}": ${eliminationBlocks.length} elimination blocks — importing them would ` +
        `have each one clean-slate the other's rows, so none is imported. Merge them into one block ` +
        `in the workbook to load the group's eliminations.`,
    )
  }
  for (const block of split.blocks) {
    if (block === eliminationBlock) {
      let elimName = `${sheetName} [ELIMINATIONS]`
      let e = 2
      while (usedNames.has(elimName)) elimName = `${sheetName} [ELIMINATIONS] #${e++}`
      usedNames.add(elimName)
      sheetNameByBlock.set(block, elimName)
      workbook.Sheets[elimName] = block.worksheet
      workbook.SheetNames.push(elimName)
      out.sheetMapEntries.push({
        match: elimName,
        dataType: dataType === "PLF" ? "PLF_ELIMINATIONS" : "BS_ELIMINATIONS",
        ...(planKind ? { planKind } : {}),
        role: "source",
        // No entityCode, deliberately. See the note above.
      })
      out.mapping.push({
        sheetName: elimName,
        entityCode: null,
        buValue: block.buValue,
        rowCount: block.rowCount,
        action: "write",
        reason: "elimination",
      })
      out.warnings.push(
        `Sheet "${sheetName}": BU block "${block.buValue}" (${block.rowCount} rows) is the group's ` +
          `intragroup-elimination block — imported as eliminations, belonging to no company. ` +
          `The group ${dataType === "PLF" ? "P&L" : "balance sheet"} is consolidated with it; ` +
          `each company's own ${dataType === "PLF" ? "result" : "sheet"} excludes it.`,
      )
      continue
    }
    if (!block.entityCode) continue
    let newName = `${sheetName} [${block.entityCode}]`
    let n = 2
    while (usedNames.has(newName)) newName = `${sheetName} [${block.entityCode}] #${n++}`
    usedNames.add(newName)
    sheetNameByBlock.set(block, newName)
    if (!firstSheetByEntity.has(block.entityCode)) {
      firstSheetByEntity.set(block.entityCode, newName)
    }

    workbook.Sheets[newName] = block.worksheet
    workbook.SheetNames.push(newName)
    out.sheetMapEntries.push({
      match: newName,
      dataType,
      ...(planKind ? { planKind } : {}),
      role: "source",
      entityCode: block.entityCode,
    })
  }

  // Pass 2 — the reviewer-facing mapping, in document order.
  for (const block of split.blocks) {
    // Already reported as a write in pass 1; it has a sheet but no entity, so
    // it would otherwise fall through to the skip branch and be listed twice —
    // once as imported and once as dropped.
    if (block === eliminationBlock) continue
    const written = sheetNameByBlock.get(block)
    if (written && block.entityCode) {
      out.mapping.push({
        sheetName: written,
        entityCode: block.entityCode,
        buValue: block.buValue,
        rowCount: block.rowCount,
        action: "write",
      })
      continue
    }
    if (block.foldedInto) {
      // Folded: the rows ARE written, under the owner's sheet. Reported as a
      // write so nobody reads the grid as "these rows were dropped" — the bug
      // this replaces was exactly that, silently.
      out.mapping.push({
        sheetName: firstSheetByEntity.get(block.foldedInto.entityCode) ?? sheetName,
        entityCode: block.foldedInto.entityCode,
        buValue: block.buValue,
        rowCount: block.rowCount,
        action: "write",
        foldedInto: {
          entityCode: block.foldedInto.entityCode,
          viaHeader: block.foldedInto.viaHeader,
        },
      })
      continue
    }
    // 11.73 — say what the skip COSTS, not just how many rows it touched.
    const magnitude = blockAbsoluteMagnitude(block.worksheet, xlsx)
    const weight =
      magnitude === null
        ? ""
        : `, ${magnitude.toLocaleString("en-US", { maximumFractionDigits: 0 })} by absolute value`
    const size = `${block.rowCount} rows${weight}`
    out.warnings.push(
      block.skipReason === "elimination"
        ? `Sheet "${sheetName}": BU block "${block.buValue}" (${size}) looks like elimination/consolidation — skipped (not imported). This is correct: an elimination belongs to no single entity. It does mean any holding-level total assembled from these companies is UN-ELIMINATED.`
        : block.skipReason === "adjustment"
          ? `Sheet "${sheetName}": BU block "${block.buValue}" (${size}) is a management adjustment with no resolvable owner — skipped (not imported)`
          : `Sheet "${sheetName}": BU block "${block.buValue}" (${size}) is not a known entity alias — skipped (not imported)`,
    )
    out.mapping.push({
      sheetName,
      entityCode: null,
      buValue: block.buValue,
      rowCount: block.rowCount,
      action: "skip",
      reason: block.skipReason ?? "unknown_alias",
    })
  }

  if (out.sheetMapEntries.length < 1) {
    // No virtual write sheet materialised (e.g. all blocks are unknown aliases)
    // — keep the raw sheet so the preview can surface the unresolved routing.
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
