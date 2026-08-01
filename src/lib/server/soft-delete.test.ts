/**
 * Phase 7.M Step 4 — tests for the soft-delete helper module.
 */
import { describe, it, expect } from "vitest"
import {
  EXCLUDE_DELETED,
  archiveStamp,
  restoreStamp,
  SOFT_DELETE_TTL_MS,
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

describe("retention window", () => {
  // 2026-07-31 — there used to be TWO. A dead `SOFT_DELETE_RETENTION_DAYS =
  // 90` here (called by nothing but this test) and the live 30-day
  // `SOFT_DELETE_TTL_MS` in the cleanup job. The UI quoted the dead one at
  // the user: "Restore is available within 90 days", three times longer than
  // the system actually keeps anything.
  it("is a single constant, re-exported from the job that enforces it", () => {
    expect(SOFT_DELETE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })
})
