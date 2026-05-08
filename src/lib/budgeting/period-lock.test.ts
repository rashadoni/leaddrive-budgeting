// @vitest-environment node
/**
 * Phase 7.G Turn LXVII — guard tests for period-lock helpers.
 *
 * Locks the parse + predicate + add/remove + query contract. Catches
 * silent regressions in the lock-enforcement chain.
 */

import { describe, it, expect, vi } from "vitest"
import {
  parseLockedPeriods,
  isPeriodLockedInList,
  findLockForPeriod,
  addPeriodLock,
  removePeriodLock,
  getActivePeriodLock,
  derivePeriodKey,
  type LockedPeriod,
} from "./period-lock"

const FIXTURE: LockedPeriod = {
  period: "2026-Q1",
  lockedAt: "2026-04-01T00:00:00Z",
  lockedBy: "user_admin",
  reason: "Q1 close",
}

describe("parseLockedPeriods — defensive Json coercion", () => {
  it("returns empty array for non-array input", () => {
    expect(parseLockedPeriods(null)).toEqual([])
    expect(parseLockedPeriods(undefined)).toEqual([])
    expect(parseLockedPeriods({})).toEqual([])
    expect(parseLockedPeriods("string")).toEqual([])
    expect(parseLockedPeriods(42)).toEqual([])
  })

  it("returns empty array for empty array", () => {
    expect(parseLockedPeriods([])).toEqual([])
  })

  it("parses well-formed entries", () => {
    expect(parseLockedPeriods([FIXTURE])).toEqual([FIXTURE])
  })

  it("filters out shape-invalid entries (missing required fields)", () => {
    expect(
      parseLockedPeriods([
        FIXTURE,
        { period: "" }, // empty period
        { period: "2026-Q2", lockedAt: "" }, // empty lockedAt
        { period: "2026-Q3", lockedAt: "x", lockedBy: "" }, // empty lockedBy
        null,
        "string-not-object",
      ]),
    ).toEqual([FIXTURE])
  })

  it("preserves optional reason when present", () => {
    const withReason = parseLockedPeriods([FIXTURE])[0]
    expect(withReason.reason).toBe("Q1 close")
  })

  it("strips invalid reason types (non-string)", () => {
    const ambiguous: unknown[] = [
      { period: "2026-Q4", lockedAt: "x", lockedBy: "y", reason: 42 },
      { period: "2026", lockedAt: "x", lockedBy: "y", reason: null },
    ]
    const parsed = parseLockedPeriods(ambiguous)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].reason).toBeUndefined()
    expect(parsed[1].reason).toBeUndefined()
  })
})

describe("isPeriodLockedInList — strict string match", () => {
  it("returns true for matching period", () => {
    expect(isPeriodLockedInList([FIXTURE], "2026-Q1")).toBe(true)
  })

  it("returns false for non-matching period", () => {
    expect(isPeriodLockedInList([FIXTURE], "2026-Q2")).toBe(false)
    expect(isPeriodLockedInList([FIXTURE], "2025-Q1")).toBe(false)
  })

  it("does NOT expand granularity (locking '2026' does NOT block '2026-Q1')", () => {
    const yearLock: LockedPeriod = { ...FIXTURE, period: "2026" }
    expect(isPeriodLockedInList([yearLock], "2026-Q1")).toBe(false)
    expect(isPeriodLockedInList([yearLock], "2026-01")).toBe(false)
    expect(isPeriodLockedInList([yearLock], "2026")).toBe(true)
  })

  it("returns false for empty list", () => {
    expect(isPeriodLockedInList([], "2026-Q1")).toBe(false)
  })
})

describe("findLockForPeriod — return lock record", () => {
  it("returns the matching lock record", () => {
    expect(findLockForPeriod([FIXTURE], "2026-Q1")).toEqual(FIXTURE)
  })

  it("returns null when no match", () => {
    expect(findLockForPeriod([FIXTURE], "2026-Q2")).toBeNull()
    expect(findLockForPeriod([], "2026-Q1")).toBeNull()
  })
})

describe("addPeriodLock — idempotent add", () => {
  it("appends new lock to empty list", () => {
    expect(addPeriodLock([], FIXTURE)).toEqual([FIXTURE])
  })

  it("appends new lock when period not yet locked", () => {
    const otherFixture: LockedPeriod = { ...FIXTURE, period: "2026-Q2" }
    const result = addPeriodLock([FIXTURE], otherFixture)
    expect(result).toHaveLength(2)
    expect(result).toEqual([FIXTURE, otherFixture])
  })

  it("is idempotent (returns input unchanged on duplicate period)", () => {
    const dup: LockedPeriod = {
      ...FIXTURE,
      lockedAt: "2027-01-01T00:00:00Z", // different timestamp
      reason: "different reason",
    }
    const result = addPeriodLock([FIXTURE], dup)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(FIXTURE) // ORIGINAL preserved, not overwritten
  })

  it("returns NEW array (does not mutate input)", () => {
    const input: LockedPeriod[] = [FIXTURE]
    const otherFixture: LockedPeriod = { ...FIXTURE, period: "2026-Q2" }
    const result = addPeriodLock(input, otherFixture)
    expect(result).not.toBe(input)
    expect(input).toHaveLength(1) // unchanged
  })
})

describe("removePeriodLock — idempotent remove", () => {
  it("removes the matching lock", () => {
    expect(removePeriodLock([FIXTURE], "2026-Q1")).toEqual([])
  })

  it("is idempotent (no-op when period not in list)", () => {
    expect(removePeriodLock([FIXTURE], "2026-Q2")).toEqual([FIXTURE])
    expect(removePeriodLock([], "2026-Q1")).toEqual([])
  })

  it("preserves non-matching locks", () => {
    const a: LockedPeriod = { ...FIXTURE, period: "2026-Q1" }
    const b: LockedPeriod = { ...FIXTURE, period: "2026-Q2" }
    expect(removePeriodLock([a, b], "2026-Q1")).toEqual([b])
  })

  it("returns NEW array (does not mutate input)", () => {
    const input: LockedPeriod[] = [FIXTURE]
    const result = removePeriodLock(input, "2026-Q1")
    expect(result).not.toBe(input)
    expect(input).toHaveLength(1) // unchanged
  })
})

describe("derivePeriodKey — plan → period key (Turn LXVII follow-up)", () => {
  it("annual periodType → 'YYYY'", () => {
    expect(derivePeriodKey({ periodType: "annual", year: 2026 })).toBe("2026")
  })

  it("quarterly periodType → 'YYYY-QN'", () => {
    expect(derivePeriodKey({ periodType: "quarterly", year: 2026, quarter: 3 })).toBe("2026-Q3")
  })

  it("monthly periodType → 'YYYY-MM' zero-padded", () => {
    expect(derivePeriodKey({ periodType: "monthly", year: 2026, month: 3 })).toBe("2026-03")
    expect(derivePeriodKey({ periodType: "monthly", year: 2026, month: 12 })).toBe("2026-12")
  })

  it("falls back to year when monthly missing month", () => {
    expect(derivePeriodKey({ periodType: "monthly", year: 2026, month: null })).toBe("2026")
    expect(derivePeriodKey({ periodType: "monthly", year: 2026 })).toBe("2026")
  })

  it("falls back to year when quarterly missing quarter", () => {
    expect(derivePeriodKey({ periodType: "quarterly", year: 2026, quarter: null })).toBe("2026")
    expect(derivePeriodKey({ periodType: "quarterly", year: 2026 })).toBe("2026")
  })

  it("falls back to year when periodType is null/unknown", () => {
    expect(derivePeriodKey({ periodType: null, year: 2026 })).toBe("2026")
    expect(derivePeriodKey({ periodType: "weekly", year: 2026 })).toBe("2026")
  })
})

describe("getActivePeriodLock — Prisma integration", () => {
  it("returns lock record when org has it", async () => {
    const findUnique = vi.fn().mockResolvedValue({ lockedPeriods: [FIXTURE] })
    const prismaMock = { organization: { findUnique } } as unknown as Parameters<
      typeof getActivePeriodLock
    >[0]
    const result = await getActivePeriodLock(prismaMock, "org_demo", "2026-Q1")
    expect(result).toEqual(FIXTURE)
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "org_demo" },
      select: { lockedPeriods: true },
    })
  })

  it("returns null when org missing (cross-tenant safe)", async () => {
    const findUnique = vi.fn().mockResolvedValue(null)
    const prismaMock = { organization: { findUnique } } as unknown as Parameters<
      typeof getActivePeriodLock
    >[0]
    const result = await getActivePeriodLock(prismaMock, "org_evil", "2026-Q1")
    expect(result).toBeNull()
  })

  it("returns null when org has empty lockedPeriods", async () => {
    const findUnique = vi.fn().mockResolvedValue({ lockedPeriods: [] })
    const prismaMock = { organization: { findUnique } } as unknown as Parameters<
      typeof getActivePeriodLock
    >[0]
    const result = await getActivePeriodLock(prismaMock, "org_demo", "2026-Q1")
    expect(result).toBeNull()
  })

  it("returns null when org has lock for DIFFERENT period (no granularity expansion)", async () => {
    const yearLock: LockedPeriod = { ...FIXTURE, period: "2026" }
    const findUnique = vi.fn().mockResolvedValue({ lockedPeriods: [yearLock] })
    const prismaMock = { organization: { findUnique } } as unknown as Parameters<
      typeof getActivePeriodLock
    >[0]
    const result = await getActivePeriodLock(prismaMock, "org_demo", "2026-Q1")
    expect(result).toBeNull()
  })
})
