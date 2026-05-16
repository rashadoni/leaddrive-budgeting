/**
 * Phase 3.3 v1.2 — pure variance helpers extracted from
 * BudgetPnlDrillPanel. Two responsibilities:
 *
 * 1. `variance(plan, actual)` — computes `{abs, pct}` where
 *    `abs = actual - plan` and `pct = (abs / |plan|) * 100`. When
 *    plan === 0: pct = 100 if actual > 0, else 0 (no divide-by-zero).
 *
 * 2. `favorableSign(accountType)` — returns +1 if higher actual is
 *    favorable (revenue accounts), -1 otherwise (expense / cogs /
 *    opex / below-ebitda items). Multiplied against `variance.abs`
 *    before red/green threshold check so under-spent expense rows
 *    render GREEN (we saved money) rather than RED.
 *
 * Mirrors the favorable-direction logic in BudgetPnlView's
 * `renderSectionRows` (which passes an explicit `favorable: "down"`
 * prop for expense sections). The drill panel can't accept a prop
 * because rows arrive uniformly from /pnl route — accountType-based
 * inference is the correct contract.
 */

export interface Variance {
  abs: number
  pct: number
}

export function variance(plan: number, actual: number): Variance {
  const abs = actual - plan
  const pct = plan === 0 ? (actual === 0 ? 0 : 100) : (abs / Math.abs(plan)) * 100
  return { abs, pct }
}

/**
 * +1 for "higher is better" (revenue), -1 for "lower is better"
 * (expense / cogs / opex / below-ebitda / unknown). Caller uses this
 * to flip the sign of variance.abs before red/green coloring.
 *
 * Defensive default = -1 (treat unknown types as expense) because
 * misclassifying expense as revenue would paint cost-overruns green
 * — the more dangerous error.
 */
export function favorableSign(accountType: string): 1 | -1 {
  return accountType === "revenue" ? 1 : -1
}
