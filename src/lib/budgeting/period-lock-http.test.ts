// @vitest-environment node
/**
 * Phase 7.G Turn LXIX — guard tests for HTTP helpers.
 */

import { describe, it, expect } from "vitest"
import { lockedResponse, containingPeriodKeys, containingPeriodKeysForMonths } from "./period-lock-http"
import type { LockedPeriod } from "./period-lock"

const LOCK: LockedPeriod = {
  period: "2026-Q1",
  lockedAt: "2026-04-01T00:00:00Z",
  lockedBy: "u_admin",
  reason: "Q1 close",
}

describe("lockedResponse — RFC 4918 423 envelope", () => {
  it("returns status 423", () => {
    const res = lockedResponse(LOCK)
    expect(res.status).toBe(423)
  })

  it("body echoes lock metadata", async () => {
    const body = await lockedResponse(LOCK).json()
    expect(body.error).toMatch(/Period locked/i)
    expect(body.lock).toEqual({
      period: "2026-Q1",
      lockedAt: "2026-04-01T00:00:00Z",
      lockedBy: "u_admin",
      reason: "Q1 close",
    })
  })

  it("preserves undefined reason (does not coerce to null)", async () => {
    const lockNoReason: LockedPeriod = { ...LOCK, reason: undefined }
    const body = await lockedResponse(lockNoReason).json()
    expect(body.lock.reason).toBeUndefined()
  })
})

describe("containingPeriodKeys — month → [month, quarter, year]", () => {
  it("returns all 3 granularities in most-specific-first order", () => {
    expect(containingPeriodKeys(2026, 7)).toEqual(["2026-07", "2026-Q3", "2026"])
  })

  it("zero-pads month under 10", () => {
    expect(containingPeriodKeys(2026, 1)).toEqual(["2026-01", "2026-Q1", "2026"])
  })

  it("computes quarter correctly at boundaries", () => {
    expect(containingPeriodKeys(2026, 3)[1]).toBe("2026-Q1") // Mar = Q1
    expect(containingPeriodKeys(2026, 4)[1]).toBe("2026-Q2") // Apr = Q2
    expect(containingPeriodKeys(2026, 12)[1]).toBe("2026-Q4") // Dec = Q4
  })
})

describe("containingPeriodKeysForMonths — bulk dedup", () => {
  it("returns empty array on empty input", () => {
    expect(containingPeriodKeysForMonths([])).toEqual([])
  })

  it("deduplicates overlapping containers", () => {
    // Two months in same quarter → year + quarter shared, only month differs
    const result = containingPeriodKeysForMonths([
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ])
    expect(result).toContain("2026-01")
    expect(result).toContain("2026-02")
    expect(result.filter((k) => k === "2026-Q1")).toHaveLength(1) // dedup
    expect(result.filter((k) => k === "2026")).toHaveLength(1) // dedup
  })

  it("handles cross-quarter span", () => {
    const result = containingPeriodKeysForMonths([
      { year: 2026, month: 1 },
      { year: 2026, month: 4 },
    ])
    expect(result).toContain("2026-Q1")
    expect(result).toContain("2026-Q2")
  })

  it("handles cross-year span", () => {
    const result = containingPeriodKeysForMonths([
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ])
    expect(result).toContain("2026")
    expect(result).toContain("2027")
  })
})
