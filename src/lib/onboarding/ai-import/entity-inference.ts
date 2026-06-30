/**
 * Deterministic entity auto-inference (2026-06-26).
 *
 * The LLM sheet-classifier assigns `entityCode` from sheet-NAME signals
 * ("PLF CPC" → AZSEKER-CPC) + the knownEntityCodes hint. When a financial
 * statement sheet carries NO entity signal in its name (e.g. "PLF Actual
 * 2025", "BS Actual 2025"), the classifier correctly returns `entityCode:
 * null` — the file genuinely doesn't say whose statement it is. That null is
 * what forces a human to pick the target entity in the wizard.
 *
 * This module squeezes every DETERMINISTIC signal still available AFTER
 * classification, so the manual pick approaches zero:
 *
 *   1. filename                — file named after an entity ("CPC.xlsx",
 *                                "Guvven-EDEN-2026.xlsx") → that entity.
 *   2. single-entity-propagation — if EVERY entity-bearing sheet in the
 *                                workbook resolves to ONE entity, the
 *                                entity-less statements belong to it too.
 *   3. holding-consolidated    — if the workbook spans ≥2 entities AND a
 *                                holding code is known, an entity-less P&L /
 *                                BS / CF is almost certainly the CONSOLIDATED
 *                                holding statement.
 *
 * CRITICAL — no silent corruption. Every inference is RETURNED as a separate
 * decision carrying `inferredBy` + a calibrated `confidence`, never folded
 * silently into a "certain" classification. The orchestrator surfaces these
 * for one-time review; template-memory then remembers the confirmed mapping
 * so the same file shape never asks again. The holding-consolidated rule is
 * deliberately LOW confidence (review-grade) because holding-vs-entity is a
 * genuine business judgment a human must confirm once.
 *
 * Pure function — no DB, no LLM, no global state. Fully unit-testable.
 */

import type { SheetDataType } from "./sheet-classifier"
import { hasMultiEntityBuColumn } from "./bu-column-split"
import {
  isEliminationLikeEntityValue,
  normalizeEntityAlias,
} from "./entity-alias-utils"
export { isEliminationLikeEntityValue, normalizeEntityAlias } from "./entity-alias-utils"

/** Which deterministic signal resolved an otherwise-null entity. */
export type EntityInferenceSource =
  | "cell-scan"
  | "header-scan"
  | "filename"
  | "single-entity-propagation"
  | "holding-consolidated"

/** Minimal per-sheet shape this module reads (decoupled from SheetClassification). */
export interface EntityInferenceSheet {
  sheetName: string
  dataType: SheetDataType
  entityCode: string | null
}

export interface EntityInferenceContext {
  /** Source filename (e.g. "Guvven Fin - CPC.xlsx"). */
  filenameHint?: string
  /** Canonical entity codes known for the org (e.g. ["AZSEKER-CPC", "AZSEKER-EDEN"]). */
  knownEntityCodes?: string[]
  /** Level-1 holding code, used by the holding-consolidated rule. */
  holdingCompanyCode?: string | null
  /**
   * Optional explicit alias → canonical-code map (UPPERCASE alias keys).
   * When absent, aliases are derived from each known code's trailing segment
   * (AZSEKER-EDEN → "EDEN") plus the full code itself.
   */
  aliases?: Record<string, string>
}

export interface EntityInferenceResult {
  sheetName: string
  entityCode: string
  inferredBy: EntityInferenceSource
  /** Calibrated 0..1. holding-consolidated is intentionally review-grade (<0.6). */
  confidence: number
  reasoning: string
}

/**
 * Financial STATEMENT types where an entity-less sheet forces a manual pick.
 * Sales / KPI / counterparty etc. already resolve entity from sheet content
 * or per-row attribution, so they're out of scope here.
 */
const STATEMENT_TYPES: ReadonlySet<SheetDataType> = new Set<SheetDataType>([
  "PLF",
  "BS",
  "CF",
])

/** Build an UPPERCASE alias → canonical-code lookup from known codes (+ explicit overrides). */
export function buildEntityAliasMap(
  knownEntityCodes: string[] = [],
  explicit: Record<string, string> = {},
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const code of knownEntityCodes) {
    if (!code) continue
    const upper = code.toUpperCase()
    // Full code is its own alias.
    map[upper] = code
    // Trailing segment after the last "-" (AZSEKER-EDEN → EDEN). Only when it
    // is ≥3 chars, to avoid noisy 1-2 letter tokens matching random filenames.
    const tail = upper.includes("-") ? upper.slice(upper.lastIndexOf("-") + 1) : ""
    if (tail.length >= 3 && !(tail in map)) map[tail] = code
  }
  // Explicit aliases win (caller knows the org's naming).
  for (const [alias, code] of Object.entries(explicit)) {
    const normalized = normalizeEntityAlias(alias)
    if (normalized) map[normalized] = code
  }
  return map
}

/** True when UPPERCASE `alias` appears as a whole token in UPPERCASE `haystack`. */
function aliasAppearsAsToken(haystack: string, alias: string): boolean {
  // Token boundary = start/end or any non-alphanumeric char. Prevents "CPC"
  // matching inside "CONCEPCION" while still matching "fin-cpc-2026".
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`).test(haystack)
}

/**
 * Infer entity codes for the entity-less financial statements in a classified
 * workbook. Returns ONLY the sheets it newly resolved (each with the signal +
 * confidence). Sheets that already carry an entity, non-statement sheets, and
 * genuinely unresolvable statements are left untouched / absent from the result.
 */
export function inferEntities(
  sheets: ReadonlyArray<EntityInferenceSheet>,
  ctx: EntityInferenceContext = {},
): EntityInferenceResult[] {
  const aliasMap = buildEntityAliasMap(ctx.knownEntityCodes ?? [], ctx.aliases ?? {})
  const filenameUpper = (ctx.filenameHint ?? "").toUpperCase()

  // Distinct entities already resolved across the WHOLE workbook (any dataType).
  const resolvedEntities = new Set<string>()
  for (const s of sheets) if (s.entityCode) resolvedEntities.add(s.entityCode)

  // Filename → single entity, if exactly one known alias matches the filename.
  let filenameEntity: string | null = null
  if (filenameUpper) {
    const hits = new Set<string>()
    for (const [alias, code] of Object.entries(aliasMap)) {
      if (aliasAppearsAsToken(filenameUpper, alias)) hits.add(code)
    }
    if (hits.size === 1) filenameEntity = [...hits][0]
  }

  const results: EntityInferenceResult[] = []

  for (const s of sheets) {
    if (s.entityCode) continue // already resolved
    if (!STATEMENT_TYPES.has(s.dataType)) continue // only PLF/BS/CF in scope

    // Rule 1 — filename (explicit, highest priority).
    if (filenameEntity) {
      results.push({
        sheetName: s.sheetName,
        entityCode: filenameEntity,
        inferredBy: "filename",
        confidence: 0.85,
        reasoning: `Filename "${ctx.filenameHint}" names entity ${filenameEntity} → entity-less ${s.dataType} assigned to it`,
      })
      continue
    }

    // Rule 2 — single-entity propagation.
    if (resolvedEntities.size === 1) {
      const only = [...resolvedEntities][0]
      results.push({
        sheetName: s.sheetName,
        entityCode: only,
        inferredBy: "single-entity-propagation",
        confidence: 0.8,
        reasoning: `Every entity-bearing sheet in this workbook resolves to ${only} → entity-less ${s.dataType} belongs to it`,
      })
      continue
    }

    // Rule 3 — holding-consolidated (workbook spans ≥2 entities). Review-grade.
    if (resolvedEntities.size >= 2 && ctx.holdingCompanyCode) {
      results.push({
        sheetName: s.sheetName,
        entityCode: ctx.holdingCompanyCode,
        inferredBy: "holding-consolidated",
        confidence: 0.55,
        reasoning: `Workbook spans ${resolvedEntities.size} entities; an entity-less ${s.dataType} is most likely the consolidated ${ctx.holdingCompanyCode} statement — confirm once`,
      })
      continue
    }

    // else: no deterministic signal — leave null for one-time manual pick.
  }

  return results
}

/**
 * Scan a sheet's cells for a dominant entity code/alias. Many client
 * statements (e.g. AzerSheker's PLF/BS) carry the owning entity as a repeated
 * code in a trailing data column ("CPC", "AZSF") the classifier never sees —
 * its meta only samples the first ~12 columns. This reads the FULL sheet and,
 * when ONE known alias appears as an exact cell value far more than any other,
 * returns it. Exact-cell-match (not substring) avoids product/customer names
 * coincidentally matching.
 */
export function scanDominantEntity(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  aliasMap: Record<string, string>,
  opts: { minCells?: number; dominanceRatio?: number } = {},
): { entityCode: string; matchedCells: number } | null {
  const minCells = opts.minCells ?? 3
  // The top entity must out-number the runner-up by at least this factor to be
  // accepted. >1 guards CONSOLIDATED multi-entity sheets: a sheet stacking
  // CPC+EDEN+holding blocks has several entities with comparable cell counts, so
  // the bare "strictly more" rule mis-collapsed the whole sheet onto whichever
  // block was marginally larger (EDEN beat the holding 1070 vs 1068 → a 4-entity
  // P&L silently routed to one child). Such sheets must NOT cell-scan-resolve —
  // they go through `bu-column-split.ts` (or a one-time manual pick) instead. A
  // genuine single-entity statement has secondN≈0, so 2× is easily cleared.
  const dominanceRatio = opts.dominanceRatio ?? 2
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const cell of row) {
      if (cell === null || cell === undefined) continue
      const v = String(cell).trim().toUpperCase()
      if (!v) continue
      const code = aliasMap[v]
      if (code) counts.set(code, (counts.get(code) ?? 0) + 1)
    }
  }
  if (counts.size === 0) return null
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const [topCode, topN] = sorted[0]
  const secondN = sorted[1]?.[1] ?? 0
  // Require a repeated AND clearly-dominant signal — enough matching cells AND
  // at least `dominanceRatio`× the runner-up (a near-tie ⇒ multi-entity ⇒ null).
  if (topN >= minCells && topN >= secondN * dominanceRatio) {
    return { entityCode: topCode, matchedCells: topN }
  }
  return null
}

/**
 * Scan the top header/title rows for a single entity alias. This catches files
 * where the owning company appears in a merged title/header ("CPC P&L 2026")
 * instead of repeated body cells. It requires exactly one resolved entity across
 * the header window; multi-company headers stay unresolved for review/BU split.
 */
export function scanHeaderEntity(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  aliasMap: Record<string, string>,
  opts: { maxRows?: number; minCells?: number } = {},
): { entityCode: string; matchedCells: number } | null {
  const maxRows = opts.maxRows ?? 6
  const minCells = opts.minCells ?? 1
  const counts = new Map<string, number>()
  for (let r = 0; r < Math.min(maxRows, rows.length); r++) {
    const row = rows[r] ?? []
    const first = row[0] === null || row[0] === undefined ? "" : normalizeEntityAlias(String(row[0]))
    if (/^(PLF|BS|CF)[.\-_]/.test(first)) continue
    for (const cell of row) {
      if (cell === null || cell === undefined) continue
      const text = normalizeEntityAlias(String(cell))
      if (!text || isEliminationLikeEntityValue(text)) continue
      const exact = aliasMap[text]
      if (exact) {
        counts.set(exact, (counts.get(exact) ?? 0) + 1)
        continue
      }
      const hits = new Set<string>()
      for (const [alias, code] of Object.entries(aliasMap)) {
        if (alias.length >= 3 && aliasAppearsAsToken(text, alias)) hits.add(code)
      }
      if (hits.size === 1) {
        const [code] = [...hits]
        counts.set(code, (counts.get(code) ?? 0) + 1)
      }
    }
  }
  if (counts.size !== 1) return null
  const [[entityCode, matchedCells]] = [...counts.entries()]
  if (matchedCells < minCells) return null
  return { entityCode, matchedCells }
}

/**
 * Resolve entity-less financial statements (PLF/BS/CF) by scanning each sheet's
 * cells for a dominant entity code. `getRows` yields the sheet's full rows
 * (header:1 shape). Returns the resolved sheets (header-scan/cell-scan source,
 * high confidence — exact-match dominance is a strong signal, safe to auto-apply).
 */
export function scanStatementEntities(
  sheets: ReadonlyArray<EntityInferenceSheet>,
  getRows: (sheetName: string) => ReadonlyArray<ReadonlyArray<unknown>>,
  aliasMap: Record<string, string>,
  opts: { minCells?: number } = {},
): EntityInferenceResult[] {
  const results: EntityInferenceResult[] = []
  for (const s of sheets) {
    if (s.entityCode) continue
    if (!STATEMENT_TYPES.has(s.dataType)) continue
    const rows = getRows(s.sheetName)
    // A consolidated sheet carrying a multi-entity "BU"/"BU_N" dimension column
    // must NEVER be collapsed onto its majority entity. The clean single-"BU"
    // case is already split per-entity upstream (bu-column-split); an
    // un-splittable multi-dimensional one (several disagreeing BU_N columns, e.g.
    // an entity×sub-unit budget) is left null here → adapter no-op → one-time
    // review, instead of a wrong single-entity write.
    if (hasMultiEntityBuColumn(rows, aliasMap)) continue
    const headerHit = scanHeaderEntity(rows, aliasMap)
    if (headerHit) {
      results.push({
        sheetName: s.sheetName,
        entityCode: headerHit.entityCode,
        inferredBy: "header-scan",
        confidence: 0.88,
        reasoning: `Entity ${headerHit.entityCode} read from ${headerHit.matchedCells} header/title cell(s)`,
      })
      continue
    }
    const hit = scanDominantEntity(rows, aliasMap, opts)
    if (hit) {
      results.push({
        sheetName: s.sheetName,
        entityCode: hit.entityCode,
        inferredBy: "cell-scan",
        confidence: 0.9,
        reasoning: `Entity ${hit.entityCode} read from ${hit.matchedCells} matching cells in the sheet`,
      })
    }
  }
  return results
}
