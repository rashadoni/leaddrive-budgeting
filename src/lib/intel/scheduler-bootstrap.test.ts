// @vitest-environment node
/**
 * Phase 7.G Turn CVIII (Phase 7.E #1 D.5a bootstrap follow-up) — tests for
 * pure scheduler-bootstrap helpers.
 */

import { describe, it, expect, vi } from "vitest"
import {
  enumerateActiveOrgs,
  registerSchedulers,
  staggerOffsetFor,
  type ActiveOrg,
} from "./scheduler-bootstrap"

const ONE_DAY_MS = 24 * 60 * 60 * 1000

describe("staggerOffsetFor — initial-fire delay calculation", () => {
  it("returns 0 for orgIndex=0 (first org fires immediately)", () => {
    expect(staggerOffsetFor(0, 5, ONE_DAY_MS)).toBe(0)
  })

  it("spreads N orgs uniformly across intervalMs", () => {
    expect(staggerOffsetFor(0, 4, 4000)).toBe(0)
    expect(staggerOffsetFor(1, 4, 4000)).toBe(1000)
    expect(staggerOffsetFor(2, 4, 4000)).toBe(2000)
    expect(staggerOffsetFor(3, 4, 4000)).toBe(3000)
  })

  it("returns 0 when orgCount is 0 (no-op caller)", () => {
    expect(staggerOffsetFor(0, 0, ONE_DAY_MS)).toBe(0)
  })

  it("throws on out-of-range orgIndex", () => {
    expect(() => staggerOffsetFor(-1, 5, 1000)).toThrow(/out of range/)
    expect(() => staggerOffsetFor(5, 5, 1000)).toThrow(/out of range/)
    expect(() => staggerOffsetFor(10, 5, 1000)).toThrow(/out of range/)
  })

  it("offsets always less than intervalMs (no overlap with second cycle)", () => {
    for (let n = 1; n <= 100; n++) {
      for (let i = 0; i < n; i++) {
        const offset = staggerOffsetFor(i, n, ONE_DAY_MS)
        expect(offset).toBeGreaterThanOrEqual(0)
        expect(offset).toBeLessThan(ONE_DAY_MS)
      }
    }
  })
})

describe("enumerateActiveOrgs — Prisma-backed lookup", () => {
  it("returns rows ordered by slug asc", async () => {
    const findMany = vi.fn(async () => [
      { id: "id_b", slug: "bob" },
      { id: "id_a", slug: "alice" },
    ])
    const prisma = { organization: { findMany } } as unknown as Parameters<
      typeof enumerateActiveOrgs
    >[0]
    const orgs = await enumerateActiveOrgs(prisma)
    expect(orgs).toHaveLength(2)
    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, slug: true },
      orderBy: { slug: "asc" },
    })
  })

  it("returns empty array when org table empty", async () => {
    const prisma = {
      organization: { findMany: vi.fn(async () => []) },
    } as unknown as Parameters<typeof enumerateActiveOrgs>[0]
    const orgs = await enumerateActiveOrgs(prisma)
    expect(orgs).toEqual([])
  })
})

describe("registerSchedulers — orchestration + cleanup", () => {
  function fakeTimers() {
    const setTimeoutCalls: Array<{ fn: () => void; ms: number; id: number }> = []
    const setIntervalCalls: Array<{ fn: () => void; ms: number; id: number }> = []
    const clearedTimeouts: number[] = []
    const clearedIntervals: number[] = []
    let nextId = 1

    const setTimeoutImpl = ((fn: () => void, ms?: number) => {
      const id = nextId++
      setTimeoutCalls.push({ fn, ms: ms ?? 0, id })
      return id as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout

    const setIntervalImpl = ((fn: () => void, ms?: number) => {
      const id = nextId++
      setIntervalCalls.push({ fn, ms: ms ?? 0, id })
      return id as unknown as ReturnType<typeof setInterval>
    }) as typeof setInterval

    const clearTimeoutImpl = ((id: ReturnType<typeof setTimeout>) => {
      clearedTimeouts.push(id as unknown as number)
    }) as typeof clearTimeout

    const clearIntervalImpl = ((id: ReturnType<typeof setInterval>) => {
      clearedIntervals.push(id as unknown as number)
    }) as typeof clearInterval

    return {
      setTimeoutCalls,
      setIntervalCalls,
      clearedTimeouts,
      clearedIntervals,
      setTimeoutImpl,
      setIntervalImpl,
      clearTimeoutImpl,
      clearIntervalImpl,
    }
  }

  const orgs: ActiveOrg[] = [
    { id: "id_a", slug: "alpha" },
    { id: "id_b", slug: "beta" },
    { id: "id_c", slug: "gamma" },
  ]

  it("schedules one timeout per org with staggered offsets", () => {
    const t = fakeTimers()
    const runner = vi.fn(async () => undefined)
    const result = registerSchedulers(orgs, runner, {
      intervalMs: 3000,
      setTimeoutImpl: t.setTimeoutImpl,
      setIntervalImpl: t.setIntervalImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
      clearIntervalImpl: t.clearIntervalImpl,
    })
    expect(result.orgCount).toBe(3)
    expect(t.setTimeoutCalls).toHaveLength(3)
    expect(t.setTimeoutCalls.map((c) => c.ms)).toEqual([0, 1000, 2000])
    expect(result.staggerSchedule).toEqual([
      { orgId: "id_a", offsetMs: 0 },
      { orgId: "id_b", offsetMs: 1000 },
      { orgId: "id_c", offsetMs: 2000 },
    ])
  })

  it("first timeout invokes runner THEN registers steady interval", async () => {
    const t = fakeTimers()
    const runner = vi.fn(async () => undefined)
    registerSchedulers(orgs.slice(0, 1), runner, {
      intervalMs: 5000,
      setTimeoutImpl: t.setTimeoutImpl,
      setIntervalImpl: t.setIntervalImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
      clearIntervalImpl: t.clearIntervalImpl,
    })
    expect(t.setIntervalCalls).toHaveLength(0)
    // Fire the timeout body
    t.setTimeoutCalls[0].fn()
    expect(runner).toHaveBeenCalledWith("id_a")
    // Now an interval should be registered with intervalMs=5000
    expect(t.setIntervalCalls).toHaveLength(1)
    expect(t.setIntervalCalls[0].ms).toBe(5000)
    // Subsequent interval fires keep calling runner
    t.setIntervalCalls[0].fn()
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it("runner throw is swallowed + logged via opts.logError", async () => {
    const t = fakeTimers()
    const errors: Array<{ msg: string; err: unknown }> = []
    const runner = vi.fn(async () => {
      throw new Error("API down")
    })
    registerSchedulers(orgs.slice(0, 1), runner, {
      intervalMs: 1000,
      setTimeoutImpl: t.setTimeoutImpl,
      setIntervalImpl: t.setIntervalImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
      clearIntervalImpl: t.clearIntervalImpl,
      logError: (msg, err) => errors.push({ msg, err }),
    })
    // Fire the timeout body; the safeRun wrapper inside is async-but-we-don't-await
    t.setTimeoutCalls[0].fn()
    // Wait one microtask for the promise rejection to propagate
    await Promise.resolve()
    await Promise.resolve()
    expect(errors).toHaveLength(1)
    expect(errors[0].msg).toContain("id_a")
    expect((errors[0].err as Error).message).toBe("API down")
  })

  it("cleanup() clears all pending timeouts AND intervals (idempotent)", () => {
    const t = fakeTimers()
    const result = registerSchedulers(orgs, vi.fn(async () => undefined), {
      intervalMs: 1000,
      setTimeoutImpl: t.setTimeoutImpl,
      setIntervalImpl: t.setIntervalImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
      clearIntervalImpl: t.clearIntervalImpl,
    })
    // Fire one timeout to register an interval
    t.setTimeoutCalls[0].fn()
    expect(t.setIntervalCalls).toHaveLength(1)
    result.cleanup()
    // All 3 timeouts cleared + the 1 registered interval cleared
    expect(t.clearedTimeouts).toEqual([1, 2, 3])
    expect(t.clearedIntervals).toEqual([4])
    // Idempotent — calling again does NOT re-clear
    result.cleanup()
    expect(t.clearedTimeouts).toHaveLength(3)
    expect(t.clearedIntervals).toHaveLength(1)
  })

  it("zero orgs → orgCount=0 + cleanup is a no-op", () => {
    const t = fakeTimers()
    const result = registerSchedulers([], vi.fn(), {
      setTimeoutImpl: t.setTimeoutImpl,
      setIntervalImpl: t.setIntervalImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
      clearIntervalImpl: t.clearIntervalImpl,
    })
    expect(result.orgCount).toBe(0)
    expect(result.staggerSchedule).toEqual([])
    expect(t.setTimeoutCalls).toEqual([])
    result.cleanup()
    expect(t.clearedTimeouts).toEqual([])
  })

  it("uses default 24h intervalMs when option omitted", () => {
    const t = fakeTimers()
    registerSchedulers(orgs.slice(0, 1), vi.fn(async () => undefined), {
      setTimeoutImpl: t.setTimeoutImpl,
      setIntervalImpl: t.setIntervalImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
      clearIntervalImpl: t.clearIntervalImpl,
    })
    // Fire timeout → registers interval at default ms
    t.setTimeoutCalls[0].fn()
    expect(t.setIntervalCalls[0].ms).toBe(ONE_DAY_MS)
  })
})
