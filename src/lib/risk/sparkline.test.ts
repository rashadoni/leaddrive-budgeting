/**
 * Phase B2 — sparkline.ts unit tests.
 *
 * Covers:
 *   - `trailingMonthPeriods()` — 12-slot generation, edge cases at year
 *     boundaries (Jan 2026 → Feb 2025), quarterly/yearly anchor
 *     normalisation (Q2 → end at June), custom length parameter.
 *   - `evaluateAt()` — sparklineFormula preferred when present, falls
 *     back to formula; null on parse error, divide-by-zero, NaN, throw.
 *   - `computeSparkline()` — orchestrates evaluateAt across periods,
 *     returns chronological array (oldest first), preserves null slots.
 */

import { describe, it, expect } from 'vitest';
import {
  trailingMonthPeriods,
  evaluateAt,
  computeSparkline,
  SPARKLINE_LENGTH,
} from './sparkline';
import type { RecomputeDataSource } from './recompute';

describe('trailingMonthPeriods', () => {
  it('generates 12 trailing months ending at anchor (inclusive)', () => {
    const periods = trailingMonthPeriods('2026-04');
    expect(periods).toHaveLength(SPARKLINE_LENGTH);
    expect(periods[0]).toBe('2025-05');
    expect(periods[11]).toBe('2026-04');
  });

  it('handles year boundary (Jan anchor crosses to prior year)', () => {
    const periods = trailingMonthPeriods('2026-01');
    expect(periods[0]).toBe('2025-02');
    expect(periods[11]).toBe('2026-01');
  });

  it('respects custom length parameter', () => {
    const periods = trailingMonthPeriods('2026-04', 6);
    expect(periods).toHaveLength(6);
    expect(periods[0]).toBe('2025-11');
    expect(periods[5]).toBe('2026-04');
  });

  it('quarterly anchor normalises to last month of quarter', () => {
    const periods = trailingMonthPeriods('2026-Q2');
    expect(periods[11]).toBe('2026-06'); // Q2 = Apr-Jun, last month = June
  });

  it('yearly anchor normalises to December', () => {
    const periods = trailingMonthPeriods('2026');
    expect(periods[11]).toBe('2026-12');
    expect(periods[0]).toBe('2026-01'); // Jan 2026 — 12 months back from Dec
  });

  it('chronologically ordered (oldest first)', () => {
    const periods = trailingMonthPeriods('2026-04');
    for (let i = 1; i < periods.length; i++) {
      expect(periods[i].localeCompare(periods[i - 1])).toBeGreaterThan(0);
    }
  });
});

// Stub data source — `evaluateAt` only uses it via the injected
// buildContext, so we don't need real implementations here.
const stubDs = {} as unknown as RecomputeDataSource;

describe('evaluateAt', () => {
  it('uses sparklineFormula when present (and falls through formula)', async () => {
    const result = await evaluateAt(stubDs, {
      organizationId: 'o',
      companyId: 'c',
      definition: {
        id: 'i',
        formula: 'a / b * 100',
        sparklineFormula: 'a_daily / b_daily * 100',
        requiredInputs: [],
      },
      period: '2026-04',
      buildContext: async () => ({
        context: { a_daily: 50, b_daily: 100 },
      }),
    });
    expect(result).toBe(50);
  });

  it('falls back to formula when sparklineFormula absent', async () => {
    const result = await evaluateAt(stubDs, {
      organizationId: 'o',
      companyId: 'c',
      definition: {
        id: 'i',
        formula: 'revenue / cogs',
        requiredInputs: [],
      },
      period: '2026-04',
      buildContext: async () => ({
        context: { revenue: 100, cogs: 25 },
      }),
    });
    expect(result).toBe(4);
  });

  it('returns null on formula parse error', async () => {
    const result = await evaluateAt(stubDs, {
      organizationId: 'o',
      companyId: 'c',
      definition: {
        id: 'i',
        formula: '!!!INVALID!!!',
        requiredInputs: [],
      },
      period: '2026-04',
      buildContext: async () => ({ context: {} }),
    });
    expect(result).toBeNull();
  });

  it('returns null on divide-by-zero (Infinity is not finite)', async () => {
    const result = await evaluateAt(stubDs, {
      organizationId: 'o',
      companyId: 'c',
      definition: {
        id: 'i',
        formula: 'a / b',
        requiredInputs: [],
      },
      period: '2026-04',
      buildContext: async () => ({ context: { a: 5, b: 0 } }),
    });
    expect(result).toBeNull();
  });

  it('returns null when buildContext throws', async () => {
    const result = await evaluateAt(stubDs, {
      organizationId: 'o',
      companyId: 'c',
      definition: {
        id: 'i',
        formula: 'a + b',
        requiredInputs: [],
      },
      period: '2026-04',
      buildContext: async () => {
        throw new Error('resolver failed');
      },
    });
    expect(result).toBeNull();
  });
});

describe('computeSparkline', () => {
  it('returns 12 slots in chronological order with values from per-period evaluation', async () => {
    // Synthetic context that returns increasing values per period
    let n = 0;
    const result = await computeSparkline(stubDs, {
      organizationId: 'o',
      companyId: 'c',
      definition: {
        id: 'i',
        formula: 'val',
        requiredInputs: [],
      },
      anchorPeriod: '2026-04',
      buildContext: async () => ({ context: { val: ++n } }),
    });
    expect(result).toHaveLength(SPARKLINE_LENGTH);
    expect(result[0]).toBe(1);
    expect(result[11]).toBe(12);
  });

  it('preserves null slots for failed periods', async () => {
    const result = await computeSparkline(stubDs, {
      organizationId: 'o',
      companyId: 'c',
      definition: {
        id: 'i',
        formula: 'val',
        requiredInputs: [],
      },
      anchorPeriod: '2026-04',
      // Even periods evaluate; odd periods have NaN context = null
      buildContext: async ({ period }) => {
        const monthIdx = parseInt(period.split('-')[1], 10);
        return monthIdx % 2 === 0
          ? { context: { val: monthIdx } }
          : { context: { val: NaN } };
      },
    });
    expect(result).toHaveLength(SPARKLINE_LENGTH);
    // 12 months ending at 2026-04: 2025-05, 06, 07, 08, 09, 10, 11, 12, 2026-01, 02, 03, 04
    // odd-month results: 5, 7, 9, 11, 01, 03 → null
    // even-month results: 6, 8, 10, 12, 02, 04 → numeric
    const oddNullCount = result.filter((v) => v === null).length;
    const evenNumericCount = result.filter((v) => typeof v === 'number').length;
    expect(oddNullCount).toBe(6);
    expect(evenNumericCount).toBe(6);
  });

  it('respects custom length', async () => {
    const result = await computeSparkline(stubDs, {
      organizationId: 'o',
      companyId: 'c',
      definition: {
        id: 'i',
        formula: '1',
        requiredInputs: [],
      },
      anchorPeriod: '2026-04',
      length: 4,
      buildContext: async () => ({ context: {} }),
    });
    expect(result).toHaveLength(4);
  });
});
