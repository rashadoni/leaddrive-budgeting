const ELIMINATION_ENTITY_RE =
  /\b(eje|aje|elim|elimination|eliminasiya|intercompany|intragroup|consolidation|consolidated|consol)\b/i

/**
 * The ADJUSTMENT subset of the elimination-like labels (11.83).
 *
 * A management adjustment (AJE / ADJ) is not a standalone operating company —
 * so `isEliminationLikeEntityValue` must keep returning true for it and every
 * caller asking "is this a company?" must keep saying no. But unlike a true
 * elimination it BELONGS to one: it adjusts a real entity's own numbers, and
 * the workbook's parent BU column names which. A splitter that can read that
 * column folds the block into its owner instead of dropping it; see
 * `bu-adjustment.ts` for the rule and the 1,677,015 AZN it recovers.
 *
 * Deliberately narrow, and matched the way `looksLikeEliminationBU` matches:
 * short codes EXACTLY (so "ADJ" is an adjustment but "ADJARA" is a company),
 * descriptive long forms as a substring, multilingual (EN/RU/AZ).
 */
const ADJUSTMENT_EXACT = new Set(["AJE", "ADJ", "MJE", "TB ADJ"])
const ADJUSTMENT_PHRASE_RE =
  /adjustment|adjusting entry|management entry|корректировк|поправк|düzəliş|duzelis/i

export function normalizeEntityAlias(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase()
}

export function isEliminationLikeEntityValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  const normalized = normalizeEntityAlias(String(value))
  return normalized.length > 0 && ELIMINATION_ENTITY_RE.test(normalized)
}

/**
 * True for a management-adjustment block label (AJE / ADJ / …). Such a label
 * is ALSO elimination-like — the two predicates are a subset relation, not a
 * partition — but it is the only one that can be folded into a real company.
 */
export function isAdjustmentEntityValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  const normalized = normalizeEntityAlias(String(value))
  if (normalized.length === 0) return false
  if (ADJUSTMENT_EXACT.has(normalized)) return true
  return ADJUSTMENT_PHRASE_RE.test(normalized)
}
