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
import type { PrismaClient } from "@prisma/client"
import type { LockedPeriod } from "./period-lock"
import { logAuditEvent } from "@/lib/audit/log"

/**
 * Optional audit context for `lockedResponse`. When provided, the helper
 * fires a `period_lock_blocked_mutation` audit event (fire-and-forget;
 * audit-write failures are swallowed to never block the 423). Pass `null`
 * or omit to skip audit logging — useful for tests and for routes where
 * the user identity isn't easily available at the gate point.
 *
 * Phase 7.G Turn LXX (Phase 4.2 closure): introduced to centralize the
 * 423-fire audit trail. CFO compliance can `SELECT * FROM auditEvent
 * WHERE action = 'period_lock_blocked_mutation' AND createdAt > X` to
 * see every blocked attempt with route + period + reason.
 */
export interface LockedResponseAudit {
  prisma: Pick<PrismaClient, "auditEvent">
  orgId: string
  /** null when the route hasn't extracted userId (e.g. only used getOrgId). */
  userId: string | null
  /** Route + verb, e.g. "POST /api/budgeting/lines". Free-form for now;
   *  becomes a typed enum if call frequency grows beyond ~30 routes. */
  route: string
}

/**
 * Build the canonical RFC 4918 `423 Locked` response when a mutation
 * is blocked by an active period lock. Echoes the lock metadata
 * (period / lockedAt / lockedBy / reason) so the frontend can render
 * "Period locked, ask CFO to unlock" with the actual reason text.
 *
 * Why 423 not 403: 423 = "resource is in a locked state" (semantically
 * correct for closed periods, RFC 4918, frontend can branch on 423 to
 * surface "ask CFO to unlock" vs 403 generic permission deny).
 *
 * Optional `audit` parameter — when present, fires a
 * `period_lock_blocked_mutation` audit event (fire-and-forget; never
 * blocks the response). The function intentionally stays SYNC; the
 * audit-log promise is left to settle in the background.
 */
export function lockedResponse(lock: LockedPeriod, audit?: LockedResponseAudit | null): NextResponse {
  if (audit) {
    // Fire-and-forget — never block the 423 on audit-write latency or failure.
    // logAuditEvent already swallows its own errors and returns {ok: false}
    // rather than throwing, so .catch is defensive belt-and-braces.
    void logAuditEvent(audit.prisma as PrismaClient, {
      organizationId: audit.orgId,
      actorUserId: audit.userId,
      event: {
        action: "period_lock_blocked_mutation",
        entityType: "Organization",
        entityId: audit.orgId,
        metadata: {
          period: lock.period,
          lockReason: lock.reason,
          route: audit.route,
        },
      },
    }).catch(() => {})
  }
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
