/**
 * Phase 7.M Step 4 — tests for the soft-delete helper module.
 */
import { describe, it, expect } from "vitest"
import {
  EXCLUDE_DELETED,
  archiveStamp,
  restoreStamp,
  SOFT_DELETE_RETENTION_DAYS,
  softDeletePurgeCutoff,
} from "./soft-delete"

describe("EXCLUDE_DELETED", () => {
  it("is the canonical { deletedAt: null } shape", () => {
    expect(EXCLUDE_DELETED).toEqual({ deletedAt: null })
  })

  it("composes via spread without overwriting other where keys", () => {
    const where = {
      organizationId: "org_1",
      companyId: "c1",
      ...EXCLUDE_DELETED,
    }
    expect(where).toEqual({
      organizationId: "org_1",
      companyId: "c1",
      deletedAt: null,
    })
  })

  it("is frozen — accidental mutation throws in strict mode", () => {
    expect(Object.isFrozen(EXCLUDE_DELETED)).toBe(true)
  })
})

describe("archiveStamp", () => {
  it("returns deletedAt=now and deletedBy=userId", () => {
    const before = Date.now()
    const stamp = archiveStamp("user_42")
    const after = Date.now()
    expect(stamp.deletedBy).toBe("user_42")
    expect(stamp.deletedAt).toBeInstanceOf(Date)
    expect(stamp.deletedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(stamp.deletedAt.getTime()).toBeLessThanOrEqual(after)
  })

  it("accepts the literal 'system' for cron/CLI initiators", () => {
    const stamp = archiveStamp("system")
    expect(stamp.deletedBy).toBe("system")
  })
})

describe("restoreStamp", () => {
  it("clears both fields to null", () => {
    expect(restoreStamp()).toEqual({ deletedAt: null, deletedBy: null })
  })
})

describe("softDeletePurgeCutoff", () => {
  it("returns a Date 90 days before now (default arg)", () => {
    const now = new Date("2026-05-18T12:00:00Z")
    const cutoff = softDeletePurgeCutoff(now)
    const diffDays = (now.getTime() - cutoff.getTime()) / 86_400_000
    expect(diffDays).toBe(SOFT_DELETE_RETENTION_DAYS)
  })

  it("retention constant is 90 days (matches budget_plans schema convention)", () => {
    expect(SOFT_DELETE_RETENTION_DAYS).toBe(90)
  })
})
