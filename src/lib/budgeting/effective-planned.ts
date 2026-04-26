/**
 * Pure helper extracted from `/api/budgeting/analytics` route's
 * `getEffectivePlanned`. Encapsulates the Turn-29 Bug #1b defensive
 * fallback semantics so they're unit-testable without the full route
 * scaffold (prisma + cost model + sales/expense forecasts).
 *
 * Contract:
 *   - line.isAutoPlanned === false → return line.plannedAmount (literal)
 *   - line.isAutoPlanned === true → call computeFn; if it returns 0 AND
 *     line.plannedAmount > 0, fall back to plannedAmount
 *   - line.isAutoPlanned === true + compute > 0 → return computed
 *
 * The fallback prevents silent zeroing when a line is flagged auto-planned
 * but the upstream sources (cost model / forecasts) are empty — exactly
 * the AZMADE original-sin scenario where 568 BudgetLines persisted as
 * `isAutoPlanned: true` while no SalesForecast/ExpenseForecast/cost-model
 * data existed, and the entire /budgeting hub showed 0 ₼ despite 492M ₼
 * of literal plannedAmount values in DB.
 */

export interface EffectivePlannedInput {
  isAutoPlanned: boolean;
  plannedAmount: number;
}

export type ComputePlannedFn<L extends EffectivePlannedInput> = (line: L) => number;

export function getEffectivePlanned<L extends EffectivePlannedInput>(
  line: L,
  computeFn: ComputePlannedFn<L>,
): number {
  if (line.isAutoPlanned) {
    const computed = computeFn(line);
    if (computed === 0 && line.plannedAmount > 0) {
      return line.plannedAmount;
    }
    return computed;
  }
  return line.plannedAmount;
}
