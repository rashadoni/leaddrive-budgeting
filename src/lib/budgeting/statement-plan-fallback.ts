/**
 * Balance-sheet source-plan resolution (Y4 decouple follow-up, 2026-06-04).
 *
 * Budget plans in this app carry ONLY the P&L (the İcmal budget is
 * P&L-only) — they have zero BalanceSheetLines. The balance sheet lives in
 * the matching-year kind="actual" plan. So when the budgeting page defaults
 * to (or the user is viewing) a budget plan, the Balance Sheet tab must read
 * the balance sheet from the same-year ACTUAL plan instead of rendering the
 * empty state. This mirrors the existing analytics "Y4" fallback where a
 * budget plan's ACTUAL side comes from the matching-year actuals plan.
 *
 * The Workspace tab is unaffected — it keeps using the budget plan (execution
 * % depends on it). This fallback is specific to the balance-sheet data view.
 */

export interface StatementPlanRef {
  id: string
  kind: string | null
}

export interface StatementSource {
  /** The planId whose BalanceSheetLines should be read. */
  sourcePlanId: string
  /** True when we redirected a budget plan's read to its actuals plan. */
  fellBack: boolean
}

/**
 * Decide which plan's balance-sheet rows to read.
 *
 * @param active                    the selected / defaulted plan
 * @param matchingYearActualsPlan   the same-year kind="actual" plan, or null
 *                                  (the caller looks this up only for budget
 *                                  plans, so it's null for actual plans)
 */
export function resolveBalanceSheetSourcePlan(
  active: StatementPlanRef,
  matchingYearActualsPlan: StatementPlanRef | null,
): StatementSource {
  if (
    active.kind === "budget" &&
    matchingYearActualsPlan &&
    matchingYearActualsPlan.id !== active.id
  ) {
    return { sourcePlanId: matchingYearActualsPlan.id, fellBack: true }
  }
  return { sourcePlanId: active.id, fellBack: false }
}
