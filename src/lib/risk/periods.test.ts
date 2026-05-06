import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  currentBakuYear,
  currentBakuYearMonth,
  currentBakuYearNumber,
  parsePeriod,
  daysInPeriod,
  expandToMonths,
  PeriodParseError,
} from './periods';

describe('parsePeriod', () => {
  it('parses monthly period (UTC)', () => {
    const p = parsePeriod('2026-04');
    expect(p.kind).toBe('month');
    expect(p.year).toBe(2026);
    expect(p.start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('parses quarterly period', () => {
    const p = parsePeriod('2026-Q2');
    expect(p.kind).toBe('quarter');
    expect(p.start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('parses yearly period', () => {
    const p = parsePeriod('2026');
    expect(p.kind).toBe('year');
    expect(p.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(p.end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('rejects invalid month 00 / 13', () => {
    expect(() => parsePeriod('2026-00')).toThrow(PeriodParseError);
    expect(() => parsePeriod('2026-13')).toThrow(PeriodParseError);
  });

  it('rejects invalid quarter 0 / 5', () => {
    expect(() => parsePeriod('2026-Q0')).toThrow(PeriodParseError);
    expect(() => parsePeriod('2026-Q5')).toThrow(PeriodParseError);
  });

  it('rejects garbage', () => {
    expect(() => parsePeriod('')).toThrow(PeriodParseError);
    expect(() => parsePeriod('2026/04')).toThrow(PeriodParseError);
    expect(() => parsePeriod('April 2026')).toThrow(PeriodParseError);
    expect(() => parsePeriod('2026-4')).toThrow(PeriodParseError); // not zero-padded
  });
});

describe('daysInPeriod', () => {
  it('handles 30-day months', () => {
    expect(daysInPeriod(parsePeriod('2026-04'))).toBe(30);
  });

  it('handles 31-day months', () => {
    expect(daysInPeriod(parsePeriod('2026-01'))).toBe(31);
  });

  it('handles February in a non-leap year', () => {
    expect(daysInPeriod(parsePeriod('2026-02'))).toBe(28);
  });

  it('handles February in a leap year', () => {
    expect(daysInPeriod(parsePeriod('2024-02'))).toBe(29);
  });

  it('handles Q1 (Jan-Mar)', () => {
    // 31 + 28 + 31 = 90 (non-leap)
    expect(daysInPeriod(parsePeriod('2026-Q1'))).toBe(90);
  });

  it('handles Q2 (Apr-Jun)', () => {
    // 30 + 31 + 30 = 91
    expect(daysInPeriod(parsePeriod('2026-Q2'))).toBe(91);
  });

  it('handles full non-leap year', () => {
    expect(daysInPeriod(parsePeriod('2026'))).toBe(365);
  });

  it('handles full leap year', () => {
    expect(daysInPeriod(parsePeriod('2024'))).toBe(366);
  });
});

describe('expandToMonths', () => {
  it('returns the same month for a monthly period', () => {
    expect(expandToMonths(parsePeriod('2026-04'))).toEqual(['2026-04']);
  });

  it('expands Q2 to [Apr, May, Jun]', () => {
    expect(expandToMonths(parsePeriod('2026-Q2'))).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
    ]);
  });

  it('expands Q4 to [Oct, Nov, Dec]', () => {
    expect(expandToMonths(parsePeriod('2026-Q4'))).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
  });

  it('expands yearly period to all 12 months, zero-padded', () => {
    expect(expandToMonths(parsePeriod('2026'))).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
      '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
    ]);
  });
});

describe('currentBakuYear', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a 4-digit YYYY string (sanity)', () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    expect(currentBakuYear()).toMatch(/^\d{4}$/);
  });

  it('returns Baku-local year at mid-day (UTC 12:00 = Baku 16:00, same date)', () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    expect(currentBakuYear()).toBe('2026');
  });

  it('returns NEXT year at year-boundary footgun (UTC 2026-12-31 23:30 = Baku 2027-01-01 03:30)', () => {
    // This is the exact bug L433 documents — at AZ-local 2027-01-01 03:30,
    // a UTC reader returns "2026" but the user expects "2027". The
    // Asia/Baku-anchored reader must return "2027".
    vi.setSystemTime(new Date('2026-12-31T23:30:00Z'));
    expect(currentBakuYear()).toBe('2027');
  });

  it('returns CURRENT year just before year-boundary (UTC 2026-12-31 19:30 = Baku 2026-12-31 23:30)', () => {
    // Mirror case — UTC and Baku still agree before Baku midnight.
    vi.setSystemTime(new Date('2026-12-31T19:30:00Z'));
    expect(currentBakuYear()).toBe('2026');
  });
});

describe('currentBakuYearNumber', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns numeric year (mid-year, agrees with currentBakuYear)', () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    expect(currentBakuYearNumber()).toBe(2026);
    expect(currentBakuYearNumber()).toBe(Number(currentBakuYear()));
  });

  it('returns NEXT year at year-boundary footgun (UTC 2026-12-31 23:30 = Baku 2027-01-01 03:30)', () => {
    vi.setSystemTime(new Date('2026-12-31T23:30:00Z'));
    expect(currentBakuYearNumber()).toBe(2027);
  });
});

describe('currentBakuYearMonth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 1-indexed month + Baku-anchored year (mid-day)', () => {
    // UTC 2026-06-15 12:00 = Baku 2026-06-15 16:00. June = 6.
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    expect(currentBakuYearMonth()).toEqual({ year: 2026, month: 6 });
  });

  it('flips year + month at year-boundary footgun (UTC 2026-12-31 23:30 = Baku 2027-01-01 03:30)', () => {
    vi.setSystemTime(new Date('2026-12-31T23:30:00Z'));
    expect(currentBakuYearMonth()).toEqual({ year: 2027, month: 1 });
  });

  it('flips month at month-boundary (UTC 2026-04-30 21:30 = Baku 2026-05-01 01:30)', () => {
    vi.setSystemTime(new Date('2026-04-30T21:30:00Z'));
    expect(currentBakuYearMonth()).toEqual({ year: 2026, month: 5 });
  });
});
