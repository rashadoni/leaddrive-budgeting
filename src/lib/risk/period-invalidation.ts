/**
 * Phase 10 / Stage B3 — exact period invalidation.
 *
 * 05-TEST-UAT-ROLLOUT §4.4: when a monthly fact changes, the recompute must
 * invalidate the exact month, its quarter, every affected YTD, the fiscal year
 * and every affected LTM window. ADR Trust Core §4: recompute is **exact** and
 * idempotent — not "recompute everything", and not "recompute the month and
 * hope".
 *
 * Both failure directions are real:
 * - **Under-invalidation** leaves a stale aggregate that still reads
 *   decision-grade. A corrected March figure that never reaches `2026-YTD-05`
 *   means the YTD on screen silently disagrees with its own months.
 * - **Over-invalidation** ("just recompute the year") is how a cheap correction
 *   turns into a full re-derive, and 05 §15 already flags shadow compute
 *   doubling load.
 *
 * This module answers only *which period keys are affected*. It is pure: no
 * database, no queue, no clock. Parent rollups, composites, alerts and events
 * (§4.4's remaining bullets) depend on org structure and belong to the writer
 * that consumes this list — they are not derivable from a month string.
 *
 * Nothing here computes money.
 */

import { parsePeriodKey, type PeriodContextKind } from './period-context';
import { PeriodParseError } from './periods';

const MONTH_RE = /^(\d{4})-(\d{2})$/;

/** Months in a trailing-twelve-month window. Named, not a bare 12 in the math. */
const LTM_WINDOW_MONTHS = 12;

export interface InvalidationOptions {
  /**
   * Emit LTM windows. Default true.
   *
   * A single changed month sits inside 12 distinct LTM windows, so this is the
   * expensive half of the fan-out. Callers that do not serve LTM can switch it
   * off rather than queue 12 keys nobody reads.
   */
  includeLtm?: boolean;
  /**
   * Emit YTD keys. Default true. A month in January affects 12 YTD windows
   * (YTD-01 … YTD-12); a month in December affects exactly one.
   */
  includeYtd?: boolean;
}

/**
 * Every period key whose value can change when `changedMonth` changes.
 *
 * @param changedMonth `YYYY-MM`. The grain at which facts actually land.
 * @returns Deduplicated keys, ascending by kind then key, so a queue can
 *   compare two fan-outs for equality without sorting them itself
 *   (idempotency: the same change must produce the same message set).
 */
export function invalidatedPeriodKeys(
  changedMonth: string,
  opts: InvalidationOptions = {},
): string[] {
  const { includeLtm = true, includeYtd = true } = opts;
  const m = changedMonth.match(MONTH_RE);
  if (!m) {
    throw new PeriodParseError(changedMonth, 'expected a month key "YYYY-MM"');
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) {
    throw new PeriodParseError(changedMonth, 'month must be 01–12');
  }

  const keys: string[] = [];

  // 1. The exact month.
  keys.push(changedMonth);

  // 2. Its quarter.
  keys.push(`${year}-Q${Math.floor((month - 1) / 3) + 1}`);

  // 3. The fiscal year.
  keys.push(String(year));

  // 4. Every YTD window that contains the month: YTD through the month itself,
  //    and through every later month of the same year. YTD-04 does not contain
  //    May, so a May change must not touch it.
  if (includeYtd) {
    for (let end = month; end <= 12; end++) {
      keys.push(`${year}-YTD-${pad(end)}`);
    }
  }

  // 5. Every LTM window that contains the month: the window ending on the month
  //    itself, plus the 11 that trail it. A change to 2026-05 reaches
  //    LTM 2026-05 … LTM 2027-04 — the last of which lives in the *next*
  //    fiscal year, which is exactly the case a year-scoped invalidation misses.
  if (includeLtm) {
    for (let offset = 0; offset < LTM_WINDOW_MONTHS; offset++) {
      // Date.UTC normalises month overflow (month 13 → next January), so the
      // year boundary is handled by the calendar rather than by hand.
      const d = new Date(Date.UTC(year, month - 1 + offset, 1));
      keys.push(`${d.getUTCFullYear()}-LTM-${pad(d.getUTCMonth() + 1)}`);
    }
  }

  return sortKeys(Array.from(new Set(keys)));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Stable order: by kind (coarse → fine is meaningless here, so fixed), then key. */
const KIND_ORDER: Record<PeriodContextKind, number> = {
  MONTH: 0,
  QUARTER: 1,
  YTD: 2,
  FY: 3,
  LTM: 4,
};

function sortKeys(keys: string[]): string[] {
  return keys.sort((a, b) => {
    const ka = KIND_ORDER[parsePeriodKey(a).kind];
    const kb = KIND_ORDER[parsePeriodKey(b).kind];
    return ka !== kb ? ka - kb : a.localeCompare(b);
  });
}

/**
 * True when `periodKey`'s value can change if `changedMonth` changes — i.e.
 * the month falls inside the period's span.
 *
 * The direct form of the same question as `invalidatedPeriodKeys`, for callers
 * holding a key and asking "do I care about this change?". Kept consistent with
 * the fan-out by construction: both derive spans from `parsePeriodKey`.
 */
export function periodContainsMonth(
  periodKey: string,
  changedMonth: string,
): boolean {
  return parsePeriodKey(periodKey).months.includes(changedMonth);
}
