/**
 * Phase 11.9 — shared cost-sign resolution for the AI import path.
 *
 * The bug these pin: `sign-infer.ts` was wired only into the staging applier,
 * while the AI Auto Import adapters applied an unconditional `-raw`. The same
 * workbook therefore produced OPPOSITE signs depending on which tab it went
 * through — invisible today only because the current AZSEKER files happen to
 * store costs negative.
 */
import { describe, it, expect } from "vitest"
import { resolveCostSigns } from "./cost-sign"

describe("resolveCostSigns", () => {
  it("flips a negative-convention file (today's AZSEKER shape)", () => {
    const d = resolveCostSigns([-100, -250, -80], [-40, -60])
    expect(d.flipCogs).toBe(true)
    expect(d.flipExpense).toBe(true)
    expect(d.cogsConvention).toBe("negative_costs")
    expect(d.blockedReason).toBeNull()
  })

  it("does NOT flip a debit-convention file (SAP / 1C export)", () => {
    // The corruption case: negating an already-positive cost turns gross
    // profit into revenue PLUS cost.
    const d = resolveCostSigns([100, 250, 80], [40, 60])
    expect(d.flipCogs).toBe(false)
    expect(d.flipExpense).toBe(false)
    expect(d.expenseConvention).toBe("positive_costs")
    expect(d.blockedReason).toBeNull()
  })

  it("classifies the two sections INDEPENDENTLY", () => {
    // A file can legitimately store COGS negative and opex positive.
    const d = resolveCostSigns([-100, -250, -80], [40, 60, 55])
    expect(d.flipCogs).toBe(true)
    expect(d.flipExpense).toBe(false)
  })

  it("BLOCKS when a section's convention is ambiguous", () => {
    const d = resolveCostSigns([100, -100, 90, -95], [-10, -20])
    expect(d.blockedReason).toMatch(/ambiguous/i)
    expect(d.blockedReason).toMatch(/COGS/)
  })

  it("names every ambiguous section in the block reason", () => {
    const d = resolveCostSigns([100, -100, 90, -95], [50, -50, 45, -48])
    expect(d.blockedReason).toMatch(/COGS and expenses/)
  })

  it("keeps the historical default when there is no evidence at all", () => {
    // All-zero section: the choice cannot change a number, so defaulting is
    // safe — and must NOT block, or an empty cost section would stop imports.
    const d = resolveCostSigns([], [0, 0])
    expect(d.flipCogs).toBe(true)
    expect(d.flipExpense).toBe(true)
    expect(d.cogsConvention).toBe("no_evidence")
    expect(d.blockedReason).toBeNull()
  })

  it("tolerates a minority contra row without changing the verdict", () => {
    // A small refund inside an otherwise-negative section is normal and must
    // not tip the file into ambiguous.
    const d = resolveCostSigns([-1000, -900, -1100, 50], [-10])
    expect(d.cogsConvention).toBe("negative_costs")
    expect(d.flipCogs).toBe(true)
    expect(d.blockedReason).toBeNull()
  })

  it("always reports which convention it inferred", () => {
    // A silent correct flip and a silent wrong flip look identical in the
    // output — the note is the only way to tell them apart afterwards.
    const d = resolveCostSigns([-100], [50, 60, 70])
    expect(d.notes.join(" ")).toMatch(/COGS: stored NEGATIVE/)
    expect(d.notes.join(" ")).toMatch(/Expenses: stored POSITIVE/)
  })
})
