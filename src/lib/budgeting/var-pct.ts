/**
 * Pure helper extracted from `/budgeting/page.tsx` Workspace subtotal
 * rows (Gross Profit + Operating Profit Var % cells).
 *
 * Variance % = (actual − planned) / |planned| * 100
 *
 * The |planned| denominator is the load-bearing detail: with raw planned
 * in the denominator, a worse loss (planned=−2M, actual=−2.7M) flips the
 * sign of the ratio incorrectly. Math.abs(planned) preserves the
 * intuitive "more negative than plan = unfavorable" semantics.
 *
 * Returns null when planned is exactly zero (variance undefined). Callers
 * should render "—" or hide the cell rather than show a bogus number.
 */
export function varPct(actual: number, planned: number): number | null {
  if (planned === 0) return null;
  return ((actual - planned) / Math.abs(planned)) * 100;
}
