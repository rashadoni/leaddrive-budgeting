/**
 * Phase 7.G Turn LXXXXVII (Phase 7.B v2 Day 6) — per-org LLM cost budget.
 * **Promoted Turn LXXXXII** to dual-write: Prisma `AITokenUsage` primary,
 * in-memory Map fallback when migration not yet applied. See
 * `src/lib/prisma-promotion.ts` for the helper rationale.
 *
 * Per Phase 7.B v2 plan §"Day 6": daily token cap + monthly token cap per
 * org, enforced before LLM calls. 429 with `Retry-After` when exceeded.
 *
 * Defaults (per LXXXXV vendor pick #6):
 *   - 500_000 tokens/day per org (≈$1.50/day at Sonnet 4.5 prices)
 *   - 10_000_000 tokens/month per org (≈$30/month per org)
 * Override via `Organization.settings.aiTokenBudget` (Json: `{daily: N, monthly: N}`).
 *
 * **Persistence (post-migrate):** Prisma `AITokenUsage` table keyed by
 * (orgId, date) — durable across restarts, queryable for admin dashboards.
 *
 * **In-memory fallback (pre-migrate):** module-level `Map` keyed by
 * `${orgId}:${date}` → `{tokensIn, tokensOut, calls}`. Loses on restart →
 * partial budget reset. Acceptable for MVP because:
 * - Restarts are rare (LaunchAgent kickstart only on dev)
 * - Audit log preserves token spend trail (running sum from
 *   audit_event metadata) — admin UI can reconstruct true spend
 *   for a given period via aggregate query
 * - Worst case: budget over-spend by a fraction of one cycle
 */

import { prisma as defaultPrisma } from "@/lib/prisma"
import { tryPrismaThenFallback } from "@/lib/prisma-promotion"

const DEFAULT_DAILY_TOKEN_CAP = 500_000
const DEFAULT_MONTHLY_TOKEN_CAP = 10_000_000

export type TokenBudget = {
  daily: number
  monthly: number
}

export type UsageStats = {
  tokensIn: number
  tokensOut: number
  calls: number
  /** Combined in+out for budget comparisons. */
  total: number
}

export type BudgetCheckResult =
  | { ok: true; remaining: { daily: number; monthly: number } }
  | { ok: false; reason: "daily" | "monthly"; resetAt: Date; cap: number; used: number }

// Storage: `${orgId}:${YYYY-MM-DD}` → daily usage
const dailyUsage = new Map<string, UsageStats>()

function todayKey(orgId: string, date: Date = new Date()): string {
  const d = date.toISOString().slice(0, 10) // YYYY-MM-DD UTC
  return `${orgId}:${d}`
}

function monthKeyOf(date: Date): string {
  return date.toISOString().slice(0, 7) // YYYY-MM
}

function tomorrowMidnightUTC(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
}

function nextMonthFirstUTC(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

function emptyStats(): UsageStats {
  return { tokensIn: 0, tokensOut: 0, calls: 0, total: 0 }
}

/** Get aggregated daily usage for an org+date.
 *  Reads Prisma `AITokenUsage` (primary), falls back to in-memory map. */
export async function getDailyUsage(orgId: string, date: Date = new Date()): Promise<UsageStats> {
  const dateStr = date.toISOString().slice(0, 10)
  return await tryPrismaThenFallback<UsageStats>(
    async () => {
      const row = await defaultPrisma.aITokenUsage.findUnique({
        where: {
          organizationId_date: { organizationId: orgId, date: dateStr },
        },
      })
      if (!row) {
        // Mirror empty so subsequent in-process reads don't re-hit DB
        const empty = emptyStats()
        // Note: don't write to dailyUsage Map here — empty is the natural absence
        return empty
      }
      const stats: UsageStats = {
        tokensIn: row.tokensIn,
        tokensOut: row.tokensOut,
        calls: row.calls,
        total: row.tokensIn + row.tokensOut,
      }
      // Mirror to in-memory for hot reads
      dailyUsage.set(todayKey(orgId, date), stats)
      return stats
    },
    () => {
      const entry = dailyUsage.get(todayKey(orgId, date))
      return entry ?? emptyStats()
    },
  )
}

/** Get aggregated monthly usage by summing all daily entries within month.
 *  Reads Prisma (sums via aggregate), falls back to in-memory scan. */
export async function getMonthlyUsage(orgId: string, date: Date = new Date()): Promise<UsageStats> {
  const month = monthKeyOf(date) // YYYY-MM
  return await tryPrismaThenFallback<UsageStats>(
    async () => {
      // Prisma string startsWith filter — efficient with the (orgId, date desc) index
      const rows = await defaultPrisma.aITokenUsage.findMany({
        where: {
          organizationId: orgId,
          date: { startsWith: month },
        },
        select: { tokensIn: true, tokensOut: true, calls: true },
      })
      let tokensIn = 0
      let tokensOut = 0
      let calls = 0
      for (const r of rows) {
        tokensIn += r.tokensIn
        tokensOut += r.tokensOut
        calls += r.calls
      }
      return { tokensIn, tokensOut, calls, total: tokensIn + tokensOut }
    },
    () => {
      const orgPrefix = `${orgId}:${month}`
      let tokensIn = 0
      let tokensOut = 0
      let calls = 0
      for (const [key, usage] of dailyUsage.entries()) {
        if (key.startsWith(orgPrefix)) {
          tokensIn += usage.tokensIn
          tokensOut += usage.tokensOut
          calls += usage.calls
        }
      }
      return { tokensIn, tokensOut, calls, total: tokensIn + tokensOut }
    },
  )
}

/**
 * Check if an org has budget remaining for an LLM call. Returns
 * BudgetCheckResult — caller (route handler) returns 429 if !ok.
 *
 * Estimates input tokens before call (caller passes expected count or
 * a heuristic). For routes that can't estimate, omit `expectedInput` —
 * check uses 0 + relies on post-call `recordUsage()` to true-up.
 *
 * **Async** (LXXXXII promotion): reads from Prisma (primary) or memory (fallback).
 */
export async function checkBudget(
  orgId: string,
  budget: TokenBudget = { daily: DEFAULT_DAILY_TOKEN_CAP, monthly: DEFAULT_MONTHLY_TOKEN_CAP },
  expectedInput: number = 0,
): Promise<BudgetCheckResult> {
  const today = await getDailyUsage(orgId)
  const month = await getMonthlyUsage(orgId)

  if (today.total + expectedInput > budget.daily) {
    return {
      ok: false,
      reason: "daily",
      resetAt: tomorrowMidnightUTC(),
      cap: budget.daily,
      used: today.total,
    }
  }
  if (month.total + expectedInput > budget.monthly) {
    return {
      ok: false,
      reason: "monthly",
      resetAt: nextMonthFirstUTC(),
      cap: budget.monthly,
      used: month.total,
    }
  }
  return {
    ok: true,
    remaining: {
      daily: budget.daily - today.total,
      monthly: budget.monthly - month.total,
    },
  }
}

/** Record actual usage after an LLM call completes. Caller passes
 * the LLMUsage from getLLMService(). Writes through to Prisma + memory. */
export async function recordUsage(
  orgId: string,
  usage: { inputTokens: number; outputTokens: number },
): Promise<void> {
  const date = new Date()
  const dateStr = date.toISOString().slice(0, 10)
  const key = todayKey(orgId, date)

  await tryPrismaThenFallback<void>(
    async () => {
      // Atomic upsert with increment — race-safe across concurrent LLM calls.
      const row = await defaultPrisma.aITokenUsage.upsert({
        where: {
          organizationId_date: { organizationId: orgId, date: dateStr },
        },
        create: {
          organizationId: orgId,
          date: dateStr,
          tokensIn: usage.inputTokens,
          tokensOut: usage.outputTokens,
          calls: 1,
        },
        update: {
          tokensIn: { increment: usage.inputTokens },
          tokensOut: { increment: usage.outputTokens },
          calls: { increment: 1 },
        },
      })
      // Mirror to in-memory for hot reads
      dailyUsage.set(key, {
        tokensIn: row.tokensIn,
        tokensOut: row.tokensOut,
        calls: row.calls,
        total: row.tokensIn + row.tokensOut,
      })
    },
    () => {
      // Pre-migrate fallback — write to in-memory only.
      const existing = dailyUsage.get(key) ?? emptyStats()
      existing.tokensIn += usage.inputTokens
      existing.tokensOut += usage.outputTokens
      existing.calls += 1
      existing.total = existing.tokensIn + existing.tokensOut
      dailyUsage.set(key, existing)
    },
  )
}

/** Convenience wrapper: check + execute + record. Throws if over budget. */
export async function withTokenBudget<T>(
  orgId: string,
  fn: () => Promise<{ result: T; usage: { inputTokens: number; outputTokens: number } }>,
  budget?: TokenBudget,
): Promise<T> {
  const check = await checkBudget(orgId, budget)
  if (!check.ok) {
    const err = new Error(
      `LLM ${check.reason} token budget exceeded (used ${check.used}/${check.cap}). Resets at ${check.resetAt.toISOString()}.`,
    )
    ;(err as Error & { status?: number; resetAt?: Date }).status = 429
    ;(err as Error & { status?: number; resetAt?: Date }).resetAt = check.resetAt
    throw err
  }
  const { result, usage } = await fn()
  await recordUsage(orgId, usage)
  return result
}

/** Test-only: clear in-memory storage. */
export function clearBudgetForTests(): void {
  dailyUsage.clear()
}

/** Default budget for tests / routes that don't read Organization.settings. */
export const DEFAULT_BUDGET: TokenBudget = {
  daily: DEFAULT_DAILY_TOKEN_CAP,
  monthly: DEFAULT_MONTHLY_TOKEN_CAP,
}
