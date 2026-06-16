import { describe, it, expect } from "vitest"
import { assertNoCollateralDeletion, CollateralDeletionError } from "./collateral-guard"

describe("assertNoCollateralDeletion", () => {
  it("passes when archived equals the footprint (normal clean-slate)", () => {
    expect(() =>
      assertNoCollateralDeletion({
        table: "BudgetLine",
        archivedCount: 12,
        footprintLiveCount: 12,
        footprint: "plans=[p1] companies=[c1]",
      }),
    ).not.toThrow()
  })

  it("passes when archived is LESS than the footprint (category dropped / under-archive)", () => {
    expect(() =>
      assertNoCollateralDeletion({
        table: "BudgetLine",
        archivedCount: 8,
        footprintLiveCount: 12,
        footprint: "plans=[p1]",
      }),
    ).not.toThrow()
  })

  it("passes on a zero-row no-op import", () => {
    expect(() =>
      assertNoCollateralDeletion({
        table: "BudgetLine",
        archivedCount: 0,
        footprintLiveCount: 0,
        footprint: "plans=[]",
      }),
    ).not.toThrow()
  })

  it("THROWS when archived exceeds the footprint (sibling wipe — the bug class)", () => {
    expect(() =>
      assertNoCollateralDeletion({
        table: "BudgetLine",
        archivedCount: 2700, // wiped the budget plan too
        footprintLiveCount: 732, // only the actuals plan was being written
        footprint: "plans=[actual] companies=[azsf]",
      }),
    ).toThrow(CollateralDeletionError)
  })

  it("error message names the table and both counts", () => {
    try {
      assertNoCollateralDeletion({
        table: "CashFlowEntry",
        archivedCount: 309,
        footprintLiveCount: 37,
        footprint: "source=azseker-cf entities=[MALT]",
      })
      throw new Error("expected guard to throw")
    } catch (e) {
      expect(e).toBeInstanceOf(CollateralDeletionError)
      expect((e as Error).message).toContain("CashFlowEntry")
      expect((e as Error).message).toContain("309")
      expect((e as Error).message).toContain("37")
      expect((e as Error).message).toContain("sibling data loss")
    }
  })
})
