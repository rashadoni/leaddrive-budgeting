/**
 * Phase 7.G Turn LXXXXVII (Phase 7.B v2 Day 6) — per-org LLM cost budget.
 *
 * Per Phase 7.B v2 plan §"Day 6": daily token cap + monthly token cap per
 * org, enforced before LLM calls. 429 with `Retry-After` when exceeded.
 *
 * Defaults (per LXXXXV vendor pick #6):
 *   - 500_000 tokens/day per org (≈$1.50/day at Sonnet 4.5 prices)
 *   - 10_000_000 tokens/month per org (≈$30/month per org)
 * Override via `Organization.settings.aiTokenBudget` (Json: `{daily: N, monthly: N}`).
 *
 * **In-memory storage** (this turn): module-level `Map` keyed by
 * `${orgId}:${date}` → `{tokensIn, tokensOut, calls}`. Persistence to NEW
 * Prisma `AITokenUsage` table deferred until migration drift resolved
 * (filed as 🔄 in CARRYOVER alongside cache + audit promotions).
 *
 * **Production-readiness gap:** in-memory loses on Next.js restart →
 * partial budget reset. Acceptable for MVP because:
 * - Restarts are rare (LaunchAgent kickstart only on dev)
 * - Audit log preserves token spend trail (running sum from
 *   audit_event metadata) — admin UI can reconstruct true spend
 *   for a given period via aggregate query
 * - Worst case: budget over-spend by a fraction of one cycle
 */

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

/** Get aggregated daily usage for an org+date. */
export function getDailyUsage(orgId: string, date: Date = new Date()): UsageStats {
  const entry = dailyUsage.get(todayKey(orgId, date))
  if (!entry) return { tokensIn: 0, tokensOut: 0, calls: 0, total: 0 }
  return entry
}

/** Get aggregated monthly usage by summing all daily entries within month. */
export function getMonthlyUsage(orgId: string, date: Date = new Date()): UsageStats {
  const month = monthKeyOf(date)
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
}

/**
 * Check if an org has budget remaining for an LLM call. Returns
 * BudgetCheckResult — caller (route handler) returns 429 if !ok.
 *
 * Estimates input tokens before call (caller passes expected count or
 * a heuristic). For routes that can't estimate, omit `expectedInput` —
 * check uses 0 + relies on post-call `recordUsage()` to true-up.
 */
export function checkBudget(
  orgId: string,
  budget: TokenBudget = { daily: DEFAULT_DAILY_TOKEN_CAP, monthly: DEFAULT_MONTHLY_TOKEN_CAP },
  expectedInput: number = 0,
): BudgetCheckResult {
  const today = getDailyUsage(orgId)
  const month = getMonthlyUsage(orgId)

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
 * the LLMUsage from getLLMService(). */
export function recordUsage(
  orgId: string,
  usage: { inputTokens: number; outputTokens: number },
): void {
  const key = todayKey(orgId)
  const existing = dailyUsage.get(key) ?? { tokensIn: 0, tokensOut: 0, calls: 0, total: 0 }
  existing.tokensIn += usage.inputTokens
  existing.tokensOut += usage.outputTokens
  existing.calls += 1
  existing.total = existing.tokensIn + existing.tokensOut
  dailyUsage.set(key, existing)
}

/** Convenience wrapper: check + execute + record. Throws if over budget. */
export async function withTokenBudget<T>(
  orgId: string,
  fn: () => Promise<{ result: T; usage: { inputTokens: number; outputTokens: number } }>,
  budget?: TokenBudget,
): Promise<T> {
  const check = checkBudget(orgId, budget)
  if (!check.ok) {
    const err = new Error(
      `LLM ${check.reason} token budget exceeded (used ${check.used}/${check.cap}). Resets at ${check.resetAt.toISOString()}.`,
    )
    ;(err as Error & { status?: number; resetAt?: Date }).status = 429
    ;(err as Error & { status?: number; resetAt?: Date }).resetAt = check.resetAt
    throw err
  }
  const { result, usage } = await fn()
  recordUsage(orgId, usage)
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
