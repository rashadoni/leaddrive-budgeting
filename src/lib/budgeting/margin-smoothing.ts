/**
 * Management-view smoothing for the Margin Trends chart.
 *
 * Background: AZ SAP bookkeeping practice often books annual non-operating
 * items (FX losses, interest, extraordinary expenses, taxes, year-end
 * D&A true-ups) as a single monthly entry rather than spreading them
 * across the year. This produces a verbatim-but-misleading monthly
 * trend chart where one month carries 100% of an annual item, distorting
 * the period margin %.
 *
 * Professional FP&A presentation smooths these for a "Management view"
 * while keeping YTD totals identical and the original "Bookkeeping view"
 * available as a toggle.
 *
 * Heuristic: if any single month carries ≥ LUMP_THRESHOLD_PCT of the
 * absolute annual sum, the series is "lumpy" — spread it evenly across
 * 12 months (annual / 12). Otherwise return the input unchanged.
 *
 * The threshold is conservative (default 80%) so genuine seasonal
 * patterns (e.g. Q4 holiday sales spike) are preserved. Only single-
 * month annual lumps trigger the smoothing.
 */

const LUMP_THRESHOLD_PCT = 80;

export function isLumpyMonthly(monthly: number[]): boolean {
  if (monthly.length !== 12) return false;
  const annual = monthly.reduce((s, v) => s + v, 0);
  if (Math.abs(annual) < 1) return false; // all-zero or near-zero
  for (const v of monthly) {
    const ratio = (Math.abs(v) / Math.abs(annual)) * 100;
    if (ratio >= LUMP_THRESHOLD_PCT) return true;
  }
  return false;
}

/**
 * Smooth a 12-element monthly series if it's lumpy. YTD sum preserved.
 * Returns a new array; never mutates input.
 */
export function smoothLumpyMonthly(monthly: number[]): number[] {
  if (!isLumpyMonthly(monthly)) return [...monthly];
  const annual = monthly.reduce((s, v) => s + v, 0);
  return Array(12).fill(annual / 12);
}
