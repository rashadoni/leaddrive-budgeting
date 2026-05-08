/**
 * Phase 7.G Turn LXV — canonical Excel-import keyword + regex catalog.
 *
 * Closes ROADMAP Phase 2.2 sub-item 1 ("Create `lib/import/keywords.ts`
 * with mapping table") + sub-item 3 ("Remove inline regex `/^7\d{2}-/`
 * from business logic"). Pre-LXV state: SAP-code regexes + AZ section-
 * header strings were scattered as inline literals across 3 routes:
 *   - `import-excel/route.ts:672` — `/^7\d{2}-/` cost-account prefix
 *   - `import-excel/route.ts:680, 681, 659, 660` — section header
 *     content matchers (xərc mərkəzi, qeyri-xammal, xammal xərcləri,
 *     etc.)
 *   - `pnl/route.ts:157, 283` — `/^\d{3}/` 3-digit prefix check
 *     (inline `looksLikeCode` lambda × 2 sites)
 *   - `analytics/route.ts:394` — `/^\d{3}(-\d+)*$/` full SAP-code
 *     shape (inline `looksLikeSapCode` lambda)
 *
 * Three subtly-different regex shapes are now named + documented:
 *   1. `SAP_CODE_PREFIX` — 3-digit prefix (loose match for "starts
 *      with a code-looking thing"; used by P&L row classification)
 *   2. `SAP_CODE_FULL` — full SAP code with optional dash-segments
 *      (strict match for "is a SAP code"; used by analytics dept-
 *      vs-code disambiguation)
 *   3. `COST_ACCOUNT_PREFIX` — specifically 7xx- cost accounts
 *      (used by import-excel parser to detect cost-account header
 *      cells)
 *
 * AZ section-header keywords are exported as lowercased constants —
 * callers compare with `.toLowerCase().includes(...)` or `===`. The
 * `LOWER` suffix on each constant signals the comparison contract.
 *
 * To add a new matcher:
 *   1. Add the const here with a doc-comment explaining what cell
 *      content it matches (so future translators know what to do).
 *   2. Update consumers + add a test case in `keywords.test.ts`.
 *
 * Phase 2.2 sub-item 2 (move ORG-SPECIFIC mappings to
 * `Organization.importConfig` JSON) is OUT OF SCOPE — these are the
 * AZMADE-shipped FO-Holding-canonical matchers. Org-specific overrides
 * land later when 2nd-customer onboarding surfaces a real difference.
 */

/** SAP code: 3-digit prefix (loose). Matches `601`, `703-A1`, etc. */
export const SAP_CODE_PREFIX = /^\d{3}/

/** SAP code: full shape with optional dash-segments. */
export const SAP_CODE_FULL = /^\d{3}(-\d+)*$/

/** Cost account: 7xx- prefix (e.g. `703-`, `711-`, `721-`). */
export const COST_ACCOUNT_PREFIX = /^7\d{2}-/

/** Predicate: is the string SAP-code-shaped (loose)? */
export function looksLikeCode(s: string): boolean {
  return SAP_CODE_PREFIX.test(s)
}

/** Predicate: is the string a fully-shaped SAP code? */
export function looksLikeSapCode(s: string): boolean {
  return SAP_CODE_FULL.test(s)
}

/** Predicate: does the string start with a 7xx- cost-account prefix? */
export function looksLikeCostAccount(s: string): boolean {
  return COST_ACCOUNT_PREFIX.test(s)
}

// ─── AZ section-header content matchers ─────────────────────────────
// All values are lowercased. Callers do `cellText.toLowerCase().includes(X)`.
// Source-of-truth: AZMADE Excel templates (Phase 7.B onboarding).

/** "Cost center" — section row header, exact-match (lowercased). */
export const HEADER_COST_CENTER_LOWER = "xərc mərkəzi"

/** "Non-raw-material" — prefix for indirect-cost section headers. */
export const HEADER_NON_RAW_MATERIAL_PREFIX_LOWER = "qeyri-xammal"

/** "Raw material costs" — prefix for raw-material section headers. */
export const HEADER_RAW_MATERIAL_PREFIX_LOWER = "xammal xərcləri"

/**
 * "Total" / "amount" — appears in roll-up rows (excluded from line
 * detail). Lowercased substring match.
 */
export const HEADER_TOTAL_LOWER = "cəmi"

/** "Amount" column header — used to identify monetary columns. */
export const COLUMN_AMOUNT_LOWER = "məbləğ"

/** "Quantity" column header. */
export const COLUMN_QUANTITY_LOWER = "miqdar"

/** "Price" column header. */
export const COLUMN_PRICE_LOWER = "qiymət"

/** Combined indirect-cost section indicators (production cost rows). */
export const INDIRECT_COST_KEYWORDS_LOWER: readonly string[] = [
  HEADER_NON_RAW_MATERIAL_PREFIX_LOWER + " xərclər", // "qeyri-xammal xərclər"
  "istehsal xərci", // "production cost"
]

/**
 * Predicate: does the lowercased label string match any indirect-cost
 * section indicator? Used by the import-excel parser to set
 * `currentSection = "indirect"`.
 */
export function isIndirectCostHeader(lowercasedLabel: string): boolean {
  return INDIRECT_COST_KEYWORDS_LOWER.some((kw) =>
    lowercasedLabel.includes(kw),
  )
}

/**
 * Predicate: does the lowercased label string match the raw-material
 * section header?
 */
export function isRawMaterialHeader(lowercasedLabel: string): boolean {
  return lowercasedLabel.includes(HEADER_RAW_MATERIAL_PREFIX_LOWER)
}
