// @vitest-environment node
/**
 * Phase 7.G Turn LXXXXVII (Phase 7.B v2 Day 6) — cost budget tests.
 * **Promoted Turn LXXXXII** to dual-write: Prisma `AITokenUsage` primary,
 * in-memory Map fallback. Tests stub Prisma → calls hit in-memory path
 * via `tryPrismaThenFallback` table-missing detection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  checkBudget,
  recordUsage,
  withTokenBudget,
  getDailyUsage,
  getMonthlyUsage,
  clearBudgetForTests,
  DEFAULT_BUDGET,
  assertNativeAdminForTokenAccounting,
} from "./cost-budget"

beforeEach(() => {
  clearBudgetForTests()
})

describe("checkBudget", () => {
  it("returns ok=true when usage under cap", async () => {
    const r = await checkBudget("org_a")
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.remaining.daily).toBe(DEFAULT_BUDGET.daily)
      expect(r.remaining.monthly).toBe(DEFAULT_BUDGET.monthly)
    }
  })

  it("returns ok=false when daily cap exceeded", async () => {
    await recordUsage("org_a", { inputTokens: 400_000, outputTokens: 150_000 })
    const r = await checkBudget("org_a")
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe("daily")
      expect(r.cap).toBe(DEFAULT_BUDGET.daily)
      expect(r.used).toBe(550_000)
      expect(r.resetAt).toBeInstanceOf(Date)
    }
  })

  it("returns ok=false when monthly cap exceeded but daily ok", async () => {
    // 11M total spread across days: simulate by directly recording usage
    // many times — but in single test session all goes to today.
    // Instead test with MUCH lower budget for clarity.
    await recordUsage("org_a", { inputTokens: 50_000, outputTokens: 50_000 })
    const lowMonthlyBudget = { daily: 1_000_000, monthly: 50_000 }
    const r = await checkBudget("org_a", lowMonthlyBudget)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe("monthly")
      expect(r.cap).toBe(50_000)
    }
  })

  it("multi-tenant: org_a usage doesn't affect org_b budget", async () => {
    await recordUsage("org_a", { inputTokens: 600_000, outputTokens: 0 })
    expect((await checkBudget("org_a")).ok).toBe(false)
    expect((await checkBudget("org_b")).ok).toBe(true)
  })

  it("respects expectedInput pre-flight estimate", async () => {
    await recordUsage("org_a", { inputTokens: 400_000, outputTokens: 0 })
    // Currently 400k used; default 500k daily cap. Estimating 200k more would push over.
    const r = await checkBudget("org_a", DEFAULT_BUDGET, 200_000)
    expect(r.ok).toBe(false)
  })
})

describe("recordUsage + getDailyUsage", () => {
  it("accumulates usage across calls", async () => {
    await recordUsage("org_a", { inputTokens: 100, outputTokens: 50 })
    await recordUsage("org_a", { inputTokens: 200, outputTokens: 75 })
    const u = await getDailyUsage("org_a")
    expect(u.tokensIn).toBe(300)
    expect(u.tokensOut).toBe(125)
    expect(u.calls).toBe(2)
    expect(u.total).toBe(425)
  })

  it("returns zero stats for never-used org", async () => {
    const u = await getDailyUsage("org_x")
    expect(u).toEqual({ tokensIn: 0, tokensOut: 0, calls: 0, total: 0 })
  })

  it("monthly aggregate sums daily entries", async () => {
    await recordUsage("org_a", { inputTokens: 1000, outputTokens: 500 })
    await recordUsage("org_a", { inputTokens: 2000, outputTokens: 1000 })
    const m = await getMonthlyUsage("org_a")
    expect(m.tokensIn).toBe(3000)
    expect(m.tokensOut).toBe(1500)
    expect(m.calls).toBe(2)
    expect(m.total).toBe(4500)
  })

  it.each([
    { inputTokens: -1, outputTokens: 0 },
    { inputTokens: 0, outputTokens: -1 },
    { inputTokens: 1.5, outputTokens: 0 },
    { inputTokens: Number.NaN, outputTokens: 0 },
    { inputTokens: Number.POSITIVE_INFINITY, outputTokens: 0 },
  ])("rejects invalid usage increments: %j", async (usage) => {
    await expect(recordUsage("org_a", usage)).rejects.toThrow(
      /non-negative safe integer/,
    )
    await expect(getDailyUsage("org_a")).resolves.toEqual({
      tokensIn: 0,
      tokensOut: 0,
      calls: 0,
      total: 0,
    })
  })
})

describe("native-admin accounting guard", () => {
  it("fails closed when the app role is configured without an admin role", () => {
    expect(() =>
      assertNativeAdminForTokenAccounting({
        NODE_ENV: "production",
        DATABASE_URL_APP: "postgresql://app",
        DATABASE_URL_ADMIN: undefined,
        VITEST: undefined,
      }),
    ).toThrow(/requires DATABASE_URL_ADMIN/)
  })

  it("allows paired app/admin URLs and single-role local development", () => {
    expect(() =>
      assertNativeAdminForTokenAccounting({
        NODE_ENV: "production",
        DATABASE_URL_APP: "postgresql://app",
        DATABASE_URL_ADMIN: "postgresql://admin",
        VITEST: undefined,
      }),
    ).not.toThrow()
    expect(() =>
      assertNativeAdminForTokenAccounting({
        NODE_ENV: "development",
        DATABASE_URL_APP: undefined,
        DATABASE_URL_ADMIN: undefined,
        VITEST: undefined,
      }),
    ).not.toThrow()
  })
})

describe("withTokenBudget wrapper", () => {
  it("happy path: under budget → executes + records", async () => {
    const result = await withTokenBudget("org_a", async () => ({
      result: "success",
      usage: { inputTokens: 100, outputTokens: 50 },
    }))
    expect(result).toBe("success")
    expect((await getDailyUsage("org_a")).total).toBe(150)
  })

  it("over budget → throws 429-tagged error", async () => {
    await recordUsage("org_a", { inputTokens: 600_000, outputTokens: 0 })
    await expect(
      withTokenBudget("org_a", async () => ({
        result: "should not reach",
        usage: { inputTokens: 100, outputTokens: 50 },
      })),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/budget exceeded/),
      status: 429,
    })
    // Did NOT record (call never executed)
    expect((await getDailyUsage("org_a")).calls).toBe(1) // only the priming recordUsage above
  })

  it("custom budget override", async () => {
    const tinyBudget = { daily: 10, monthly: 100 }
    await expect(
      withTokenBudget(
        "org_a",
        async () => ({
          result: "won't reach",
          usage: { inputTokens: 100, outputTokens: 0 },
        }),
        tinyBudget,
      ),
    ).resolves.toBe("won't reach") // 0 + 0 estimate < 10, passes pre-check; records 100 after
    // Now over budget for next call
    const r = await checkBudget("org_a", tinyBudget)
    expect(r.ok).toBe(false)
  })
})

describe("capFromEnv — env-overridable ceilings (2026-07-15)", () => {
  // The caps were hardcoded, so raising one meant a release. They're now
  // operational knobs — but a typo must never silently uncap spend.
  const KEY = "LLM_DAILY_TOKEN_CAP"
  const original = process.env[KEY]
  afterEach(() => {
    if (original === undefined) delete process.env[KEY]
    else process.env[KEY] = original
    vi.resetModules()
  })

  async function loadCap(value?: string): Promise<number> {
    if (value === undefined) delete process.env[KEY]
    else process.env[KEY] = value
    vi.resetModules()
    const mod = await import("./cost-budget")
    return mod.DEFAULT_BUDGET.daily
  }

  it("defaults to 500K when unset", async () => {
    expect(await loadCap(undefined)).toBe(500_000)
  })

  it("honours a valid override", async () => {
    expect(await loadCap("700000")).toBe(700_000)
  })

  it.each(["abc", "0", "-1", ""])(
    "falls back to the default for a bad value (%s) — never uncapped",
    async (bad) => {
      expect(await loadCap(bad)).toBe(500_000)
    },
  )
})
