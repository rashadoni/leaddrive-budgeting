import { describe, it, expect } from "vitest"
import {
  summarizeCorrections,
  correctionNotice,
  NO_CORRECTIONS,
} from "./correction-summary"

const imported = (plannedAmount: number) => ({ plannedAmount })
const correction = (plannedAmount: number, reviewAt?: Date | null) => ({
  origin: "manual_correction",
  plannedAmount,
  correctionReviewAt: reviewAt ?? null,
})

describe("summarizeCorrections", () => {
  it("counts only the hand-entered rows, and nets them", () => {
    const s = summarizeCorrections([
      imported(1000),
      correction(-40_000),
      imported(2000),
      correction(2_500),
    ])
    expect(s.count).toBe(2)
    // NET, not absolute — unlike the elimination weight in 11.73. An
    // elimination cancels by design and its net says nothing; a correction is
    // meant to move the total, and by exactly this much.
    expect(s.net).toBe(-37_500)
  })

  it("reports zero rather than nothing when a total is clean", () => {
    // The zero shape, not null: a caller must not be able to render "contains
    // corrections" off a truthy object, and "no corrections" is a fact worth
    // being able to state.
    expect(summarizeCorrections([imported(1), imported(2)])).toEqual(NO_CORRECTIONS)
    expect(summarizeCorrections([])).toEqual(NO_CORRECTIONS)
  })

  it("counts the ones a later import put in doubt", () => {
    const s = summarizeCorrections([
      correction(-1000),
      correction(-2000, new Date("2026-08-02")),
    ])
    expect(s.count).toBe(2)
    expect(s.needsReview).toBe(1)
  })

  it("ignores a row whose origin is something else entirely", () => {
    // Absence means "came from a workbook". A future origin value must not be
    // silently counted as a correction.
    expect(summarizeCorrections([{ origin: "some_future_thing", plannedAmount: 5 }]).count)
      .toBe(0)
  })

  it("does not let a non-finite amount poison the net", () => {
    const s = summarizeCorrections([correction(NaN), correction(100)])
    expect(s.count).toBe(2)
    expect(s.net).toBe(100)
  })
})

describe("correctionNotice", () => {
  it("says nothing on a clean total", () => {
    // A banner on every clean P&L is a banner nobody reads by the second week.
    expect(correctionNotice(NO_CORRECTIONS)).toBeNull()
  })

  it("states the fact when nothing needs review", () => {
    const n = correctionNotice({ count: 2, net: -100, needsReview: 0 })
    expect(n?.key).toBe("corrections.includes")
    expect(n?.params).toEqual({ count: 2 })
  })

  it("switches to the call-to-act sentence when one is in doubt", () => {
    // Two sentences, not one with a conditional clause. "This total includes a
    // correction" is information; "one may now be double-counting" is a call
    // to act, and collapsing them would bury the second.
    const n = correctionNotice({ count: 3, net: 0, needsReview: 1 })
    expect(n?.key).toBe("corrections.includesAndNeedsReview")
    expect(n?.params).toEqual({ count: 3, needsReview: 1 })
  })
})
