/**
 * Phase 10 / Stage B2 — PeriodContext contract.
 *
 * The cases that matter here are the ones the FO-workbook session actually got
 * wrong: a period silently claiming months it does not have, and month
 * arithmetic drifting across a year boundary.
 */
import { describe, it, expect } from 'vitest';
import {
  parsePeriodKey,
  buildPeriodContext,
  expectedCoverageMonths,
  hasFullCoverage,
  isPartialCoverage,
  PeriodKeyParseError,
  FISCAL_TIME_ZONE,
} from './period-context';

const REV = 'rev-1';
const NOW = '2026-07-16T12:00:00.000Z';

function ctx(periodKey: string, observedMonths: string[] = []) {
  return buildPeriodContext({
    periodKey,
    basis: 'ACTUAL',
    revisionId: REV,
    computedAt: NOW,
    observedMonths,
  });
}

describe('parsePeriodKey', () => {
  it('parses a month and spans exactly it', () => {
    const p = parsePeriodKey('2026-05');
    expect(p.kind).toBe('MONTH');
    expect(p.fiscalYear).toBe(2026);
    expect(p.months).toEqual(['2026-05']);
    expect(p.start.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('parses a quarter as its three months', () => {
    const p = parsePeriodKey('2026-Q2');
    expect(p.kind).toBe('QUARTER');
    expect(p.months).toEqual(['2026-04', '2026-05', '2026-06']);
  });

  it('parses a fiscal year as twelve months', () => {
    const p = parsePeriodKey('2026');
    expect(p.kind).toBe('FY');
    expect(p.months).toHaveLength(12);
    expect(p.months[0]).toBe('2026-01');
    expect(p.months[11]).toBe('2026-12');
  });

  it('parses YTD as January through the named month', () => {
    const p = parsePeriodKey('2026-YTD-05');
    expect(p.kind).toBe('YTD');
    expect(p.months).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
    ]);
    expect(p.end.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('parses LTM as twelve months ending inclusive of the named month', () => {
    // The year-crossing case: LTM May 2026 must start June 2025, not
    // January 2026 and not June 2026.
    const p = parsePeriodKey('2026-LTM-05');
    expect(p.kind).toBe('LTM');
    expect(p.months).toHaveLength(12);
    expect(p.months[0]).toBe('2025-06');
    expect(p.months[11]).toBe('2026-05');
    expect(p.start.toISOString()).toBe('2025-06-01T00:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('reports LTM under its ending year, not its starting year', () => {
    expect(parsePeriodKey('2026-LTM-05').fiscalYear).toBe(2026);
  });

  it('handles LTM ending in January — the hardest year boundary', () => {
    const p = parsePeriodKey('2026-LTM-01');
    expect(p.months[0]).toBe('2025-02');
    expect(p.months[11]).toBe('2026-01');
    expect(p.months).toHaveLength(12);
  });

  it('handles YTD January and LTM December without off-by-one', () => {
    expect(parsePeriodKey('2026-YTD-01').months).toEqual(['2026-01']);
    const ltm = parsePeriodKey('2026-LTM-12');
    expect(ltm.months[0]).toBe('2026-01');
    expect(ltm.months[11]).toBe('2026-12');
  });

  it.each(['2026-YTD-00', '2026-YTD-13', '2026-LTM-00', '2026-LTM-13'])(
    'rejects out-of-range month %s',
    (key) => {
      expect(() => parsePeriodKey(key)).toThrow(PeriodKeyParseError);
    },
  );

  it.each(['', 'nonsense', '2026-13', '2026-Q5', '26-05', '2026-YTD'])(
    'rejects malformed key %j rather than guessing',
    (key) => {
      expect(() => parsePeriodKey(key)).toThrow(PeriodKeyParseError);
    },
  );
});

describe('coverage — the "YTD May is not FY" rule (§4.2)', () => {
  it('expects 12 months for a fiscal year but 5 for YTD May', () => {
    expect(expectedCoverageMonths(parsePeriodKey('2026'))).toBe(12);
    expect(expectedCoverageMonths(parsePeriodKey('2026-YTD-05'))).toBe(5);
    expect(expectedCoverageMonths(parsePeriodKey('2026-Q2'))).toBe(3);
    expect(expectedCoverageMonths(parsePeriodKey('2026-05'))).toBe(1);
    expect(expectedCoverageMonths(parsePeriodKey('2026-LTM-05'))).toBe(12);
  });

  it('marks a year holding only five booked months as partial', () => {
    // The EDEN failure in structural form: 4-5 booked months of a 12-month
    // year previously read as a complete FY result.
    const c = ctx('2026', ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']);
    expect(c.coverageMonths).toBe(5);
    expect(c.expectedCoverageMonths).toBe(12);
    expect(isPartialCoverage(c)).toBe(true);
    expect(hasFullCoverage(c)).toBe(false);
  });

  it('calls the same five months full coverage when the period is YTD May', () => {
    const c = ctx('2026-YTD-05', [
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
    ]);
    expect(c.coverageMonths).toBe(5);
    expect(c.expectedCoverageMonths).toBe(5);
    expect(hasFullCoverage(c)).toBe(true);
  });

  it('ignores observed months outside the period', () => {
    // A caller passing a whole company history must not inflate January.
    const c = ctx('2026-01', ['2025-12', '2026-01', '2026-02']);
    expect(c.coverageMonths).toBe(1);
    expect(hasFullCoverage(c)).toBe(true);
  });

  it('counts an LTM window that reaches into the prior year', () => {
    const c = ctx('2026-LTM-05', ['2025-06', '2025-12', '2026-05']);
    expect(c.coverageMonths).toBe(3);
    expect(c.expectedCoverageMonths).toBe(12);
    expect(isPartialCoverage(c)).toBe(true);
  });

  it('does not double-count duplicate observed months', () => {
    const c = ctx('2026-Q1', ['2026-01', '2026-01', '2026-02']);
    expect(c.coverageMonths).toBe(2);
  });
});

describe('dataThrough', () => {
  it('is the exclusive end of the latest observed month', () => {
    const c = ctx('2026', ['2026-01', '2026-05', '2026-03']);
    expect(c.dataThrough).toBe('2026-06-01T00:00:00.000Z');
  });

  it('is null when nothing inside the period was observed — unknown, not a guess', () => {
    expect(ctx('2026').dataThrough).toBeNull();
    expect(ctx('2026', ['2025-11']).dataThrough).toBeNull();
  });

  it('crosses the year boundary correctly for a December observation', () => {
    const c = ctx('2026', ['2026-12']);
    expect(c.dataThrough).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('the contract carries every §4.1 field', () => {
  it('emits all of them, defaulting the unknown ones to null', () => {
    const c = ctx('2026-Q2', ['2026-04']);
    expect(Object.keys(c).sort()).toEqual(
      [
        'approvedAt',
        'basis',
        'computedAt',
        'coverageMonths',
        'dataThrough',
        'expectedCoverageMonths',
        'externalAsOf',
        'financialAsOf',
        'fiscalYear',
        'latestClosedMonth',
        'lockedAt',
        'periodEnd',
        'periodKey',
        'periodKind',
        'periodStart',
        'reconciledAt',
        'revisionId',
        'timeZone',
      ].sort(),
    );
    expect(c.financialAsOf).toBeNull();
    expect(c.externalAsOf).toBeNull();
    expect(c.lockedAt).toBeNull();
    expect(c.reconciledAt).toBeNull();
    expect(c.approvedAt).toBeNull();
    expect(c.latestClosedMonth).toBeNull();
  });

  it('passes through the provenance fields it is given', () => {
    const c = buildPeriodContext({
      periodKey: '2026-05',
      basis: 'PLAN',
      revisionId: 'rev-7',
      computedAt: NOW,
      observedMonths: ['2026-05'],
      latestClosedMonth: '2026-04',
      financialAsOf: '2026-06-01T00:00:00.000Z',
      externalAsOf: '2026-07-01T00:00:00.000Z',
      lockedAt: '2026-06-15T00:00:00.000Z',
      reconciledAt: '2026-06-16T00:00:00.000Z',
      approvedAt: '2026-06-17T00:00:00.000Z',
    });
    expect(c).toMatchObject({
      basis: 'PLAN',
      revisionId: 'rev-7',
      latestClosedMonth: '2026-04',
      financialAsOf: '2026-06-01T00:00:00.000Z',
      externalAsOf: '2026-07-01T00:00:00.000Z',
      lockedAt: '2026-06-15T00:00:00.000Z',
      reconciledAt: '2026-06-16T00:00:00.000Z',
      approvedAt: '2026-06-17T00:00:00.000Z',
    });
  });

  it('declares the fiscal calendar zone and keeps timestamps in UTC', () => {
    // The zone is a declaration about the calendar, not an instruction to
    // shift these instants — conflating the two is what drifted a month of
    // revenue into the wrong year.
    const c = ctx('2026-01');
    expect(c.timeZone).toBe(FISCAL_TIME_ZONE);
    expect(c.periodStart).toBe('2026-01-01T00:00:00.000Z');
    expect(c.periodEnd).toBe('2026-02-01T00:00:00.000Z');
  });

  it.each(['ACTUAL', 'PLAN', 'FORECAST', 'SCENARIO'] as const)(
    'carries basis %s — a plan must never be mistaken for an actual',
    (basis) => {
      expect(
        buildPeriodContext({
          periodKey: '2026',
          basis,
          revisionId: REV,
          computedAt: NOW,
        }).basis,
      ).toBe(basis);
    },
  );

  it('is deterministic — the same input yields an identical context', () => {
    const a = ctx('2026-YTD-05', ['2026-01']);
    const b = ctx('2026-YTD-05', ['2026-01']);
    expect(a).toEqual(b);
    // No Date.now() anywhere: computedAt is whatever the caller injected.
    expect(a.computedAt).toBe(NOW);
  });

  it('is JSON-safe — it crosses the wire to the client', () => {
    const c = ctx('2026', ['2026-01']);
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });
});

describe('hasFullCoverage is only the coverage clause, not §4.3 completeness', () => {
  it('is false for a period expecting nothing observed', () => {
    expect(hasFullCoverage(ctx('2026'))).toBe(false);
  });

  it('is true on coverage alone, even with no lock, reconciliation or approval', () => {
    // Deliberate: the name promises coverage only. §4.3's full gate also needs
    // structural tests, reconciliation and an identifiable revision — none of
    // which exist yet. A caller must not read this as "decision-grade".
    const c = ctx('2026-01', ['2026-01']);
    expect(hasFullCoverage(c)).toBe(true);
    expect(c.reconciledAt).toBeNull();
    expect(c.approvedAt).toBeNull();
    expect(c.lockedAt).toBeNull();
  });
});
