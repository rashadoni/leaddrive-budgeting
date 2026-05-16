/**
 * Phase 3.1 v1.2 (Turn LIX v1.2) — pure helper for deriving 0-indexed
 * month from a freeform expense-date string. Mirrors the shape of
 * BudgetLine.monthIndex (0=Jan..11=Dec) so analytics aggregation can
 * bucket actuals per month for the VarianceTab sparkline overlay.
 *
 * Inputs accepted:
 *   - "YYYY-MM-DD" or "YYYY-M-D" (ISO date)
 *   - "YYYY/MM/DD" or "YYYY/M/D" (slash separator)
 *   - "YYYY-MM" (year-month only)
 *
 * Anything else returns null — caller decides fallback behaviour
 * (e.g. skip from sparkline, bucket as Jan, etc.). Returning null
 * is the explicit signal that we couldn't derive the month, not
 * "month 0".
 */
export function deriveMonthIndex(expenseDate: string | null | undefined): number | null {
  if (!expenseDate || typeof expenseDate !== "string") return null
  const m = expenseDate.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?/)
  if (!m) return null
  const month = parseInt(m[2], 10)
  if (!Number.isFinite(month) || month < 1 || month > 12) return null
  return month - 1
}
