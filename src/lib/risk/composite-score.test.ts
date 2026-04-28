/**
 * Phase C5 — composite risk score tests.
 *
 * Locks in:
 *   - All-green → score 100, band green
 *   - All-red → score 0, band red
 *   - All-amber → score 50, band amber
 *   - Mixed → weighted average rounded
 *   - All-unknown / missing → score null, band 'unknown', contributingCount 0
 *   - Mix of scoreable + unknown → average over scoreable only
 *   - Band thresholds: 67 → green, 66 → amber; 34 → amber, 33 → red
 *   - totalCount + contributingCount tracked separately
 */

import { describe, it, expect } from 'vitest';
import {
  computeCompositeScore,
  scoreToBand,
} from './composite-score';
import type { HeatMapCell } from './heatmap-matrix';

function cell(status: HeatMapCell['status']): HeatMapCell {
  return {
    companyId: 'c',
    indicatorId: `ind-${Math.random()}`,
    value: 0,
    status,
  };
}

describe('computeCompositeScore (Phase C5)', () => {
  it('all-green → score 100, band green', () => {
    const result = computeCompositeScore([cell('green'), cell('green')]);
    expect(result.score).toBe(100);
    expect(result.band).toBe('green');
    expect(result.contributingCount).toBe(2);
    expect(result.totalCount).toBe(2);
  });

  it('all-red → score 0, band red', () => {
    const result = computeCompositeScore([cell('red'), cell('red'), cell('red')]);
    expect(result.score).toBe(0);
    expect(result.band).toBe('red');
  });

  it('all-amber → score 50, band amber', () => {
    const result = computeCompositeScore([cell('amber'), cell('amber')]);
    expect(result.score).toBe(50);
    expect(result.band).toBe('amber');
  });

  it('mixed: 1g+1r → 50, amber band', () => {
    const result = computeCompositeScore([cell('green'), cell('red')]);
    expect(result.score).toBe(50);
    expect(result.band).toBe('amber');
  });

  it('mixed: 2g+1r → round((100+100+0)/3) = 67 → green band', () => {
    const result = computeCompositeScore([
      cell('green'),
      cell('green'),
      cell('red'),
    ]);
    expect(result.score).toBe(67);
    expect(result.band).toBe('green');
  });

  it('mixed: 1g+2r → round((100+0+0)/3) = 33 → red band', () => {
    const result = computeCompositeScore([
      cell('green'),
      cell('red'),
      cell('red'),
    ]);
    expect(result.score).toBe(33);
    expect(result.band).toBe('red');
  });

  it('all-unknown → score null, band unknown, contributingCount 0', () => {
    const result = computeCompositeScore([
      cell('unknown'),
      cell('unknown'),
    ]);
    expect(result.score).toBeNull();
    expect(result.band).toBe('unknown');
    expect(result.contributingCount).toBe(0);
    expect(result.totalCount).toBe(2);
  });

  it('mix scoreable + unknown → average over scoreable only', () => {
    const result = computeCompositeScore([
      cell('green'), // 100
      cell('unknown'), // ignored (no DB-emitted "missing"; unknown is the catch-all)
      cell('red'), // 0
      cell('unknown'), // ignored
    ]);
    // Avg over (green, red) = (100+0)/2 = 50
    expect(result.score).toBe(50);
    expect(result.contributingCount).toBe(2);
    expect(result.totalCount).toBe(4);
  });

  it('empty cells → score null, totalCount 0', () => {
    const result = computeCompositeScore([]);
    expect(result.score).toBeNull();
    expect(result.band).toBe('unknown');
    expect(result.contributingCount).toBe(0);
    expect(result.totalCount).toBe(0);
  });
});

describe('scoreToBand (Phase C5)', () => {
  it('100 → green', () => {
    expect(scoreToBand(100)).toBe('green');
  });

  it('67 → green (lower edge)', () => {
    expect(scoreToBand(67)).toBe('green');
  });

  it('66 → amber (just below green)', () => {
    expect(scoreToBand(66)).toBe('amber');
  });

  it('50 → amber (mid-band)', () => {
    expect(scoreToBand(50)).toBe('amber');
  });

  it('34 → amber (lower edge)', () => {
    expect(scoreToBand(34)).toBe('amber');
  });

  it('33 → red (just below amber)', () => {
    expect(scoreToBand(33)).toBe('red');
  });

  it('0 → red', () => {
    expect(scoreToBand(0)).toBe('red');
  });
});
