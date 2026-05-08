/**
 * Phase 7.G Turn LXVII (Phase 4.2 — period locking foundation).
 *
 * Period locking is a CFO control: once a fiscal period closes,
 * mutations on its budget lines / actuals / sections / etc. must be
 * rejected. This is the canonical Phase 4 audit-and-compliance feature
 * that lets a holding lock March 2026 in April so nobody back-fills
 * actuals + retroactively changes the closing balance.
 *
 * Storage: `Organization.lockedPeriods Json @default("[]")`. Shape is
 * an array of `LockedPeriod` records. We deliberately use Json (not a
 * relational table) because:
 *   - Lock count per org is small (≤ 24 locks for 2 years monthly +
 *     8 quarters + 2 years annual = 34 max realistic).
 *   - Audit trail (who locked when + reason) is captured on the same
 *     row; no JOIN needed.
 *   - Atomic update: lock+audit happen as one Organization update.
 *   - Migration cost: zero — no new table, no FK churn.
 *
 * If lock counts ever exceed ~100/org or per-period audit-event
 * lookups become hot, migrate to a `LockedPeriod` table with FK to
 * Organization. Until then, Json is right-sized.
 *
 * Period format matches `src/lib/risk/periods.ts:parsePeriod` —
 * "YYYY" / "YYYY-Q[1-4]" / "YYYY-MM". Equality compare is strict
 * string match (no normalization). Locking "2026" does NOT block
 * "2026-Q1" — they're different period granularities. If a user
 * locks the year, they should ALSO lock each quarter/month
 * explicitly (admin UI affordance, next-slice).
 *
 * Mutation enforcement (this module only does READ + helpers; the
 * actual API gate is in the route handler):
 *
 * ```ts
 * // route.ts (mutation handler):
 * const lock = await getActivePeriodLock(prisma, orgId, period)
 * if (lock) {
 *   return NextResponse.json(
 *     { error: "Period locked", lock },
 *     { status: 423 } // 423 Locked
 *   )
 * }
 * ```
 *
 * Why 423 (not 403): 403 = "you don't have permission" (could be
 * fixed by a role grant). 423 = "the resource is in a locked state"
 * (semantically correct; user CAN have permission but the period
 * itself is locked). RFC 4918 (WebDAV) defines 423; HTTP/1.1 spec
 * acknowledges it as standardised. Frontend can branch on 423 to
 * surface "Period locked, ask CFO to unlock" vs 403 generic.
 */

import type { PrismaClient } from "@prisma/client"

export interface LockedPeriod {
  /** Period string — "YYYY" / "YYYY-Q[1-4]" / "YYYY-MM". */
  period: string
  /** ISO timestamp of when the period was locked. */
  lockedAt: string
  /** User ID of the admin who locked it. */
  lockedBy: string
  /** Optional human-readable reason ("Q1 close" / "audit period"). */
  reason?: string
}

/**
 * Defensive parser — Json field is unknown shape at runtime; coerce
 * to `LockedPeriod[]` with validation. Returns empty array on any
 * shape error (graceful degradation; caller treats as no-locks).
 */
export function parseLockedPeriods(raw: unknown): LockedPeriod[] {
  if (!Array.isArray(raw)) return []
  const out: LockedPeriod[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    if (typeof e.period !== "string" || e.period.length === 0) continue
    if (typeof e.lockedAt !== "string" || e.lockedAt.length === 0) continue
    if (typeof e.lockedBy !== "string" || e.lockedBy.length === 0) continue
    out.push({
      period: e.period,
      lockedAt: e.lockedAt,
      lockedBy: e.lockedBy,
      reason: typeof e.reason === "string" ? e.reason : undefined,
    })
  }
  return out
}

/**
 * Pure predicate: is `period` locked in the supplied list?
 * Strict string equality — no period-granularity expansion.
 */
export function isPeriodLockedInList(
  locks: readonly LockedPeriod[],
  period: string,
): boolean {
  return locks.some((l) => l.period === period)
}

/**
 * Find the active lock record for `period`, or `null` if not locked.
 * Useful when callers want to surface lock metadata (who/when/reason).
 */
export function findLockForPeriod(
  locks: readonly LockedPeriod[],
  period: string,
): LockedPeriod | null {
  return locks.find((l) => l.period === period) ?? null
}

/**
 * Add a lock to the list — returns NEW array, does not mutate.
 * If the period is already locked, returns the input list unchanged
 * (idempotent). Caller persists via `prisma.organization.update`.
 */
export function addPeriodLock(
  locks: readonly LockedPeriod[],
  newLock: LockedPeriod,
): LockedPeriod[] {
  if (isPeriodLockedInList(locks, newLock.period)) return [...locks]
  return [...locks, newLock]
}

/**
 * Remove a lock from the list — returns NEW array. Idempotent: if the
 * period isn't locked, returns the input list unchanged.
 */
export function removePeriodLock(
  locks: readonly LockedPeriod[],
  period: string,
): LockedPeriod[] {
  return locks.filter((l) => l.period !== period)
}

/**
 * Phase 7.G Turn LXVII follow-up (architect FAIL closure):
 * Derive the canonical `period` key from a `BudgetPlan` row. Mutation
 * routes use this to map a plan → its lock-relevant period before
 * calling `getActivePeriodLock`. Extracted here (not inline at the
 * route) so all ~6 mutation routes share one definition + a future
 * format change (e.g. zero-pad month) is a 1-line edit instead of 6.
 *
 * Format contract (matches `parsePeriod` from `@/lib/risk/periods`):
 *   - "annual"        → "YYYY"
 *   - "quarterly"     → "YYYY-Q[1-4]"
 *   - "monthly"       → "YYYY-MM" (zero-padded)
 *   - any unknown     → "YYYY" fallback (defensive)
 */
export interface PlanPeriodInput {
  periodType: string | null
  year: number
  month?: number | null
  quarter?: number | null
}

export function derivePeriodKey(plan: PlanPeriodInput): string {
  if (plan.periodType === "monthly" && plan.month) {
    return `${plan.year}-${String(plan.month).padStart(2, "0")}`
  }
  if (plan.periodType === "quarterly" && plan.quarter) {
    return `${plan.year}-Q${plan.quarter}`
  }
  return String(plan.year)
}

/**
 * Convenience: load Organization + parse locks + check + return the
 * lock record (or null). Used directly by route handlers as the
 * canonical enforcement entry point. Single Prisma read; no caching
 * (locks are mutated rarely, read-on-write is fine for v1).
 */
export async function getActivePeriodLock(
  prisma: Pick<PrismaClient, "organization">,
  orgId: string,
  period: string,
): Promise<LockedPeriod | null> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { lockedPeriods: true },
  })
  if (!org) return null
  const locks = parseLockedPeriods(org.lockedPeriods)
  return findLockForPeriod(locks, period)
}
