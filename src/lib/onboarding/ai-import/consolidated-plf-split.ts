/**
 * Consolidated PLF block splitter (2026-06-23).
 *
 * Why this exists
 * ───────────────
 * The AzerSheker "Reporting 2026.xlsx" `Budget PLF` tab is NOT a single
 * consolidated P&L — it is N **vertically-stacked per-entity blocks**, each a
 * full P&L tree (`PLF.01 REVENUE` … `PLF.10 NET PROFIT`, ~394 rows) that share
 * ONE 12-month header row at the top of the sheet. Every leaf code therefore
 * repeats once per block.
 *
 * The flat `parsePlfPlSheet` reads every leaf row regardless of block, and the
 * multi-file import routed the whole sheet to the single holding company — so
 * all blocks STACKED onto the holding (2057 rows / 1428 distinct cells) and
 * every operating entity's budget came out EMPTY. The consolidated SUM was
 * right (revenue 58.88M) but per-entity attribution was destroyed. This was the
 * recurring "delete → AI-import is always wrong" bug (see memory
 * project_budget_plf_five_blocks).
 *
 * What this does
 * ──────────────
 * Splits the sheet into one virtual worksheet PER BLOCK, each = the shared
 * preamble/header rows + that block's rows. Each virtual sheet then flows
 * through the EXISTING one-sheet→one-entity pipeline (per-entity write +
 * reconciliation + recompute) unchanged — `parsePlfPlSheet` finds the shared
 * header at the top of each virtual sheet and parses only that block's leaves.
 *
 * Entity attribution is the CALLER's job (config-driven). Block ORDER is not
 * stable across files (the legacy consolidated file was EDEN/AZSF/HORIZON/Farm/
 * CPC; Reporting 2026 is EDEN/AZSF/ProMalt/CPC/holding), so this module returns
 * each block's annual-revenue signature to let the caller map by config order
 * AND sanity-check the mapping. It never guesses the entity itself.
 */
import type * as XLSX from "xlsx"
import { toNumberOrNull } from "../adapters/azmade-sopl"
import {
  HOLDING_ENTITY_SENTINEL,
  type SheetMapEntry,
} from "./sheet-routing"

/** Top-of-P&L marker that starts each entity block. Exact col-A match. */
const BLOCK_START_CODE = "PLF.01"
/** Leaf revenue code (PLF.01.xx.xx) — summed for the per-block signature. */
const REVENUE_LEAF_RE = /^PLF\.01\.\d{2}\.\d{2}/

export interface PlfBlock {
  /** 0-based block index in document order. */
  blockIndex: number
  /** Inclusive AOA row range of the block's own rows (excludes the shared
   *  preamble), for diagnostics. */
  rowStart: number
  rowEnd: number
  /** Virtual worksheet = shared preamble (incl. the 12-month header) + this
   *  block's rows. Parses through `parsePlfPlSheet` exactly like a standalone
   *  per-entity PLF sheet. */
  worksheet: XLSX.WorkSheet
  /** Σ of the 12 month columns across this block's PLF.01.* revenue leaves —
   *  the distinctive signature the caller matches to a known entity. */
  revenueAnnual: number
}

export interface PlfSplitResult {
  /** One per detected block, in document order. A single-block sheet (an
   *  ordinary per-entity PLF) yields exactly one block — applying the splitter
   *  to such a sheet is a safe no-op-shaped passthrough. */
  blocks: PlfBlock[]
  warnings: string[]
}

/**
 * Detect the 12-month column indices from the sheet's header region: the first
 * row carrying ≥12 ascending Excel date serials (a month header). Returns [] if
 * none — the caller treats that as "not a block sheet".
 */
function findMonthCols(aoa: unknown[][]): number[] {
  for (const row of aoa.slice(0, 12)) {
    const cols: number[] = []
    for (let c = 0; c < (row?.length ?? 0); c++) {
      const v = row[c]
      // Excel date serials for 2020-01..2050-12 fall in ~43831..55153.
      if (typeof v === "number" && v >= 43000 && v <= 56000) cols.push(c)
    }
    if (cols.length >= 12) return cols.slice(0, 12)
  }
  return []
}

/**
 * Split a consolidated multi-block PLF worksheet into per-block virtual sheets.
 *
 * Block boundary rule: a new block begins at every row whose col-A is exactly
 * `PLF.01` (the REVENUE top of a P&L). Everything before the first such row is
 * the shared preamble (the 12-month header lives here) and is prepended to every
 * virtual sheet so `parsePlfPlSheet` can resolve the header on each.
 */
export function splitConsolidatedPlfBlocks(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
): PlfSplitResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return { blocks: [], warnings: [`Sheet "${sheetName}" not found`] }
  }
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown[][]

  const colA = (r: number): string => {
    const v = aoa[r]?.[0]
    return typeof v === "string" ? v.trim() : ""
  }

  // Block start rows (exact PLF.01).
  const starts: number[] = []
  for (let r = 0; r < aoa.length; r++) {
    if (colA(r) === BLOCK_START_CODE) starts.push(r)
  }
  if (starts.length === 0) {
    return {
      blocks: [],
      warnings: [`Sheet "${sheetName}": no PLF.01 block-start row found`],
    }
  }

  // Shared preamble = everything above the first block (the header row + any
  // flags/blank rows). Prepended to every virtual sheet.
  const preamble = aoa.slice(0, starts[0])
  const monthCols = findMonthCols(aoa)
  const warnings: string[] = []
  if (monthCols.length < 12) {
    warnings.push(
      `Sheet "${sheetName}": fewer than 12 month columns detected in the header — revenue signatures may be unreliable`,
    )
  }

  const blocks: PlfBlock[] = []
  for (let i = 0; i < starts.length; i++) {
    const rowStart = starts[i]
    const rowEnd = (i + 1 < starts.length ? starts[i + 1] : aoa.length) - 1
    const blockRows = aoa.slice(rowStart, rowEnd + 1)

    // Annual revenue signature: Σ month cols over PLF.01.* leaves in this block.
    let revenueAnnual = 0
    for (const row of blockRows) {
      const code = typeof row?.[0] === "string" ? (row[0] as string).trim() : ""
      if (!REVENUE_LEAF_RE.test(code)) continue
      for (const c of monthCols) {
        const n = toNumberOrNull(row[c])
        if (n != null) revenueAnnual += n
      }
    }

    const worksheet = xlsx.utils.aoa_to_sheet([...preamble, ...blockRows])
    blocks.push({
      blockIndex: i,
      rowStart,
      rowEnd,
      worksheet,
      revenueAnnual: Math.round(revenueAnnual * 100) / 100,
    })
  }

  return { blocks, warnings }
}

export interface BudgetPlfSplitApplied {
  /** True iff the sheet was split into virtual per-entity sheets and the raw
   *  sheet was removed from the workbook. False = workbook untouched; caller's
   *  fallback (skip the raw `Budget PLF` as derived) applies. */
  applied: boolean
  /** Deterministic sheet-map entries for the virtual sheets (each pins
   *  dataType=PLF, planKind=budget, role=source, entityCode=<resolved code>). */
  sheetMapEntries: SheetMapEntry[]
  /** Human-readable block→entity assignment for the import report. */
  mapping: Array<{ sheetName: string; entityCode: string; revenueAnnual: number }>
  warnings: string[]
}

/**
 * Split a consolidated multi-block `Budget PLF` into one virtual per-entity
 * worksheet each, MUTATING the workbook: each block becomes a new sheet
 * `Budget PLF [<CODE>]`, and the raw consolidated sheet is removed so the
 * existing one-sheet→one-entity pipeline handles each block as its own entity.
 *
 * SAFETY: the split only applies when the detected block count EXACTLY equals
 * `blockEntityCodes.length` — a reshaped file (different entity count/order)
 * aborts with `applied:false` + a warning, so the raw sheet falls through to the
 * "skip as derived" fallback rather than silently mis-mapping budgets. Block
 * order is the only in-file signal (no per-block entity label exists), so the
 * caller's `blockEntityCodes` is the authority; `HOLDING_ENTITY_SENTINEL` is
 * resolved to `holdingCompanyCode` (a block that maps to the holding when none
 * is resolved is skipped with a warning, never mis-attributed).
 */
export function applyBudgetPlfSplit(
  workbook: XLSX.WorkBook,
  xlsx: typeof XLSX,
  opts: {
    sheetName?: string
    blockEntityCodes: readonly string[]
    holdingCompanyCode?: string
  },
): BudgetPlfSplitApplied {
  const sheetName = opts.sheetName ?? "Budget PLF"
  const { blocks, warnings } = splitConsolidatedPlfBlocks(workbook, sheetName, xlsx)
  const out: BudgetPlfSplitApplied = {
    applied: false,
    sheetMapEntries: [],
    mapping: [],
    warnings: [...warnings],
  }
  if (blocks.length === 0) return out

  if (blocks.length !== opts.blockEntityCodes.length) {
    out.warnings.push(
      `"${sheetName}" split aborted: detected ${blocks.length} block(s) but the configured map expects ${opts.blockEntityCodes.length} ` +
        `(${opts.blockEntityCodes.join(", ")}). The raw sheet is skipped (not imported) to avoid mis-mapping budgets — review the file shape / update REPORTING_PACK_BUDGET_PLF_BLOCK_ENTITIES.`,
    )
    return out
  }

  const sheetMapEntries: SheetMapEntry[] = []
  const mapping: BudgetPlfSplitApplied["mapping"] = []
  for (let i = 0; i < blocks.length; i++) {
    const configured = opts.blockEntityCodes[i]
    const entityCode =
      configured === HOLDING_ENTITY_SENTINEL ? opts.holdingCompanyCode : configured
    if (!entityCode) {
      out.warnings.push(
        `"${sheetName}" block #${i + 1} (rev ${blocks[i].revenueAnnual}) maps to the holding sentinel but no holding company was resolved — block skipped (not imported).`,
      )
      continue
    }
    const newName = `Budget PLF [${entityCode}]`
    // Add the virtual sheet to the workbook.
    workbook.Sheets[newName] = blocks[i].worksheet
    if (!workbook.SheetNames.includes(newName)) workbook.SheetNames.push(newName)
    sheetMapEntries.push({
      match: newName,
      dataType: "PLF",
      planKind: "budget",
      role: "source",
      entityCode,
    })
    mapping.push({
      sheetName: newName,
      entityCode,
      revenueAnnual: blocks[i].revenueAnnual,
    })
  }

  // Remove the raw consolidated sheet so it isn't classified/written again.
  delete workbook.Sheets[sheetName]
  workbook.SheetNames = workbook.SheetNames.filter((n) => n !== sheetName)

  out.applied = sheetMapEntries.length > 0
  out.sheetMapEntries = sheetMapEntries
  out.mapping = mapping
  return out
}
