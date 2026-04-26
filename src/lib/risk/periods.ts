/**
 * Phase 7.A.0 — period string ↔ UTC range parser.
 *
 * Periods are always stored as strings on IndicatorValue.period. The format
 * mirrors the seed data:
 *   "2026-04"   → monthly
 *   "2026-Q2"   → quarterly
 *   "2026"      → yearly
 *
 * All ranges are `[start, end)` half-open in UTC so the edge of a period does
 * not collide with the start of the next one.
 */

export type PeriodKind = 'month' | 'quarter' | 'year';

export type Period = {
  raw: string;
  kind: PeriodKind;
  year: number;
  /** inclusive UTC start */
  start: Date;
  /** exclusive UTC end */
  end: Date;
};

export class PeriodParseError extends Error {
  constructor(readonly raw: string, reason: string) {
    super(`Invalid period "${raw}": ${reason}`);
    this.name = 'PeriodParseError';
  }
}

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const QUARTER_RE = /^(\d{4})-Q([1-4])$/;
const YEAR_RE = /^(\d{4})$/;

export function parsePeriod(raw: string): Period {
  const m = raw.match(MONTH_RE);
  if (m) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    if (month < 1 || month > 12) {
      throw new PeriodParseError(raw, `month must be 01–12`);
    }
    return {
      raw,
      kind: 'month',
      year,
      start: new Date(Date.UTC(year, month - 1, 1)),
      end: new Date(Date.UTC(year, month, 1)),
    };
  }
  const q = raw.match(QUARTER_RE);
  if (q) {
    const year = parseInt(q[1], 10);
    const quarter = parseInt(q[2], 10);
    const startMonth = (quarter - 1) * 3;
    return {
      raw,
      kind: 'quarter',
      year,
      start: new Date(Date.UTC(year, startMonth, 1)),
      end: new Date(Date.UTC(year, startMonth + 3, 1)),
    };
  }
  const y = raw.match(YEAR_RE);
  if (y) {
    const year = parseInt(y[1], 10);
    return {
      raw,
      kind: 'year',
      year,
      start: new Date(Date.UTC(year, 0, 1)),
      end: new Date(Date.UTC(year + 1, 0, 1)),
    };
  }
  throw new PeriodParseError(raw, `expected "YYYY-MM", "YYYY-Qn", or "YYYY"`);
}

/** Whole days in a period — useful for rooms_available = totalRooms * days. */
export function daysInPeriod(period: Period): number {
  return Math.round(
    (period.end.getTime() - period.start.getTime()) / 86_400_000,
  );
}

/** Expand a quarter/year period into the monthly sub-period strings it covers. */
export function expandToMonths(period: Period): string[] {
  if (period.kind === 'month') return [period.raw];
  const out: string[] = [];
  const cursor = new Date(period.start);
  while (cursor < period.end) {
    const y = cursor.getUTCFullYear();
    const m = (cursor.getUTCMonth() + 1).toString().padStart(2, '0');
    out.push(`${y}-${m}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}
