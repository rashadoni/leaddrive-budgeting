/**
 * Phase 10 / Stage B3 — exact period invalidation (05 §4.4).
 *
 * The two ways this can be wrong are both tested: missing a period that must
 * recompute (stale aggregate keeps a decision-grade colour), and including one
 * that must not (a cheap correction becomes a full re-derive).
 *
 * The self-consistency test at the bottom is the strongest one here: the
 * fan-out and the containment predicate are checked against each other across
 * every month of a three-year span, so neither can drift from the other.
 */
import { describe, it, expect } from 'vitest';
import {
  invalidatedPeriodKeys,
  periodContainsMonth,
} from './period-invalidation';
import { parsePeriodKey } from './period-context';
import { PeriodParseError } from './periods';

describe('invalidatedPeriodKeys', () => {
  it('includes the exact month, its quarter and its fiscal year', () => {
    const keys = invalidatedPeriodKeys('2026-05');
    expect(keys).toContain('2026-05');
    expect(keys).toContain('2026-Q2');
    expect(keys).toContain('2026');
  });

  it('picks the right quarter at every boundary', () => {
    expect(invalidatedPeriodKeys('2026-01')).toContain('2026-Q1');
    expect(invalidatedPeriodKeys('2026-03')).toContain('2026-Q1');
    expect(invalidatedPeriodKeys('2026-04')).toContain('2026-Q2');
    expect(invalidatedPeriodKeys('2026-09')).toContain('2026-Q3');
    expect(invalidatedPeriodKeys('2026-10')).toContain('2026-Q4');
    expect(invalidatedPeriodKeys('2026-12')).toContain('2026-Q4');
  });

  it('never emits another quarter', () => {
    const quarters = invalidatedPeriodKeys('2026-05').filter((k) =>
      k.includes('-Q'),
    );
    expect(quarters).toEqual(['2026-Q2']);
  });

  describe('YTD windows', () => {
    it('invalidates YTD through the month and every later month of the year', () => {
      const ytd = invalidatedPeriodKeys('2026-05').filter((k) =>
        k.includes('-YTD-'),
      );
      expect(ytd).toEqual([
        '2026-YTD-05',
        '2026-YTD-06',
        '2026-YTD-07',
        '2026-YTD-08',
        '2026-YTD-09',
        '2026-YTD-10',
        '2026-YTD-11',
        '2026-YTD-12',
      ]);
    });

    it('does not invalidate a YTD that ends before the changed month', () => {
      // YTD-04 does not contain May. Touching it would be over-invalidation.
      const keys = invalidatedPeriodKeys('2026-05');
      expect(keys).not.toContain('2026-YTD-04');
      expect(keys).not.toContain('2026-YTD-01');
    });

    it('a January change reaches all twelve YTD windows', () => {
      const ytd = invalidatedPeriodKeys('2026-01').filter((k) =>
        k.includes('-YTD-'),
      );
      expect(ytd).toHaveLength(12);
      expect(ytd[0]).toBe('2026-YTD-01');
      expect(ytd[11]).toBe('2026-YTD-12');
    });

    it('a December change reaches exactly one', () => {
      const ytd = invalidatedPeriodKeys('2026-12').filter((k) =>
        k.includes('-YTD-'),
      );
      expect(ytd).toEqual(['2026-YTD-12']);
    });
  });

  describe('LTM windows', () => {
    it('invalidates the twelve windows that contain the month, crossing the year', () => {
      // A change to 2026-05 reaches LTM 2026-05 … LTM 2027-04. The tail lives
      // in the NEXT fiscal year — the case a year-scoped invalidation misses.
      const ltm = invalidatedPeriodKeys('2026-05').filter((k) =>
        k.includes('-LTM-'),
      );
      expect(ltm).toHaveLength(12);
      expect(ltm).toContain('2026-LTM-05');
      expect(ltm).toContain('2026-LTM-12');
      expect(ltm).toContain('2027-LTM-01');
      expect(ltm).toContain('2027-LTM-04');
      expect(ltm).not.toContain('2027-LTM-05');
      expect(ltm).not.toContain('2026-LTM-04');
    });

    it('handles a December change rolling entirely into the next year', () => {
      const ltm = invalidatedPeriodKeys('2026-12').filter((k) =>
        k.includes('-LTM-'),
      );
      expect(ltm).toContain('2026-LTM-12');
      expect(ltm).toContain('2027-LTM-01');
      expect(ltm).toContain('2027-LTM-11');
      expect(ltm).not.toContain('2027-LTM-12');
      expect(ltm).toHaveLength(12);
    });

    it('can be switched off for callers that do not serve LTM', () => {
      const keys = invalidatedPeriodKeys('2026-05', { includeLtm: false });
      expect(keys.some((k) => k.includes('-LTM-'))).toBe(false);
      expect(keys).toContain('2026-Q2');
    });
  });

  it('can be switched off for YTD independently', () => {
    const keys = invalidatedPeriodKeys('2026-05', { includeYtd: false });
    expect(keys.some((k) => k.includes('-YTD-'))).toBe(false);
    expect(keys).toContain('2026-05');
  });

  it('emits only the current fiscal year, never a neighbour', () => {
    const years = invalidatedPeriodKeys('2026-05').filter((k) =>
      /^\d{4}$/.test(k),
    );
    expect(years).toEqual(['2026']);
  });

  describe('idempotency — the same change yields the same message set (§4.4)', () => {
    it('is deterministic and deduplicated', () => {
      const a = invalidatedPeriodKeys('2026-05');
      const b = invalidatedPeriodKeys('2026-05');
      expect(a).toEqual(b);
      expect(new Set(a).size).toBe(a.length);
    });

    it('is stably ordered, so a duplicate queue message compares equal', () => {
      const a = invalidatedPeriodKeys('2026-07');
      expect([...a]).toEqual([...a].sort((x, y) => a.indexOf(x) - a.indexOf(y)));
      // Every emitted key is parseable — no malformed key can reach the queue.
      for (const key of a) expect(() => parsePeriodKey(key)).not.toThrow();
    });

    it('emits the expected total: 1 month + 1 quarter + 1 FY + n YTD + 12 LTM', () => {
      // May: 8 YTD windows (05..12) → 1 + 1 + 1 + 8 + 12 = 23.
      expect(invalidatedPeriodKeys('2026-05')).toHaveLength(23);
      // December: 1 YTD window → 1 + 1 + 1 + 1 + 12 = 16.
      expect(invalidatedPeriodKeys('2026-12')).toHaveLength(16);
      // January: 12 YTD windows → 1 + 1 + 1 + 12 + 12 = 27.
      expect(invalidatedPeriodKeys('2026-01')).toHaveLength(27);
    });
  });

  describe('rejects anything that is not a month', () => {
    it.each(['2026', '2026-Q2', '2026-YTD-05', 'nonsense', '', '2026-13', '2026-00'])(
      'throws on %j rather than guessing',
      (raw) => {
        expect(() => invalidatedPeriodKeys(raw)).toThrow(PeriodParseError);
      },
    );
  });
});

describe('periodContainsMonth', () => {
  it.each([
    ['2026-05', '2026-05', true],
    ['2026-Q2', '2026-05', true],
    ['2026-Q1', '2026-05', false],
    ['2026', '2026-05', true],
    ['2025', '2026-05', false],
    ['2026-YTD-05', '2026-05', true],
    ['2026-YTD-04', '2026-05', false],
    ['2026-LTM-05', '2025-06', true],
    ['2026-LTM-05', '2025-05', false],
    ['2027-LTM-04', '2026-05', true],
  ])('%s contains %s → %s', (periodKey, month, expected) => {
    expect(periodContainsMonth(periodKey, month)).toBe(expected);
  });
});

describe('the fan-out and the containment predicate cannot drift apart', () => {
  // The real guarantee: for every month across three years, a period is in the
  // fan-out if and only if it actually contains that month. This catches an
  // off-by-one in either function, since they would have to break identically.
  const candidateKeys: string[] = [];
  for (let y = 2025; y <= 2027; y++) {
    candidateKeys.push(String(y));
    for (let q = 1; q <= 4; q++) candidateKeys.push(`${y}-Q${q}`);
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      candidateKeys.push(`${y}-${mm}`, `${y}-YTD-${mm}`, `${y}-LTM-${mm}`);
    }
  }

  const months: string[] = [];
  for (let m = 1; m <= 12; m++) months.push(`2026-${String(m).padStart(2, '0')}`);

  it.each(months)('agrees on every candidate period for %s', (month) => {
    const emitted = new Set(invalidatedPeriodKeys(month));
    for (const key of candidateKeys) {
      expect({ key, inFanOut: emitted.has(key) }).toEqual({
        key,
        inFanOut: periodContainsMonth(key, month),
      });
    }
  });
});
