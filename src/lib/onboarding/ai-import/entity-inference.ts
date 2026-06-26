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

/** Which deterministic signal resolved an otherwise-null entity. */
export type EntityInferenceSource =
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
    if (alias) map[alias.toUpperCase()] = code
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
