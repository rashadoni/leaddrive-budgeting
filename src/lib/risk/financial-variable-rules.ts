/**
 * Manually-enterable FINANCIAL variables (balance-sheet / statement figures)
 * for the Indicator-Health inline-entry surface.
 *
 * Background
 * ----------
 * Some indicators are gappy not because an *operational* KPI is missing
 * (those are covered by `OPERATIONAL_METRIC_RULES` + `/api/operational-facts`)
 * but because a *financial* figure — e.g. period-end inventory — was never
 * imported. The figure lives in a financial statement table
 * (`BalanceSheetLine`), not the `OperationalFact` time-series, so it needs its
 * own validated write path.
 *
 * This registry maps a missing formula-input key (what the health scan reports,
 * e.g. `"balanceSheetLine.inventory"`) to the concrete row shape the recompute
 * resolver expects to read back. Writing a row that satisfies the spec makes the
 * dependent indicator compute on the next recompute — **no engine change**.
 *
 * Why a registry (not a hardcoded inventory path)
 * -----------------------------------------------
 * The same pattern generalizes to receivables, payables, cash, etc. — every
 * current/non-current asset or liability the resolvers read by name-match. New
 * variables are added as data, here, with no new endpoint or UI. We ship
 * `inventory` first as the proven template (its resolver is already live —
 * `balanceSheetLine.inventory`, Phase 7.O) and grow the catalog as gaps surface.
 *
 * Resolver contract (must stay in sync with
 * `recompute-resolvers-b.ts::balanceSheetLineResolver` +
 * `recompute-data-source.ts::listBalanceSheetLines`):
 *   - read where: organizationId, companyId, year=period.year, month=12
 *     (year-end snapshot), plan.kind="actual", deletedAt=null
 *   - filter: lineType==="asset" && subType==="current"
 *     && account.name matches the inventory heuristic && amount > 0
 * So a conforming write is: BalanceSheetLine{ lineType:"asset",
 * subType:"current", month:12, year, companyId, amount>0 } on a kind="actual"
 * plan, referencing a ChartOfAccount whose `name` satisfies the matcher
 * (`accountName` below is chosen to match — "Inventory" ⊃ "inventory").
 */
import type { ValidationMessage } from "./metric-validation-rules"

/** Which financial statement table a variable is written to. */
export type FinancialVariableModel = "balanceSheetLine"

export interface FinancialVariableRule {
  /** Stable key used in the API enum + UI (`"inventory"`). */
  variable: string
  /**
   * The BARE formula variable name as it appears in the indicator formula and,
   * crucially, in the runtime error the health scan parses: expr-eval throws
   * `"undefined variable: inventory"` for `cogs / inventory`, and
   * `extractMissingVariable` (health route) regexes out the bare `inventory`.
   * THIS is what reaches `resolveFinancialVariable` — so the matcher keys on it.
   */
  formulaVariable: string
  /**
   * The resolver INPUT contract key as declared in the seed's `requiredInputs`
   * (`"balanceSheetLine.inventory"`). Not what the scan emits at runtime, but
   * matched too for robustness (some code paths surface the qualified key).
   */
  requiredInputKey: string
  labelEn: string
  labelRu: string
  labelAz: string
  /** Display unit. Inventory is a monetary balance → currency (AZN by default). */
  unit: string
  /** Target statement table. */
  model: FinancialVariableModel
  // ── BalanceSheetLine shape the resolver filters on ──────────────────
  lineType: "asset" | "liability" | "equity"
  subType: "current" | "non_current"
  /** Canonical CoA code, find-or-created once per org for this variable. */
  accountCode: string
  /** CoA name — MUST satisfy the resolver's name matcher (see file header). */
  accountName: string
  // ── Validation bounds (pure, no DB) ─────────────────────────────────
  /** Hard minimum (inclusive). Below ⇒ rejected. */
  min: number
  /** Hard maximum (inclusive). Above ⇒ rejected. */
  max: number
  /** Soft lower bound — below ⇒ confirm-required warning, not rejection. */
  warnMin?: number
  /** Soft upper bound — above ⇒ confirm-required warning, not rejection. */
  warnMax?: number
  /** Indicator codes this variable unblocks (for the success message). */
  unlocksIndicators: string[]
  /**
   * True when the resolver only registers the value if it is strictly
   * positive (`amount > 0`). Entering 0 is then a no-op for the gap → the UI
   * warns. Inventory turns = cogs / inventory, so 0 ⇒ divide-by-zero anyway.
   */
  requiresPositive: boolean
}

/**
 * The catalog. Order is display order. Keep `requiredInputKey` exactly matching
 * the resolver input names in `seeds/*.ts` `requiredInputs`.
 */
export const FINANCIAL_VARIABLE_RULES: readonly FinancialVariableRule[] = [
  {
    variable: "inventory",
    formulaVariable: "inventory",
    requiredInputKey: "balanceSheetLine.inventory",
    labelEn: "Inventory (period-end)",
    labelRu: "Запасы (на конец года)",
    labelAz: "Anbar ehtiyatları (il sonu)",
    unit: "AZN",
    model: "balanceSheetLine",
    lineType: "asset",
    subType: "current",
    // Resolver ignores the code and matches on name; "Inventory" ⊃ "inventory".
    accountCode: "BS.ASSET.INVENTORY",
    accountName: "Inventory",
    min: 0,
    // 100B AZN — a finite sanity ceiling far above any real holding balance.
    max: 100_000_000_000,
    // 10B AZN — soft warn; a single company's inventory above this is unusual.
    warnMax: 10_000_000_000,
    unlocksIndicators: ["FP_INVENTORY_TURNS"],
    requiresPositive: true,
  },
]

/** All variable keys — used to build the API's Zod enum. */
export const FINANCIAL_VARIABLE_KEYS: readonly string[] =
  FINANCIAL_VARIABLE_RULES.map((r) => r.variable)

/** Look up a rule by its `variable` key. */
export function getFinancialVariableRule(
  variable: string,
): FinancialVariableRule | undefined {
  return FINANCIAL_VARIABLE_RULES.find((r) => r.variable === variable)
}

/**
 * Resolve a missing formula variable (as reported by the health scan) to the
 * financial-variable rule that fills it, or `undefined` when none applies.
 *
 * Matches the BARE formula variable (`"inventory"`, what
 * `extractMissingVariable` actually emits at runtime) OR the qualified resolver
 * input key (`"balanceSheetLine.inventory"`, the seed declaration) — so the
 * inline form attaches whichever string a given code path surfaces. Direct
 * match only; derived/feed-backed inputs are not hand-enterable here.
 */
export function resolveFinancialVariableByInput(
  missingVar: string | null,
): FinancialVariableRule | undefined {
  if (!missingVar) return undefined
  return FINANCIAL_VARIABLE_RULES.find(
    (r) => r.formulaVariable === missingVar || r.requiredInputKey === missingVar,
  )
}

export interface FinancialValueCheck {
  ok: boolean
  /** English sentences — logs + non-localized callers. */
  errors: string[]
  warnings: string[]
  /** Translatable twins, index-aligned with `errors` / `warnings`.
   *  Keys resolve under `adminIndicatorHealth.validation.*`. */
  errorMessages: ValidationMessage[]
  warningMessages: ValidationMessage[]
}

/**
 * Pure validation of a candidate value against a rule. No DB, no I/O — safe to
 * unit-test and to call client-side for live feedback. Mirrors the
 * `validateValue` semantics used for operational facts: hard bounds → errors
 * (reject); soft bounds / non-positive-but-required → warnings (confirm-gate).
 */
export function validateFinancialValue(
  rule: FinancialVariableRule,
  value: number,
): FinancialValueCheck {
  const errors: string[] = []
  const warnings: string[] = []
  const errorMessages: ValidationMessage[] = []
  const warningMessages: ValidationMessage[] = []

  if (!Number.isFinite(value)) {
    errors.push("Value must be a finite number")
    errorMessages.push({ key: "notFinite" })
    return { ok: false, errors, warnings, errorMessages, warningMessages }
  }
  if (value < rule.min) {
    errors.push(`Value ${value} is below the minimum ${rule.min}`)
    errorMessages.push({ key: "belowMin", params: { value, min: rule.min } })
  }
  if (value > rule.max) {
    errors.push(`Value ${value} is above the maximum ${rule.max}`)
    errorMessages.push({ key: "aboveMax", params: { value, max: rule.max } })
  }
  if (errors.length > 0) {
    return { ok: false, errors, warnings, errorMessages, warningMessages }
  }

  if (rule.warnMin != null && value < rule.warnMin) {
    warnings.push(`Value ${value} is unusually small (below ${rule.warnMin})`)
    warningMessages.push({
      key: "unusuallySmall",
      params: { value, warnMin: rule.warnMin },
    })
  }
  if (rule.warnMax != null && value > rule.warnMax) {
    warnings.push(`Value ${value} is unusually large (above ${rule.warnMax})`)
    warningMessages.push({
      key: "unusuallyLarge",
      params: { value, warnMax: rule.warnMax },
    })
  }
  if (rule.requiresPositive && value <= 0) {
    warnings.push(
      "A value of 0 will not unlock the indicator (the formula needs a positive balance)",
    )
    warningMessages.push({ key: "zeroDoesNotUnlock" })
  }

  return { ok: true, errors, warnings, errorMessages, warningMessages }
}
