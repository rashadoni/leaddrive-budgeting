/**
 * Phase 7.G Turn LXIX (Phase 4.2 — bulk-mutation gate fan-out).
 *
 * HTTP-flavored helpers for period-lock enforcement at the route layer.
 * Kept SEPARATE from `period-lock.ts` (pure module, node-env testable)
 * so the pure module stays free of `next/server` dependency. Routes
 * consume both:
 *   - `period-lock.ts` for the data layer (parse / find / derive)
 *   - `period-lock-http.ts` for the response shape
 *
 * Why extract: with Turn LXVIII follow-up landing 3 inline copies of
 * `lockedResponse` (lines/[id], actuals/[id], sections/[id]) and Turn
 * LXIX adding 7 more, the inline copy-paste rate hit the same threshold
 * that triggered the `derivePeriodKey` extraction (architect FAIL).
 * Centralizing now makes future format changes (e.g. add `unlockUrl`,
 * change `error` wording, add localization key) a 1-line edit.
 */

import { NextResponse } from "next/server"
import type { LockedPeriod } from "./period-lock"

/**
 * Build the canonical RFC 4918 `423 Locked` response when a mutation
 * is blocked by an active period lock. Echoes the lock metadata
 * (period / lockedAt / lockedBy / reason) so the frontend can render
 * "Period locked, ask CFO to unlock" with the actual reason text.
 *
 * Why 423 not 403: 423 = "resource is in a locked state" (semantically
 * correct for closed periods, RFC 4918, frontend can branch on 423 to
 * surface "ask CFO to unlock" vs 403 generic permission deny).
 */
export function lockedResponse(lock: LockedPeriod): NextResponse {
  return NextResponse.json(
    {
      error: "Period locked — mutations rejected",
      lock: {
        period: lock.period,
        lockedAt: lock.lockedAt,
        lockedBy: lock.lockedBy,
        reason: lock.reason,
      },
    },
    { status: 423 },
  )
}

/**
 * Compute the set of period keys that contain a given (year, month)
 * pair. Used by routes whose mutations target specific year+month
 * directly (no plan reference) — e.g. `cash-flow/route.ts` direct POST,
 * `rolling/route.ts` PATCH close-month, `snapshot-actuals` with
 * targetMonth. Returns ["YYYY-MM", "YYYY-QN", "YYYY"] in input-order
 * precedence (most-specific first → less-specific last). Caller passes
 * the result to `findFirstActiveLockInPeriods`.
 *
 * Strict-string convention: locking "2026" does NOT auto-block
 * "2026-Q1"; the caller must opt-in by including all relevant
 * granularity keys in the check (this helper does that opt-in).
 */
export function containingPeriodKeys(year: number, month: number): string[] {
  const monthKey = `${year}-${String(month).padStart(2, "0")}`
  const quarterKey = `${year}-Q${Math.ceil(month / 3)}`
  const yearKey = String(year)
  return [monthKey, quarterKey, yearKey]
}

/**
 * Multi-month variant — useful for routes mutating multiple year+month
 * pairs (rolling forecast 12 months, snapshot-actuals across plans,
 * import-excel ingesting a year of data). Deduplicates resulting keys.
 */
export function containingPeriodKeysForMonths(
  pairs: ReadonlyArray<{ year: number; month: number }>,
): string[] {
  const set = new Set<string>()
  for (const { year, month } of pairs) {
    for (const key of containingPeriodKeys(year, month)) set.add(key)
  }
  return Array.from(set)
}
