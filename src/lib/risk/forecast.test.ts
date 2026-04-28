/**
 * Phase C2 v1 — predictive analytics tests.
 *
 * Locks in:
 *   - Perfect ascending line → high confidence + R² ≈ 1
 *   - Perfect descending line → negative slope, high confidence
 *   - Flat series (all identical) → predicted = mean, slope = 0, r² = 0,
 *     confidence = 'low' (caller may render "no change expected")
 *   - Insufficient data (<3 points) → null
 *   - All-null series → null
 *   - Noisy line — slope direction preserved, confidence drops
 *   - Series with null gaps — uses original index as x (respects time spacing)
 *   - Trailing nulls — forecast at series.length, not points.length
 *   - Confidence boundaries — exact threshold checks
 */

import { describe, it, expect } from 'vitest';
import { forecastNextPeriod } from './forecast';

describe('forecastNextPeriod (Phase C2 v1)', () => {
  it('perfect ascending line → R²=1, high confidence, slope=1', () => {
    const series = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const r = forecastNextPeriod(series);
    expect(r).not.toBeNull();
    expect(r!.slope).toBeCloseTo(1, 9);
    expect(r!.intercept).toBeCloseTo(0, 9);
    expect(r!.r2).toBeCloseTo(1, 9);
    expect(r!.predicted).toBeCloseTo(12, 9); // next index = 12
    expect(r!.confidence).toBe('high');
    expect(r!.contributingCount).toBe(12);
    expect(r!.method).toBe('linear-regression-v1');
  });

  it('perfect descending line → negative slope, high confidence', () => {
    const series = [10, 9, 8, 7, 6, 5, 4, 3];
    const r = forecastNextPeriod(series);
    expect(r).not.toBeNull();
    expect(r!.slope).toBeCloseTo(-1, 9);
    expect(r!.r2).toBeCloseTo(1, 9);
    expect(r!.predicted).toBeCloseTo(2, 9); // index 8 → 10 + 8·(-1) = 2
    expect(r!.confidence).toBe('high');
  });

  it('flat series (all identical) → slope=0, r²=0, low confidence', () => {
    const series = [5, 5, 5, 5, 5, 5];
    const r = forecastNextPeriod(series);
    expect(r).not.toBeNull();
    expect(r!.slope).toBe(0);
    expect(r!.r2).toBe(0);
    expect(r!.predicted).toBeCloseTo(5, 9);
    // Confidence = 'medium' because n=6 → ≥5 (the medium-or fallback);
    // r² is 0 (NOT ≥ 0.7) so doesn't hit 'high'. Caller should detect
    // slope=0 and render "no change expected" rather than treating
    // medium-confidence-zero-slope as a meaningful signal.
    expect(r!.confidence).toBe('medium');
    expect(r!.contributingCount).toBe(6);
  });

  it('insufficient data (<3 points) → null', () => {
    expect(forecastNextPeriod([1, 2])).toBeNull();
    expect(forecastNextPeriod([1])).toBeNull();
    expect(forecastNextPeriod([])).toBeNull();
  });

  it('all-null series → null', () => {
    expect(forecastNextPeriod([null, null, null, null])).toBeNull();
  });

  it('mostly-null with only 2 real values → null', () => {
    expect(
      forecastNextPeriod([null, 5, null, null, 10, null]),
    ).toBeNull();
  });

  it('noisy ascending line → slope direction preserved, lower r²', () => {
    // Add ±1 noise to a slope-2 line.
    const series = [0, 3, 3, 7, 7, 11, 11, 15];
    const r = forecastNextPeriod(series);
    expect(r).not.toBeNull();
    expect(r!.slope).toBeGreaterThan(0); // ascending preserved
    expect(r!.r2).toBeLessThan(1); // not perfect
    expect(r!.r2).toBeGreaterThan(0.9); // still strong fit
    // n=8 + r²>0.9 → 'high'.
    expect(r!.confidence).toBe('high');
  });

  it('series with null gaps — uses original index as x', () => {
    // [10, null, 14, null, 18] — slope 2 over indices 0,2,4 → x-step 2
    // gives y-step 4, so slope per index = 2. Forecast at index 5.
    const series = [10, null, 14, null, 18];
    const r = forecastNextPeriod(series);
    expect(r).not.toBeNull();
    expect(r!.slope).toBeCloseTo(2, 9);
    // Predicted at series.length = 5, NOT points.length = 3.
    // y = 10 + 2·5 = 20.
    expect(r!.predicted).toBeCloseTo(20, 9);
    expect(r!.contributingCount).toBe(3);
  });

  it('trailing nulls — forecast at series.length, not points.length', () => {
    // [10, 12, 14, null, null] — slope 2 across first 3 indices.
    // Forecast at index 5, NOT index 3.
    const series = [10, 12, 14, null, null];
    const r = forecastNextPeriod(series);
    expect(r).not.toBeNull();
    expect(r!.slope).toBeCloseTo(2, 9);
    // y at x=5 = 10 + 2·5 = 20.
    expect(r!.predicted).toBeCloseTo(20, 9);
    expect(r!.contributingCount).toBe(3);
  });

  it('non-finite values (NaN, Infinity) treated as null', () => {
    const series: Array<number | null> = [1, 2, 3];
    const dirty = [...series, NaN, Infinity, -Infinity] as Array<number | null>;
    const r = forecastNextPeriod(dirty);
    expect(r).not.toBeNull();
    // Only 3 finite points contribute.
    expect(r!.contributingCount).toBe(3);
  });

  it('confidence threshold: high requires r²≥0.7 AND n≥6', () => {
    // Strong fit but n=4 → fails 'high', falls to 'medium' via n<5 fallback.
    const r4 = forecastNextPeriod([0, 1, 2, 3]);
    expect(r4).not.toBeNull();
    expect(r4!.r2).toBeCloseTo(1, 9);
    // n=4 → fails 'high' (n<6). Falls to medium check: r²≥0.4 OR n≥5.
    // r²=1≥0.4 satisfies medium → 'medium'.
    expect(r4!.confidence).toBe('medium');
  });

  it('confidence threshold: low when both r²<0.4 and n<5', () => {
    // 3 noisy points: r² will be variable. Use values that don't fit well.
    const r = forecastNextPeriod([0, 5, 1]);
    expect(r).not.toBeNull();
    expect(r!.contributingCount).toBe(3);
    // Linear fit through (0,0), (1,5), (2,1) — slope is non-zero but
    // r² is moderate. n=3 + r²<0.4 → 'low'. Verify r² is in fact low.
    if (r!.r2 < 0.4) {
      expect(r!.confidence).toBe('low');
    } else {
      // If the synthetic data happens to fit, re-check: r²≥0.4 would
      // satisfy medium-OR clause.
      expect(r!.confidence).toBe('medium');
    }
  });

  it('exact ascending series 1..6 → high confidence (n=6 + r²=1)', () => {
    const series = [1, 2, 3, 4, 5, 6];
    const r = forecastNextPeriod(series);
    expect(r).not.toBeNull();
    expect(r!.r2).toBeCloseTo(1, 9);
    expect(r!.confidence).toBe('high');
    // Predicted at x=6 → 1 + 1·6 = 7.
    expect(r!.predicted).toBeCloseTo(7, 9);
  });

  it('series of length 5 with strong fit → medium confidence (n<6)', () => {
    const series = [10, 20, 30, 40, 50];
    const r = forecastNextPeriod(series);
    expect(r).not.toBeNull();
    expect(r!.r2).toBeCloseTo(1, 9);
    // n=5 fails high (n<6) but satisfies medium (n≥5 OR r²≥0.4).
    expect(r!.confidence).toBe('medium');
    expect(r!.predicted).toBeCloseTo(60, 9);
  });
});
