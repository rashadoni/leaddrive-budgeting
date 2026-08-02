import { describe, it, expect } from "vitest"
import {
  MANUAL_CORRECTION_ORIGIN,
  rejectCorrection,
  correctionStamp,
  correctionsNeedingReview,
  deltaToReach,
  type CorrectionInput,
} from "./manual-correction"

const NOW = new Date("2026-08-02T15:00:00Z")

const valid: CorrectionInput = {
  organizationId: "org",
  companyId: "co-eden",
  planId: "plan-2026",
  accountId: "acct-plf-09-01",
  period: "2026-04",
  amount: -40_000,
  lineType: "expense",
  reason: "PLF.09.01 shareholders' expense missing from the 2026 budget sheet",
  actorUserId: "u-rashad",
}

describe("rejectCorrection", () => {
  it("accepts a correction that names an account, a period and a reason", () => {
    expect(rejectCorrection(valid)).toBeNull()
  })

  it("refuses a correction with no stated reason", () => {
    // Not paperwork. Six months on, a correction with no reason is
    // indistinguishable from a mistake, and whoever could have said why has
    // forgotten.
    expect(rejectCorrection({ ...valid, reason: "" })).toBe("empty_reason")
    expect(rejectCorrection({ ...valid, reason: "   " })).toBe("empty_reason")
    expect(rejectCorrection({ ...valid, reason: "ok" })).toBe("empty_reason")
  })

  it("refuses a zero adjustment", () => {
    // It would change nothing and sit in every total and every review queue
    // forever, being nothing.
    expect(rejectCorrection({ ...valid, amount: 0 })).toBe("zero_amount")
    expect(rejectCorrection({ ...valid, amount: NaN })).toBe("zero_amount")
  })

  it("accepts a negative amount — most corrections are removals", () => {
    expect(rejectCorrection({ ...valid, amount: -1 })).toBeNull()
  })

  it("requires a real month, not a year or a quarter", () => {
    // Corrections sit beside monthly rows. A year-scoped one would have no
    // cell to belong to and no cell to be reviewed against.
    for (const period of ["2026", "2026-Q2", "2026-13", "2026-00", "26-04"]) {
      expect(rejectCorrection({ ...valid, period }), period).toBe("bad_period")
    }
  })

  it("refuses an incomplete scope rather than guessing one", () => {
    expect(rejectCorrection({ ...valid, accountId: "" })).toBe("missing_scope")
    expect(rejectCorrection({ ...valid, companyId: "" })).toBe("missing_scope")
  })
})

describe("correctionStamp", () => {
  it("marks the row so no total can contain it anonymously", () => {
    const s = correctionStamp({ reason: "  typo in sheet  ", actorUserId: "u1", now: NOW })
    expect(s.origin).toBe(MANUAL_CORRECTION_ORIGIN)
    expect(s.correctionReason).toBe("typo in sheet")
    expect(s.correctionBy).toBe("u1")
    expect(s.correctionAt).toBe(NOW)
  })

  it("starts with nothing to review", () => {
    // No import has run since; flagging a brand-new correction would put a
    // permanent item in the queue on the day it is created.
    expect(correctionStamp({ reason: "x y z", actorUserId: "u1", now: NOW }).correctionReviewAt)
      .toBeNull()
  })
})

describe("correctionsNeedingReview", () => {
  const corrections = [
    { id: "c1", companyId: "co-eden", accountId: "a1", period: "2026-04" },
    { id: "c2", companyId: "co-eden", accountId: "a2", period: "2026-04" },
    { id: "c3", companyId: "co-cpc", accountId: "a1", period: "2026-04" },
  ]

  it("flags only the corrections whose exact cell was rewritten", () => {
    const flagged = correctionsNeedingReview(corrections, [
      { companyId: "co-eden", accountId: "a1", period: "2026-04" },
    ])
    expect(flagged).toEqual(["c1"])
  })

  it("does not flag the same account in another company or another month", () => {
    expect(
      correctionsNeedingReview(corrections, [
        { companyId: "co-eden", accountId: "a1", period: "2026-05" },
      ]),
    ).toEqual([])
  })

  it("flags regardless of amount — the cell was rewritten, that is the fact", () => {
    // Deliberately not amount-aware. "The new figure equals the old one" is
    // not the same as "the correction is still needed", and deciding that
    // needs someone who knows what the correction was for.
    expect(
      correctionsNeedingReview([corrections[0]], [
        { companyId: "co-eden", accountId: "a1", period: "2026-04" },
      ]),
    ).toEqual(["c1"])
  })

  it("says nothing when an import wrote nothing, or there are no corrections", () => {
    expect(correctionsNeedingReview(corrections, [])).toEqual([])
    expect(correctionsNeedingReview([], [{ companyId: "x", accountId: "y", period: "2026-01" }]))
      .toEqual([])
  })
})

describe("deltaToReach — 14.3, editing expressed as an adjustment", () => {
  it("finds the adjustment that moves a figure to its target", () => {
    expect(deltaToReach(77_800, 80_000)).toEqual({
      delta: 2_200,
      from: 77_800,
      to: 80_000,
    })
  })

  it("goes down as readily as up, and works from zero", () => {
    expect(deltaToReach(100, 40)).toMatchObject({ delta: -60 })
    expect(deltaToReach(0, 1_500)).toMatchObject({ delta: 1_500 })
  })

  it("refuses a change smaller than half a qəpik", () => {
    // Same threshold as everywhere else here, and the same reasoning as the
    // zero guard: a correction that changes nothing would still sit in every
    // total and every review queue, being nothing.
    expect(deltaToReach(80_000, 80_000)).toEqual({ rejection: "already_equals" })
    expect(deltaToReach(80_000, 80_000.004)).toEqual({ rejection: "already_equals" })
    // Half a qəpik and above is a real change.
    expect(deltaToReach(80_000, 80_000.005)).toMatchObject({ to: 80_000.005 })
  })

  it("refuses a target that is not a number", () => {
    expect(deltaToReach(1, NaN)).toEqual({ rejection: "not_finite" })
    expect(deltaToReach(Infinity, 1)).toEqual({ rejection: "not_finite" })
  })
})
