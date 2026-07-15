/**
 * Phase 10 / Stage B2 — the PeriodContext contract.
 *
 * 03-DATA-KPI-TRUST-SPEC §4.1: every observation, score, alert and scenario
 * carries the full context of *which period, on what basis, from which
 * revision, complete through when*. ADR Trust Core §3: PeriodContext is
 * explicit, versioned and **never inferred** — a consumer must not have to
 * guess whether "2026" means the finished year or five booked months.
 *
 * This module is a pure contract + builder. It has no database access, no
 * caller yet, and it changes no financial value: it describes a period, it
 * never computes money. `buildPeriodContext` takes the facts it needs as
 * inputs rather than fetching them, so it stays deterministic and testable.
 *
 * **Why this exists at all.** The 2026-07-15 FO-workbook session found a month
 * of revenue booked to the previous year by a 24-second timezone drift, and an
 * EBITDA margin reading 169.8% "green" off ~4 booked months of a 12-month year.
 * Both are period-context failures: the number was fine, the claim about *which
 * period it spoke for* was not. `coverageMonths` vs `expectedCoverageMonths` is
 * the structural form of that question.
 *
 * **Date math is UTC, deliberately.** `periods.ts` established the split and it
 * is load-bearing: period *arithmetic* is UTC half-open `[start, end)`, while
 * Asia/Baku is used only to decide what "now" means for a user. Mixing the two
 * is exactly what produced the 24-second drift. `timeZone` below is therefore a
 * declaration of the fiscal calendar's zone, not an instruction to shift these
 * timestamps.
 */

import { parsePeriod, expandToMonths, type Period } from './periods';

/**
 * The spec's period taxonomy (§4.1). Wider than `periods.ts`'s
 * `'month' | 'quarter' | 'year'`, which stays untouched — it is the storage
 * grammar of `IndicatorValue.period` and has many callers.
 */
export type PeriodContextKind = 'MONTH' | 'QUARTER' | 'YTD' | 'FY' | 'LTM';

export type PeriodBasis = 'ACTUAL' | 'PLAN' | 'FORECAST' | 'SCENARIO';

/** The fiscal calendar these periods are expressed in. Single-tenant for now. */
export const FISCAL_TIME_ZONE = 'Asia/Baku' as const;

/**
 * §4.1 verbatim. Every field the spec names is present; none is dropped. The
 * concrete DB schema may later use enums/timestamps, but "no semantic field may
 * be lost".
 */
export interface PeriodContext {
  periodKey: string;
  periodKind: PeriodContextKind;
  fiscalYear: number;
  /** Inclusive ISO start of the period. */
  periodStart: string;
  /** **Exclusive** ISO end — the half-open convention of `periods.ts`. */
  periodEnd: string;
  /** End of the latest month actually observed. Null when nothing is observed. */
  dataThrough: string | null;
  latestClosedMonth: string | null;
  coverageMonths: number;
  expectedCoverageMonths: number;
  financialAsOf: string | null;
  externalAsOf: string | null;
  timeZone: typeof FISCAL_TIME_ZONE;
  basis: PeriodBasis;
  revisionId: string;
  lockedAt: string | null;
  reconciledAt: string | null;
  approvedAt: string | null;
  computedAt: string;
}

export class PeriodKeyParseError extends Error {
  constructor(readonly raw: string, reason: string) {
    super(`Invalid period key "${raw}": ${reason}`);
    this.name = 'PeriodKeyParseError';
  }
}

/**
 * Key grammar. MONTH/QUARTER/FY reuse the strings already stored on
 * `IndicatorValue.period`, so this contract can describe existing data without
 * a migration. YTD and LTM have no stored representation yet and need one; the
 * suffix form keeps them parseable by the same `^\d{4}` year probe that
 * `isPartialYear` already relies on.
 *
 *   2026-05        MONTH
 *   2026-Q2        QUARTER
 *   2026           FY
 *   2026-YTD-05    YTD    — January through May 2026
 *   2026-LTM-05    LTM    — the 12 months ending May 2026 (starts 2025-06)
 */
const YTD_RE = /^(\d{4})-YTD-(\d{2})$/;
const LTM_RE = /^(\d{4})-LTM-(\d{2})$/;

export interface ParsedPeriodKey {
  periodKey: string;
  kind: PeriodContextKind;
  fiscalYear: number;
  /** Inclusive UTC start. */
  start: Date;
  /** Exclusive UTC end. */
  end: Date;
  /** Months the period spans, as `YYYY-MM`, ascending. */
  months: string[];
}

function monthKey(year: number, month1: number): string {
  return `${year}-${String(month1).padStart(2, '0')}`;
}

/** Ascending `YYYY-MM` list over a half-open UTC range. */
function monthsBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  const cursor = new Date(start);
  while (cursor < end) {
    out.push(monthKey(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

/**
 * Parse any period key in the grammar above.
 *
 * `fiscalYear` is the year the period is *reported under*, which for LTM is its
 * ending year — an LTM ending May 2026 is a 2026 figure that happens to reach
 * back into 2025.
 */
export function parsePeriodKey(raw: string): ParsedPeriodKey {
  const ytd = raw.match(YTD_RE);
  if (ytd) {
    const year = Number(ytd[1]);
    const month = Number(ytd[2]);
    if (month < 1 || month > 12) {
      throw new PeriodKeyParseError(raw, 'month must be 01–12');
    }
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year, month, 1));
    return {
      periodKey: raw,
      kind: 'YTD',
      fiscalYear: year,
      start,
      end,
      months: monthsBetween(start, end),
    };
  }

  const ltm = raw.match(LTM_RE);
  if (ltm) {
    const year = Number(ltm[1]);
    const month = Number(ltm[2]);
    if (month < 1 || month > 12) {
      throw new PeriodKeyParseError(raw, 'month must be 01–12');
    }
    // 12 months ending *inclusive* of the named month → start 11 months back.
    const end = new Date(Date.UTC(year, month, 1));
    const start = new Date(Date.UTC(year, month - 12, 1));
    return {
      periodKey: raw,
      kind: 'LTM',
      fiscalYear: year,
      start,
      end,
      months: monthsBetween(start, end),
    };
  }

  // MONTH / QUARTER / FY — delegate to the existing parser rather than
  // re-implement its calendar math or drift from its error messages.
  let base: Period;
  try {
    base = parsePeriod(raw);
  } catch {
    throw new PeriodKeyParseError(
      raw,
      'expected "YYYY-MM", "YYYY-Qn", "YYYY", "YYYY-YTD-MM" or "YYYY-LTM-MM"',
    );
  }
  const kind: PeriodContextKind =
    base.kind === 'month' ? 'MONTH' : base.kind === 'quarter' ? 'QUARTER' : 'FY';
  return {
    periodKey: raw,
    kind,
    fiscalYear: base.year,
    start: base.start,
    end: base.end,
    months: expandToMonths(base),
  };
}

/**
 * Months a complete period is expected to contain (§4.3 — a complete period is
 * not "a period with at least one value"). YTD through May expects 5, not 12:
 * that is the distinction that stops `YTD Actual` being read as `FY Actual`.
 */
export function expectedCoverageMonths(parsed: ParsedPeriodKey): number {
  return parsed.months.length;
}

export interface BuildPeriodContextInput {
  periodKey: string;
  basis: PeriodBasis;
  /** The revision these numbers came from. Required — §4.1 has no null. */
  revisionId: string;
  /** ISO. Injected, never `Date.now()`, so the contract is deterministic. */
  computedAt: string;
  /**
   * `YYYY-MM` months for which data was actually observed. May include months
   * outside the period; only those inside count toward coverage.
   */
  observedMonths?: readonly string[];
  /** Latest month closed in the books, `YYYY-MM`. Independent of this period. */
  latestClosedMonth?: string | null;
  financialAsOf?: string | null;
  externalAsOf?: string | null;
  lockedAt?: string | null;
  reconciledAt?: string | null;
  approvedAt?: string | null;
}

/**
 * Build the full context for a period.
 *
 * Everything uncertain resolves to `null` or a count — never to a guess. If no
 * month inside the period was observed, `dataThrough` is `null` and
 * `coverageMonths` is 0; that reads as "we do not know", which §4.2 requires
 * over a plausible-looking default.
 */
export function buildPeriodContext(
  input: BuildPeriodContextInput,
): PeriodContext {
  const parsed = parsePeriodKey(input.periodKey);
  const inPeriod = new Set(parsed.months);

  // Only months belonging to this period count. A caller handing us a whole
  // company's history must not inflate a January-only period's coverage.
  const observedInPeriod = (input.observedMonths ?? [])
    .filter((m) => inPeriod.has(m))
    .sort();
  const uniqueObserved = Array.from(new Set(observedInPeriod));

  const latestObserved = uniqueObserved[uniqueObserved.length - 1] ?? null;

  return {
    periodKey: parsed.periodKey,
    periodKind: parsed.kind,
    fiscalYear: parsed.fiscalYear,
    periodStart: parsed.start.toISOString(),
    periodEnd: parsed.end.toISOString(),
    dataThrough: latestObserved ? endOfMonthIso(latestObserved) : null,
    latestClosedMonth: input.latestClosedMonth ?? null,
    coverageMonths: uniqueObserved.length,
    expectedCoverageMonths: expectedCoverageMonths(parsed),
    financialAsOf: input.financialAsOf ?? null,
    externalAsOf: input.externalAsOf ?? null,
    timeZone: FISCAL_TIME_ZONE,
    basis: input.basis,
    revisionId: input.revisionId,
    lockedAt: input.lockedAt ?? null,
    reconciledAt: input.reconciledAt ?? null,
    approvedAt: input.approvedAt ?? null,
    computedAt: input.computedAt,
  };
}

/** Exclusive end of a `YYYY-MM`, matching the half-open period convention. */
function endOfMonthIso(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString();
}

/**
 * True when the period has every month it expects.
 *
 * **This is not §4.3's "complete period".** That additionally requires passing
 * structural tests, reconciliation, a lock/approval and an identifiable source
 * revision — none of which exist yet (0/1269 rows carry lineage, see A5). This
 * is only the coverage clause, and it is named narrowly so no caller mistakes
 * it for the full gate.
 */
export function hasFullCoverage(ctx: PeriodContext): boolean {
  return (
    ctx.expectedCoverageMonths > 0 &&
    ctx.coverageMonths >= ctx.expectedCoverageMonths
  );
}

/**
 * §4.2's labelling rule: "Actual through May is `YTD May`, not FY Actual", and
 * a full-year plan against a partial actual must be labelled, not silently
 * compared. Returns a stable token, not display copy — i18n owns the wording.
 */
export function isPartialCoverage(ctx: PeriodContext): boolean {
  return ctx.coverageMonths < ctx.expectedCoverageMonths;
}
