/**
 * Adjustment blocks: the half of the BU skip-list that was never an
 * elimination (Phase 11.83, 2026-08-01).
 *
 * Why this exists
 * ───────────────
 * A consolidated statement with a business-unit column carries blocks that are
 * NOT operating companies. Two kinds were treated as one:
 *
 *   EJE  — an intragroup ELIMINATION. It cancels trade between group members.
 *          It belongs to no company, and pushing it into one would corrupt that
 *          company's statements. Skipping it is correct.
 *   AJE  — a management ADJUSTMENT to a real entity's own numbers. It belongs
 *          to exactly one company. Skipping it silently removes real cost.
 *
 * On `actual-budget-v1.xlsx` the AJE block of `PLF Budget 2026` is 394 rows
 * carrying a single leaf — `PLF.05.12.06` "Non-Recoverable VAT Expense",
 * −1,677,014.63 AZN — and dropping it made the group 1.68M more profitable
 * than the workbook says.
 *
 * The discriminator is IN THE FILE, not in the label
 * ──────────────────────────────────────────────────
 * These workbooks tag every row with a BU hierarchy (`BU`, `BU_1` … `BU_4`).
 * The entity column is the LEAF of that hierarchy; the other columns name the
 * parents. Read them for the AJE block and the answer is written down:
 *
 *   PLF Budget 2026  BU_3 = AJE   → BU_1 = EDEN   (all 394 rows)
 *   PLF Actual 2025  BU   = EJE   → BU_1 = EJE    (all 19 rows)
 *   PLF Actual 2026  BU   = EJE   → BU_2 = EJE    (all 41 rows)
 *   BS  Actual 2025  BU   = EJE   → BU_1 = EJE    (all 21 rows)
 *   BS  Actual 2026  BU   = EJE   → BU_2 = EJE    (all 31 rows)
 *
 * An elimination is its OWN parent — it rolls up to nothing. An adjustment
 * rolls up to a company, and the file names it. So the fold is not a guess
 * about what "AJE" means; it is the client's own hierarchy, the same species
 * of evidence as the `FS line_FO` taxonomy columns behind Phase 11.82.
 *
 * The arithmetic it has to satisfy (PLF.08, the sheet's own EBITDA row):
 *
 *   EDEN 11,962,639.82 + CPC 2,127,732.48 + AJE (−1,677,014.63)
 *     = 12,413,357.67 = PLF.08 for legal entity EDEN
 *
 * Folding AJE into AZSEKER-EDEN makes AZSEKER-EDEN + AZSEKER-CPC reproduce
 * that figure exactly. A pseudo-entity would not: it would need a Company row
 * that exists in no chart, would appear in the tree and heat map as a business
 * with no revenue and one cost, and would have to be remembered by every
 * consolidation. The workbook does not present AJE as an entity — it presents
 * it as a leaf of EDEN.
 *
 * Conservative by construction: a label that is elimination-like is NEVER
 * folded, even if a parent column names an entity, and an adjustment whose
 * parents are silent or contradictory is still skipped — loudly.
 *
 * Pure. No DB, no LLM, no workbook mutation.
 */
import { isAdjustmentEntityValue, isEliminationLikeEntityValue } from "./entity-alias-utils"

/** Any `BU` / `BU_1` … `BU_9` dimension header. */
const BU_DIMENSION_RE = /^BU(_\d+)?$/i

/** Rows from the top scanned for dimension headers when the caller says nothing. */
export const BU_DIMENSION_SCAN_ROWS = 6

export interface BuDimensionColumn {
  /** 0-based column index. */
  col: number
  /** 0-based row the header was found on. */
  headerRow: number
  /** Header text as written (e.g. "BU_1"). */
  header: string
}

/**
 * Every `BU` / `BU_N` dimension column in the header region, left to right.
 * The caller picks one as the entity column; the rest are candidate parents.
 */
export function findBuDimensionColumns(
  aoa: ReadonlyArray<ReadonlyArray<unknown>>,
  scanRows: number = BU_DIMENSION_SCAN_ROWS,
): BuDimensionColumn[] {
  const found: BuDimensionColumn[] = []
  const seen = new Set<number>()
  for (let r = 0; r < Math.min(scanRows, aoa.length); r++) {
    const row = aoa[r] ?? []
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      if (typeof v !== "string") continue
      const label = v.trim()
      if (!BU_DIMENSION_RE.test(label)) continue
      if (seen.has(c)) continue
      seen.add(c)
      found.push({ col: c, headerRow: r, header: label })
    }
  }
  return found.sort((a, b) => a.col - b.col)
}

export type AdjustmentOwner =
  | {
      ok: true
      /** Canonical company code the adjustment belongs to. */
      entityCode: string
      /** Header of the dimension column that named it (e.g. "BU_1"). */
      viaHeader: string
      /** The raw parent label as written in that column (e.g. "EDEN"). */
      label: string
    }
  | { ok: false; reason: string }

/**
 * Which company does an adjustment block belong to?
 *
 * Answered ONLY from the block's own parent dimension columns:
 *   • the label must be adjustment-like (AJE / ADJ / …). An elimination-like
 *     label is refused outright — an elimination has no owner by definition.
 *   • every row of the block must carry the SAME parent label in a candidate
 *     column (a block spanning two entities is not attributable).
 *   • that label must itself resolve to a known company, and must not be
 *     another elimination/adjustment marker.
 *   • when several columns qualify they must agree.
 *
 * Anything else returns `ok: false` with a reason the caller must surface —
 * a refusal here means the money stays out, so it may not be silent.
 */
export function resolveAdjustmentOwner(args: {
  /** The block's own BU label, e.g. "AJE". */
  buValue: string
  /** The block's data rows (full-width, original column positions). */
  blockRows: ReadonlyArray<ReadonlyArray<unknown>>
  /** Column the block was cut from — excluded from the candidates. */
  entityColumn: number
  /** All BU dimension columns on the sheet (`findBuDimensionColumns`). */
  dimensionColumns: readonly BuDimensionColumn[]
  /** Raw label → canonical company code, or null when unknown. */
  resolveEntity: (label: string) => string | null
}): AdjustmentOwner {
  const { buValue, blockRows, entityColumn, dimensionColumns, resolveEntity } = args

  // The gate is POSITIVE: only a recognised adjustment marker can be folded.
  // "AJE" is both adjustment-like and elimination-like (it is a journal entry
  // made at consolidation time) — the adjustment reading wins because the file
  // gives it an owner. "EJE", "ELIM", "CONSOLIDATED" never pass this line, so
  // no elimination is ever folded, whatever its parent column says.
  if (!isAdjustmentEntityValue(buValue)) {
    return { ok: false, reason: `"${buValue}" is not an adjustment marker` }
  }

  const candidates = dimensionColumns.filter((d) => d.col !== entityColumn)
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: "the sheet has no other BU dimension column to attribute it with",
    }
  }

  const qualified: Array<{ header: string; label: string; entityCode: string }> = []
  const rejections: string[] = []
  for (const cand of candidates) {
    const labels = new Set<string>()
    for (const row of blockRows) {
      const v = row[cand.col]
      if (v === null || v === undefined) continue
      const s = String(v).trim()
      if (s) labels.add(s.toUpperCase())
    }
    if (labels.size === 0) continue
    if (labels.size > 1) {
      rejections.push(`${cand.header} names ${labels.size} different parents`)
      continue
    }
    const label = [...labels][0]
    if (isEliminationLikeEntityValue(label) || isAdjustmentEntityValue(label)) {
      // Its own parent is another non-entity marker: nothing to attach to.
      continue
    }
    const entityCode = resolveEntity(label)
    if (!entityCode) {
      rejections.push(`${cand.header}="${label}" is not a known company`)
      continue
    }
    qualified.push({ header: cand.header, label, entityCode })
  }

  if (qualified.length === 0) {
    const detail = rejections.length > 0 ? ` (${rejections.join("; ")})` : ""
    return {
      ok: false,
      reason: `no BU dimension column attributes it to a known company${detail}`,
    }
  }
  const distinct = new Set(qualified.map((q) => q.entityCode))
  if (distinct.size > 1) {
    return {
      ok: false,
      reason: `BU dimension columns disagree about the owner (${qualified
        .map((q) => `${q.header}→${q.entityCode}`)
        .join(", ")})`,
    }
  }
  const winner = qualified[0]
  return {
    ok: true,
    entityCode: winner.entityCode,
    viaHeader: winner.header,
    label: winner.label,
  }
}
