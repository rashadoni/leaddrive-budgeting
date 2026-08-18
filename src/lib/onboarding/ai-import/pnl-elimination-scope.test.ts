/**
 * 2026-08-18 — who gets the group's eliminations, and who gets told they did
 * not.
 *
 * The rule under test is one sentence — group eliminations apply only to the
 * whole group — and every case below is a way of getting it wrong that would
 * not look wrong on screen. A subset silently carrying the group's whole
 * reversal is the dangerous one: the number would be smaller, plausible, and
 * meaningless, because the client's block nets trades with companies the
 * viewer cannot see.
 */
import { describe, it, expect } from "vitest"
import { resolvePnlEliminationScope } from "./pnl-elimination-scope"

describe("P&L elimination scope", () => {
  it("consolidates for an unrestricted org-wide view", () => {
    expect(
      resolvePnlEliminationScope({ filterKind: "all", restricted: false }),
    ).toEqual({ includeEliminations: true, basis: "consolidated_computed" })
  })

  it("withholds them from a restricted view and calls the total a sum", () => {
    // Deliberately conservative: a restriction that happens to cover every
    // company is treated as a subset too, rather than paying a company query
    // on every request to find out. The error direction is calling a real
    // consolidation a sum — never the reverse.
    expect(
      resolvePnlEliminationScope({ filterKind: "all", restricted: true }),
    ).toEqual({ includeEliminations: false, basis: "sum_of_entities" })
  })

  it("never applies them to a single company or sub-group", () => {
    // Not a permission question: one company's own result simply does not
    // contain the group's eliminations, so the restriction flag cannot change
    // the answer either way.
    expect(
      resolvePnlEliminationScope({ filterKind: "single", restricted: false }),
    ).toEqual({ includeEliminations: false, basis: "single_entity" })
    expect(
      resolvePnlEliminationScope({ filterKind: "single", restricted: true }),
    ).toEqual({ includeEliminations: false, basis: "single_entity" })
  })

  it("only ever claims consolidation for the one case that is one", () => {
    // A guard against the next edit quietly widening `consolidated_computed`:
    // exactly one of the four input combinations may carry that label.
    const combos = [
      { filterKind: "all", restricted: false },
      { filterKind: "all", restricted: true },
      { filterKind: "single", restricted: false },
      { filterKind: "single", restricted: true },
    ] as const
    const consolidated = combos
      .map(resolvePnlEliminationScope)
      .filter((r) => r.basis === "consolidated_computed")
    expect(consolidated).toHaveLength(1)
    expect(consolidated[0].includeEliminations).toBe(true)
  })
})
