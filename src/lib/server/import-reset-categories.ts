/**
 * Phase 11.76 (2026-07-31) — one vocabulary for "what gets deleted".
 *
 * The old surfaces each carried their OWN hardcoded list of tables: the import
 * panel's `BREAKDOWN_KEYS`, the preview's nine counts, the reset's eight
 * statements. They drifted, and the drift was invisible — `salesForecast` was
 * deleted by the route and counted by nobody, so the Sales tab went blank
 * after an operation whose preview never mentioned it.
 *
 * This module is deliberately dependency-free (no Prisma, no audit log) so the
 * request parsers, the counting path and the deleting path can all read the
 * same list without importing each other.
 */

/** Selectable kinds of data. `records` is the year-less Company.settings tail. */
export const IMPORT_RESET_CATEGORIES = [
  "budgetLine",
  "balanceSheetLine",
  "cashFlowEntry",
  "counterparty",
  "operationalFact",
  "budgetActual",
  "salesBudgetLine",
  "indicatorValue",
  "records",
] as const

export type ImportResetCategory = (typeof IMPORT_RESET_CATEGORIES)[number]

/**
 * Categories whose rows FEED indicator values. Deleting any of them without
 * also clearing `indicatorValue` leaves the terminal painting numbers derived
 * from rows that no longer exist — so the server forces it in. A UI courtesy
 * would be a UI bug waiting to happen; this is an invariant.
 */
export const INDICATOR_SOURCE_CATEGORIES: readonly ImportResetCategory[] = [
  "budgetLine",
  "balanceSheetLine",
  "cashFlowEntry",
  "counterparty",
  "operationalFact",
  "budgetActual",
  "salesBudgetLine",
]

/**
 * `IMPORT_SETTINGS_KEYS` grouped by what a reader would call them. The three
 * buckets are exhaustive over that constant (pinned by a test) so a new key
 * can never be deleted by the reset while being invisible in the preview.
 *
 * `dataPendingBanner` sits with the description bucket: it is the placeholder
 * text rendered in the company-description slot before real data arrives.
 */
export const IMPORT_RECORD_GROUPS = {
  recordsCompliance: ["courtDisputes", "auditFindings", "riskRegister"],
  recordsAssets: [
    "landParcels",
    "landTotalHectares",
    "landTotalAnnualRentAzn",
    "landRegistrySource",
    "capexInitiatives",
    "capexLastImportSource",
  ],
  recordsDescription: [
    "strategicDescription",
    "competitiveAdvantage",
    "strategicFullText",
    "strategicSource",
    "dataPendingBanner",
  ],
} as const satisfies Record<string, readonly string[]>

export type ImportRecordGroup = keyof typeof IMPORT_RECORD_GROUPS

/**
 * Which kinds of data an operation covers, and how wide.
 *
 * Every field is optional, and every default reproduces the pre-11.76
 * behaviour with two deliberate exceptions called out on the fields below:
 * the records tail is now year-gated, and hand-entered actuals are kept
 * unless explicitly asked for.
 */
export interface ImportResetSelection {
  /** Multiple calendar years. Wins over the single `year` when non-empty. */
  years?: number[]
  /** Category subset. Absent or empty = every category. */
  include?: readonly string[]
  /**
   * Gate for the year-less tail (the Company.settings records). Only
   * meaningful when NO year is scoped — a year-scoped delete never reaches
   * it, because those records carry no year of their own.
   */
  includeUnscoped?: boolean
  /**
   * Delete `BudgetActual` rows with `source: null` — the ones a human typed
   * in. Defaults to FALSE: no file brings them back, and the old reset took
   * them silently along with the imported ones.
   */
  includeManualActuals?: boolean
}

/** Normalise `year` / `years` into one ascending, de-duplicated list. */
export function normalizeResetYears(scope: {
  year?: number
  years?: number[]
}): number[] {
  const many = (scope.years ?? []).filter((n) => Number.isInteger(n))
  if (many.length > 0) return [...new Set(many)].sort((a, b) => a - b)
  return scope.year && Number.isInteger(scope.year) ? [scope.year] : []
}

/**
 * Resolve the requested categories. An unknown key is ignored rather than
 * throwing — a stale client must never be able to delete MORE than it named.
 * An empty or entirely-unknown list falls back to everything, which is what
 * every caller that omits `include` means.
 */
export function resolveResetCategories(
  include?: readonly string[] | null,
): Set<ImportResetCategory> {
  if (!include || include.length === 0) return new Set(IMPORT_RESET_CATEGORIES)
  const known = new Set<string>(IMPORT_RESET_CATEGORIES)
  const wanted = new Set<ImportResetCategory>(
    include.filter((k): k is ImportResetCategory => known.has(k)),
  )
  if (wanted.size === 0) return new Set(IMPORT_RESET_CATEGORIES)
  if (INDICATOR_SOURCE_CATEGORIES.some((c) => wanted.has(c))) wanted.add("indicatorValue")
  return wanted
}
