import type { BudgetPlan } from "./types"

/**
 * Choose the default plan for the budgeting Workspace when the user hasn't
 * explicitly picked one.
 *
 * The Workspace's "исполнение %" (execution) is only meaningful on a
 * kind="budget" plan — there the PLAN side is the budget and the ACTUAL side
 * comes from the matching-year actuals plan (analytics Y4 fallback). On a
 * kind="actual" plan there is no separate budget to compare, so execution
 * reads 0% / N/A.
 *
 * Priority:
 *   1. a POPULATED plan of the preferred kind, newest year first,
 *   2. else any populated plan, newest year first,
 *   3. else the first plan (list arrives populated-first from the API).
 *
 * This avoids landing the user on an empty placeholder year-plan, which is
 * what produced the "0% / empty workspace" complaint.
 *
 * `preferKind` defaults to "budget" — the Workspace's original need, since
 * execution % is only meaningful there. The Report Builder passes "actual"
 * for its realized-figure sources (owner decision 2026-08-05: the plan picker
 * defaults to the newest plan of the right kind instead of "All plans", which
 * summed every plan of every year into one figure).
 */
export function pickDefaultPlanId(
  plans: BudgetPlan[],
  preferKind: "budget" | "actual" = "budget",
): string {
  const populated = plans.filter((p) => (p._count?.lines ?? 0) > 0)
  const preferred = populated
    .filter((p) => p.kind === preferKind)
    .sort((a, b) => b.year - a.year)[0]
  if (preferred) return preferred.id
  const newestPopulated = [...populated].sort((a, b) => b.year - a.year)[0]
  return (newestPopulated ?? plans[0])?.id ?? ""
}
