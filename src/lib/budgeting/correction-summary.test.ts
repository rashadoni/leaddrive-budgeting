import { describe, it, expect } from "vitest"
import {
  summarizeCorrections,
  correctionNotice,
  NO_CORRECTIONS,
  correctionDisclosureLine,
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

/**
 * Phase 14.5 — the same fact, in a file that leaves the company.
 *
 * The screen has a banner; a banner has a session. A spreadsheet is opened by
 * a bank, an auditor or a board months later, by someone who was never in the
 * conversation where the correction was agreed.
 */
describe("correctionDisclosureLine", () => {
  it("says nothing on a clean plan", () => {
    // A disclosure on every file is furniture by the second week, and then the
    // one that matters reads like furniture too.
    expect(correctionDisclosureLine(NO_CORRECTIONS)).toBeNull()
  })

  it("states the count and the signed net effect", () => {
    const line = correctionDisclosureLine({ count: 3, net: 2200, needsReview: 0 })!
    expect(line).toMatch(/3 MANUAL CORRECTIONS/)
    expect(line).toMatch(/\+2,200\.00 ₼/)
    // The point of the sentence: these figures are not in the client's file.
    expect(line).toMatch(/not present in the source workbook/)
  })

  it("keeps the sign, because a removal reads differently from an addition", () => {
    expect(correctionDisclosureLine({ count: 1, net: -40_000, needsReview: 0 })!).toMatch(
      /-40,000\.00 ₼/,
    )
  })

  it("uses the singular for one correction", () => {
    expect(correctionDisclosureLine({ count: 1, net: 5, needsReview: 0 })!).toMatch(
      /1 MANUAL CORRECTION,/,
    )
  })

  it("adds the double-count warning as its own sentence", () => {
    // "Included" is information; "may be double-counting" is a call to act.
    // One buries the other when they share a sentence.
    const line = correctionDisclosureLine({ count: 3, net: 2200, needsReview: 1 })!
    expect(line).toMatch(/1 of them has had the same cell rewritten/)
    expect(line).toMatch(/double-count/)
    expect(line).toMatch(/not yet reviewed/)
    // Still says the base fact too.
    expect(line).toMatch(/3 MANUAL CORRECTIONS/)
  })

  it("agrees in number when several need review", () => {
    expect(correctionDisclosureLine({ count: 5, net: 0.5, needsReview: 2 })!).toMatch(
      /2 of them have had/,
    )
  })
})
