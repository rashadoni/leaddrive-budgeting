/**
 * 2026-08-19 — reading an import verdict.
 *
 * The client's 33 production imports are all green with `db-readback`
 * evidence. These tests exist for the other cases, which nobody has seen yet
 * precisely because nothing displayed them.
 */
import { describe, it, expect } from "vitest"
import { verdictStanding, verifiedShare } from "./import-verdict"

const row = (over: Partial<Parameters<typeof verdictStanding>[0]> = {}) => ({
  verdict: "green",
  verdictUnverified: false,
  committed: true,
  ...over,
})

describe("what a verdict is worth", () => {
  it("calls a green backed by a post-write query verified", () => {
    // All 33 of the client's imports are this.
    expect(verdictStanding(row())).toBe("verified")
  })

  it("refuses to call a green unverified-by-readback green", () => {
    // A parser comparing its own parse against itself cannot notice a write
    // that never landed. Same word, different claim.
    expect(verdictStanding(row({ verdictUnverified: true }))).toBe("unverified")
  })

  it("separates reported drift from an unbacked verdict", () => {
    expect(verdictStanding(row({ verdict: "yellow" }))).toBe("drift")
    expect(verdictStanding(row({ verdict: "yellow", verdictUnverified: true }))).toBe("unverified")
  })

  it("reports a failure as a failure", () => {
    expect(verdictStanding(row({ verdict: "red" }))).toBe("failed")
  })

  it("puts an uncommitted write above every other reading", () => {
    // The report row exists; the data does not. Whatever the verdict claims
    // about the numbers, they are not in the database — that comes first.
    expect(verdictStanding(row({ committed: false }))).toBe("uncommitted")
    expect(verdictStanding(row({ committed: false, verdict: "green" }))).toBe("uncommitted")
    expect(verdictStanding(row({ committed: false, verdict: "red" }))).toBe("uncommitted")
  })
})

describe("how much of a run could be checked", () => {
  it("states the share of sheets a query could verify", () => {
    expect(verifiedShare({ sheetsVerified: 18, sheetsUnverified: 2 })).toBeCloseTo(0.9, 5)
  })

  it("says nothing rather than zero when there were no sheets", () => {
    // A run with nothing reconcilable is not a run that verified 0%.
    expect(verifiedShare({ sheetsVerified: 0, sheetsUnverified: 0 })).toBeNull()
  })

  it("reports a run that verified nothing as zero, not as absent", () => {
    expect(verifiedShare({ sheetsVerified: 0, sheetsUnverified: 5 })).toBe(0)
  })
})
