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

/**
 * Sum a list of 12-element monthly series with optional per-row
 * smoothing. Each row is smoothed independently BEFORE being added to
 * the aggregate, because aggregation washes out individual lumps when
 * other smooth rows in the same set carry steady monthly values.
 *
 * Used by the Margin Trends chart: at consolidated views (e.g. all
 * AZMADE companies) one company may have a December lump while seven
 * others have flat monthlies — the aggregate Dec/annual ratio drops
 * below the lumpiness threshold even though one constituent IS lumpy.
 */
export function sumPerRowSmoothed(rows: number[][], smooth: boolean): number[] {
  const out = Array(12).fill(0) as number[];
  for (const row of rows) {
    const series = smooth ? smoothLumpyMonthly(row) : row;
    for (let i = 0; i < 12; i += 1) out[i] += series[i] ?? 0;
  }
  return out;
}
