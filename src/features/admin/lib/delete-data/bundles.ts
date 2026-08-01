/**
 * The three plain-language answers to "what exactly?", and the category list
 * each one means.
 *
 * The owner asked for «удалить что именно» — a choice, not a mystery. Three
 * bundles carry the common cases without a nine-checkbox wall; the "choose
 * exactly" disclosure behind them answers the question literally.
 */
import type { ImportResetCategory } from "@/lib/server/import-reset-categories"

export type BundleId = "everything" | "statements" | "operational"

/**
 * `records` is absent from every bundle on purpose: those rows carry no year,
 * so a year-scoped delete cannot reach them (the server enforces this too).
 * Removing them is Task B and Task D, where the copy says so out loud.
 */
export const BUNDLES: Record<BundleId, ImportResetCategory[]> = {
  everything: [
    "budgetLine",
    "balanceSheetLine",
    "cashFlowEntry",
    "counterparty",
    "operationalFact",
    "budgetActual",
    "salesBudgetLine",
    "indicatorValue",
  ],
  statements: [
    "budgetLine",
    "balanceSheetLine",
    "cashFlowEntry",
    "counterparty",
    "indicatorValue",
  ],
  operational: ["operationalFact", "budgetActual", "indicatorValue"],
}

/** The categories offered as individual tick-boxes under "Choose exactly". */
export const PICKABLE_CATEGORIES: ImportResetCategory[] = [
  "budgetLine",
  "balanceSheetLine",
  "cashFlowEntry",
  "counterparty",
  "operationalFact",
  "budgetActual",
  "salesBudgetLine",
]

/**
 * Always included, never offered as a choice: indicator values are cleared
 * together with the data they are computed from, then rebuilt. The server
 * forces this too — the lock in the UI is there so the operator understands
 * it rather than discovers it.
 */
export const ALWAYS_INCLUDED: ImportResetCategory = "indicatorValue"

/** Which preview keys a chosen category is counted under. */
export const CATEGORY_PREVIEW_KEYS: Record<string, string[]> = {
  budgetLine: ["budgetLine", "orphanBudgetLine"],
  balanceSheetLine: ["balanceSheetLine"],
  cashFlowEntry: ["cashFlowEntry"],
  counterparty: ["counterparty"],
  operationalFact: ["operationalFact"],
  budgetActual: ["budgetActualImported", "budgetActualManual"],
  salesBudgetLine: ["salesBudgetLine", "salesForecast"],
  indicatorValue: ["indicatorValue"],
}
