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
import {
  forecastNextPeriod,
  forecastHorizon,
  forecastConfidenceInterval,
} from './forecast';

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

  it('flat series (all identical) → slope=0, r²=0, LOW confidence', () => {
    const series = [5, 5, 5, 5, 5, 5];
    const r = forecastNextPeriod(series);
    expect(r).not.toBeNull();
    expect(r!.slope).toBe(0);
    expect(r!.r2).toBe(0);
    expect(r!.predicted).toBeCloseTo(5, 9);
    // Architect Round-1 sub-13 closure: flat series (ssTot=0) forces
    // confidence='low' regardless of n. The n≥5 medium-OR-fallback
    // shouldn't apply when there's literally no signal — caller should
    // ALSO detect slope=0 and render "no change expected" copy.
    expect(r!.confidence).toBe('low');
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

  it('confidence threshold: low when both r²<0.4 and n<5 (deterministic)', () => {
    // 3 points (0,0), (1,5), (2,1). Compute by hand:
    //   meanX=1, meanY=2; slope=Σ(x−mx)(y−my)/Σ(x−mx)² = (1+0+−1)/2 = 0.5
    //   intercept = 2 − 0.5·1 = 1.5
    //   y_hat at x=0,1,2: 1.5, 2.0, 2.5
    //   ssRes = (0−1.5)² + (5−2)² + (1−2.5)² = 2.25 + 9 + 2.25 = 13.5
    //   ssTot = (0−2)² + (5−2)² + (1−2)² = 4 + 9 + 1 = 14
    //   r² = 1 − 13.5/14 ≈ 0.0357
    // Architect Round-1 sub-13 closure: was hedged if/else; now
    // deterministic — r²≈0.036 is unambiguously <0.4 + n=3<5 → 'low'.
    const r = forecastNextPeriod([0, 5, 1]);
    expect(r).not.toBeNull();
    expect(r!.contributingCount).toBe(3);
    expect(r!.r2).toBeLessThan(0.1); // ≈0.036 — well below 0.4 threshold
    expect(r!.confidence).toBe('low');
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

describe('forecastHorizon (Phase C2 v2 sub-23)', () => {
  it('default 3 steps with perfect ascending line', () => {
    const series = [0, 1, 2, 3, 4, 5, 6, 7];
    const r = forecastHorizon(series);
    expect(r).not.toBeNull();
    expect(r!.horizon).toHaveLength(3);
    // slope=1, intercept=0; series.length=8 → step1=8, step2=9, step3=10.
    expect(r!.horizon[0]).toEqual({ step: 1, predicted: 8 });
    expect(r!.horizon[1]).toEqual({ step: 2, predicted: 9 });
    expect(r!.horizon[2]).toEqual({ step: 3, predicted: 10 });
    expect(r!.confidence).toBe('high');
  });

  it('step=1 result equals forecastNextPeriod (backward compat contract)', () => {
    const series = [0, 1, 2, 3, 4, 5, 6, 7];
    const single = forecastNextPeriod(series);
    const horizon = forecastHorizon(series, 1);
    expect(horizon).not.toBeNull();
    expect(horizon!.horizon).toHaveLength(1);
    expect(horizon!.horizon[0].predicted).toBeCloseTo(single!.predicted, 9);
    expect(horizon!.slope).toBeCloseTo(single!.slope, 9);
    expect(horizon!.r2).toBeCloseTo(single!.r2, 9);
    expect(horizon!.confidence).toBe(single!.confidence);
  });

  it('descending line — multi-step projection respects negative slope', () => {
    const series = [20, 18, 16, 14, 12, 10, 8];
    const r = forecastHorizon(series, 4);
    expect(r).not.toBeNull();
    expect(r!.horizon).toHaveLength(4);
    // slope=-2, intercept=20; series.length=7 → step1=20-2·7=6, step2=4, step3=2, step4=0.
    expect(r!.horizon[0].predicted).toBeCloseTo(6, 9);
    expect(r!.horizon[1].predicted).toBeCloseTo(4, 9);
    expect(r!.horizon[2].predicted).toBeCloseTo(2, 9);
    expect(r!.horizon[3].predicted).toBeCloseTo(0, 9);
  });

  it('returns null when series has <3 non-null points (mirrors forecastNextPeriod)', () => {
    expect(forecastHorizon([1, 2])).toBeNull();
    expect(forecastHorizon([null, null, null])).toBeNull();
    expect(forecastHorizon([])).toBeNull();
  });

  it('throws on invalid steps (zero, negative, fractional)', () => {
    expect(() => forecastHorizon([1, 2, 3], 0)).toThrow(
      /steps must be a positive integer/,
    );
    expect(() => forecastHorizon([1, 2, 3], -1)).toThrow(
      /steps must be a positive integer/,
    );
    expect(() => forecastHorizon([1, 2, 3], 1.5)).toThrow(
      /steps must be a positive integer/,
    );
  });

  it('throws on excessive horizon (steps > 12 cap)', () => {
    expect(() => forecastHorizon([1, 2, 3, 4], 13)).toThrow(
      /capped at 12/,
    );
  });

  it('horizon shares confidence band across steps (single-fit semantic)', () => {
    // n=5 + perfect fit → 'medium' (n<6 caps below 'high').
    const r = forecastHorizon([10, 20, 30, 40, 50], 4);
    expect(r).not.toBeNull();
    // All steps share the same confidence — UI/LLM can degrade per-step
    // if needed but the model itself doesn't change with horizon distance.
    expect(r!.confidence).toBe('medium');
    expect(r!.r2).toBeCloseTo(1, 9);
  });

  it('respects null gaps via underlying forecastNextPeriod fit', () => {
    // [10, null, 14, null, 18] — slope 2 over indices 0,2,4.
    // series.length=5 → step1 at x=5 → 10+2·5=20, step2=22, step3=24.
    const r = forecastHorizon([10, null, 14, null, 18]);
    expect(r).not.toBeNull();
    expect(r!.horizon[0].predicted).toBeCloseTo(20, 9);
    expect(r!.horizon[1].predicted).toBeCloseTo(22, 9);
    expect(r!.horizon[2].predicted).toBeCloseTo(24, 9);
    expect(r!.contributingCount).toBe(3);
  });

  it('flat series (slope=0) produces N copies of the mean', () => {
    const r = forecastHorizon([7, 7, 7, 7, 7], 3);
    expect(r).not.toBeNull();
    expect(r!.slope).toBe(0);
    expect(r!.horizon[0].predicted).toBeCloseTo(7, 9);
    expect(r!.horizon[1].predicted).toBeCloseTo(7, 9);
    expect(r!.horizon[2].predicted).toBeCloseTo(7, 9);
    // Caller should detect slope≈0 and surface "no change expected"
    // copy rather than parading 3 identical "+7" badges.
    expect(r!.confidence).toBe('low');
  });

  it('boundary: exactly 12 steps is permitted', () => {
    // Don't throw at the boundary.
    expect(() => forecastHorizon([1, 2, 3, 4], 12)).not.toThrow();
    const r = forecastHorizon([1, 2, 3, 4], 12);
    expect(r!.horizon).toHaveLength(12);
  });
});

describe('forecastConfidenceInterval (Phase C2 v2 sub-24)', () => {
  it('perfect-line series → CI collapses to ±0 (no model error)', () => {
    // Perfect slope-1 line: ssRes = 0 → sigma = 0 → margin = 0.
    const ci = forecastConfidenceInterval([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(ci).not.toBeNull();
    expect(ci!.marginOfError).toBeCloseTo(0, 9);
    expect(ci!.lower).toBeCloseTo(ci!.upper, 9);
    expect(ci!.level).toBe(0.95);
  });

  it('noisy ascending line → wider CI than perfect-line', () => {
    // ±1 noise around slope-2 line: residuals nonzero → margin > 0.
    const ci = forecastConfidenceInterval([0, 3, 3, 7, 7, 11, 11, 15]);
    expect(ci).not.toBeNull();
    expect(ci!.marginOfError).toBeGreaterThan(0);
    // CI should bracket the predicted value: lower < predicted < upper.
    const single = forecastNextPeriod([0, 3, 3, 7, 7, 11, 11, 15])!;
    expect(ci!.lower).toBeLessThanOrEqual(single.predicted);
    expect(ci!.upper).toBeGreaterThanOrEqual(single.predicted);
  });

  it('returns null when series has <3 non-null points', () => {
    expect(forecastConfidenceInterval([1, 2])).toBeNull();
    expect(forecastConfidenceInterval([null, null, null])).toBeNull();
    expect(forecastConfidenceInterval([])).toBeNull();
  });

  it('df = n − 2; at n=3 df=1 → t_crit=12.706 → very wide CI', () => {
    // Slight noise so ssRes > 0 (perfect fit collapses CI to 0).
    const ci = forecastConfidenceInterval([0, 5, 1]);
    expect(ci).not.toBeNull();
    expect(ci!.degreesOfFreedom).toBe(1);
    // Margin should reflect the t=12.706 multiplier on small df.
    // Standard error sePred at this size dwarfs everything; just
    // assert margin is large (not <1).
    expect(ci!.marginOfError).toBeGreaterThan(1);
  });

  it('larger n + tighter fit → tighter CI (qualitative)', () => {
    // Same slope, different sample sizes / noise levels.
    const tight = forecastConfidenceInterval([
      0, 2, 4, 6, 8, 10, 12, 14, 16, 18,
    ])!; // perfect fit n=10
    const noisy = forecastConfidenceInterval([0, 5, 1])!; // n=3 noisy
    expect(tight.marginOfError).toBeLessThan(noisy.marginOfError);
  });

  it('CI integrated into ForecastResult.predictionInterval (single-pass contract)', () => {
    // Sub-24 — forecastNextPeriod auto-attaches CI without 2nd OLS pass.
    const r = forecastNextPeriod([0, 3, 3, 7, 7, 11, 11, 15]);
    expect(r).not.toBeNull();
    expect(r!.predictionInterval).toBeDefined();
    expect(r!.predictionInterval!.level).toBe(0.95);
    expect(r!.predictionInterval!.degreesOfFreedom).toBe(6); // n=8 - 2
    // Standalone helper produces identical numbers (single source of truth).
    const standalone = forecastConfidenceInterval([
      0, 3, 3, 7, 7, 11, 11, 15,
    ])!;
    expect(r!.predictionInterval!.marginOfError).toBeCloseTo(
      standalone.marginOfError,
      9,
    );
    expect(r!.predictionInterval!.lower).toBeCloseTo(standalone.lower, 9);
    expect(r!.predictionInterval!.upper).toBeCloseTo(standalone.upper, 9);
  });

  it('df > 30 clamps to t_crit ≈ 1.96 (z-distribution limit)', () => {
    // Build a 33-point series (df = 31).
    const series = Array.from({ length: 33 }, (_, i) => i * 2 + 0.1 * (i % 2));
    const ci = forecastConfidenceInterval(series)!;
    expect(ci.degreesOfFreedom).toBe(31);
    // Margin / SE should be ~1.96 (clamped). Compute t_crit empirically.
    const tEmpirical = ci.marginOfError / ci.standardError;
    expect(tEmpirical).toBeCloseTo(1.96, 3);
  });
});
