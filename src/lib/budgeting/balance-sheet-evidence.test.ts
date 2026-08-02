import { describe, expect, it } from "vitest"
import {
  balanceSheetDebtToEquity,
  getBalanceSheetSectionData,
  getLatestBalanceSheetEvidenceMonth,
  normalizeBalanceSheetMonth,
  resolveBalanceSheetScope,
  type BalanceSheetEvidenceLine,
} from "./balance-sheet-evidence"

function line(
  id: string,
  month: number,
  amount: number,
  lineType = "asset",
): BalanceSheetEvidenceLine {
  return {
    id,
    month,
    amount,
    lineType,
    account: { code: id, name: id },
  }
}

describe("Balance Sheet evidence semantics", () => {
  it("counts an explicit zero as evidence and preserves its zero total", () => {
    const section = getBalanceSheetSectionData([line("cash", 12, 0)])

    expect(section.sectionCounts[12]).toBe(1)
    expect(section.sectionTotals[12]).toBe(0)
    expect(getLatestBalanceSheetEvidenceMonth(section)).toBe(12)
  })

  it("does not turn a completely absent month into evidenced zero", () => {
    const section = getBalanceSheetSectionData([line("cash", 5, 10)])

    expect(section.sectionCounts[6]).toBe(0)
    expect(section.sectionTotals[6]).toBe(0)
    expect(getLatestBalanceSheetEvidenceMonth(section)).toBe(5)
  })

  it("normalizes a trial-balance month only when all three sections exist", () => {
    const assets = getBalanceSheetSectionData([line("assets", 5, 100)])
    const liabilities = getBalanceSheetSectionData([
      line("liabilities", 5, -40, "liability"),
    ])
    const equity = getBalanceSheetSectionData([line("equity", 5, -60, "equity")])

    expect(normalizeBalanceSheetMonth(assets, liabilities, equity, 5)).toEqual({
      assets: 100,
      liabilities: 40,
      equity: 60,
      convention: "trial_balance",
      eliminationsApplied: true,
    })
  })

  it("fails closed for liabilities, equity and D/E inputs when a section is absent", () => {
    const assets = getBalanceSheetSectionData([line("assets", 5, 100)])
    const liabilities = getBalanceSheetSectionData([
      line("liabilities", 5, -40, "liability"),
    ])
    const equity = getBalanceSheetSectionData([])

    expect(normalizeBalanceSheetMonth(assets, liabilities, equity, 5)).toEqual({
      assets: 100,
      liabilities: null,
      equity: null,
      convention: null,
      eliminationsApplied: true,
    })
  })

  it("normalizes a credible natural-sign month", () => {
    const assets = getBalanceSheetSectionData([line("assets", 5, 100)])
    const liabilities = getBalanceSheetSectionData([
      line("liabilities", 5, 40, "liability"),
    ])
    const equity = getBalanceSheetSectionData([line("equity", 5, 60, "equity")])

    expect(normalizeBalanceSheetMonth(assets, liabilities, equity, 5)).toEqual({
      assets: 100,
      liabilities: 40,
      equity: 60,
      convention: "natural",
      eliminationsApplied: true,
    })
  })

  it("rejects the lesser residual when it is still materially unbalanced", () => {
    const assets = getBalanceSheetSectionData([line("assets", 5, 100)])
    const liabilities = getBalanceSheetSectionData([
      line("liabilities", 5, -40, "liability"),
    ])
    const equity = getBalanceSheetSectionData([line("equity", 5, 60, "equity")])

    expect(normalizeBalanceSheetMonth(assets, liabilities, equity, 5)).toEqual({
      assets: 100,
      liabilities: null,
      equity: null,
      convention: null,
      eliminationsApplied: true,
    })
  })
})

/**
 * Defect 3 — the balance sheet tab silently summed four legal entities.
 *
 * The figures below are the client's own, read out of `BS Actual 2026` of
 * `actual-budget-v1.xlsx` at 2026-05 (the latest populated month, which is
 * what the page shows):
 *
 *   AZSF     134,234,695.76
 *   EDEN     177,351,644.55
 *   CPC       25,184,079.11
 *   ProMalt   36,381,644.76
 *   ------------------------
 *   Σ        373,152,064.18   ← what the page printed as "Total assets"
 *   consolidated 249,951,210.07
 *   double-counted 123,200,854.11
 */
describe("Balance Sheet basis (Defect 3 — un-eliminated cross-entity sums)", () => {
  const bsLine = (companyId: string | null) => ({ companyId })

  it("flags a multi-entity sum as un-eliminated instead of passing it off as consolidated", () => {
    const scope = resolveBalanceSheetScope(
      [bsLine("azsf"), bsLine("eden"), bsLine("cpc"), bsLine("promalt"), bsLine("eden")],
      { holdingConsolidated: false },
    )

    expect(scope.basis).toBe("sum_of_entities")
    expect(scope.entityCount).toBe(4)
    expect(scope.eliminationsApplied).toBe(false)
    expect(scope.companyIds).toEqual(["azsf", "cpc", "eden", "promalt"])
  })

  it("a single entity has nothing to eliminate", () => {
    const scope = resolveBalanceSheetScope([bsLine("eden"), bsLine("eden")], {
      holdingConsolidated: false,
    })

    expect(scope.basis).toBe("single_entity")
    expect(scope.entityCount).toBe(1)
    expect(scope.eliminationsApplied).toBe(true)
  })

  it("the holding's own consolidated rows are eliminated at source", () => {
    const scope = resolveBalanceSheetScope([bsLine("holding")], {
      holdingConsolidated: true,
    })

    expect(scope.basis).toBe("consolidated_holding")
    expect(scope.eliminationsApplied).toBe(true)
  })

  it("counts legacy unscoped rows as a contributor of their own", () => {
    // Pre-Phase-7.O rows carry companyId null. Mixed with per-entity rows they
    // are precisely the case where the sum is unsafe, so they must not be
    // silently folded into whichever entity happens to be present.
    const scope = resolveBalanceSheetScope([bsLine("eden"), bsLine(null)], {
      holdingConsolidated: false,
    })

    expect(scope.basis).toBe("sum_of_entities")
    expect(scope.entityCount).toBe(2)
    expect(scope.companyIds).toEqual(["eden"])
  })

  it("no rows at all is not a multi-entity sum", () => {
    const scope = resolveBalanceSheetScope([], { holdingConsolidated: false })

    expect(scope.basis).toBe("single_entity")
    expect(scope.entityCount).toBe(0)
    expect(scope.eliminationsApplied).toBe(true)
  })

  it("the A=L+E residual gate cannot see the double-count — four balanced sheets sum to a balanced sheet", () => {
    // This is the whole reason the defect survived every automated check.
    // Two entities, each internally balanced, each holding the other side of a
    // 30 intercompany investment. The sum balances perfectly and the totals are
    // still overstated by that 30.
    const assets = getBalanceSheetSectionData([
      line("parent-assets", 5, 100),
      line("sub-assets", 5, 30),
    ])
    const liabilities = getBalanceSheetSectionData([
      line("parent-liab", 5, -40, "liability"),
      line("sub-liab", 5, -10, "liability"),
    ])
    const equity = getBalanceSheetSectionData([
      line("parent-equity", 5, -60, "equity"),
      line("sub-equity", 5, -20, "equity"),
    ])
    const scope = resolveBalanceSheetScope(
      [{ companyId: "parent" }, { companyId: "sub" }],
      { holdingConsolidated: false },
    )

    const totals = normalizeBalanceSheetMonth(assets, liabilities, equity, 5, scope)

    // Balanced — the gate is satisfied and reports a clean convention...
    expect(totals.convention).toBe("trial_balance")
    expect(totals.assets).toBe(130)
    // ...and yet the basis says the number must not be read as the group's.
    expect(totals.eliminationsApplied).toBe(false)
  })

  it("keeps the honest sum but withholds the D/E verdict built on it", () => {
    const assets = getBalanceSheetSectionData([line("assets", 5, 100)])
    const liabilities = getBalanceSheetSectionData([
      line("liabilities", 5, -40, "liability"),
    ])
    const equity = getBalanceSheetSectionData([line("equity", 5, -60, "equity")])

    const eliminated = normalizeBalanceSheetMonth(assets, liabilities, equity, 5)
    const summed = normalizeBalanceSheetMonth(assets, liabilities, equity, 5, {
      eliminationsApplied: false,
    })

    // The totals are identical — the sum is not falsified, only qualified.
    expect(summed.assets).toBe(eliminated.assets)
    expect(summed.liabilities).toBe(eliminated.liabilities)

    expect(balanceSheetDebtToEquity(eliminated)).toBeCloseTo(40 / 60, 10)
    expect(balanceSheetDebtToEquity(summed)).toBeNull()
  })

  it("D/E stays null on the pre-existing unusable-input cases", () => {
    expect(balanceSheetDebtToEquity({ liabilities: 40, equity: null })).toBeNull()
    expect(balanceSheetDebtToEquity({ liabilities: null, equity: 60 })).toBeNull()
    expect(balanceSheetDebtToEquity({ liabilities: 40, equity: 0 })).toBeNull()
    expect(balanceSheetDebtToEquity({ liabilities: 40, equity: -60 })).toBeNull()
  })
})

/**
 * Phase 14.8 — the sum stops being a sum once the client's own eliminations
 * are in the data.
 *
 * `BS Actual 2026` ships a fifth `EJE` block that the product used to drop.
 * It nets 123,200,854.11 of intercompany holdings and receivables out of the
 * 373,152,064.18 above, landing on the client's 249,951,210.07 — so once those
 * rows exist, describing the total as an un-eliminated sum is as wrong as
 * describing the un-eliminated sum as consolidated was.
 */
describe("Balance Sheet basis with eliminations present (14.8)", () => {
  const entity = (companyId: string) => ({ companyId })
  /** Eliminations are null-company BY CONSTRUCTION — that is what the flag is for. */
  const elim = () => ({ companyId: null, isElimination: true })

  it("calls entities + eliminations a consolidated statement", () => {
    const scope = resolveBalanceSheetScope(
      [entity("azsf"), entity("eden"), entity("cpc"), entity("promalt"), elim(), elim()],
      { holdingConsolidated: false },
    )

    expect(scope.basis).toBe("consolidated_computed")
    expect(scope.eliminationsApplied).toBe(true)
    // Four contributors, not six: the elimination rows are not an entity.
    expect(scope.entityCount).toBe(4)
    expect(scope.companyIds).toEqual(["azsf", "cpc", "eden", "promalt"])
  })

  it("does not count elimination rows as an unscoped contributor", () => {
    // The load-bearing case. `resolveBalanceSheetScope` treats a null
    // companyId as its own contributor, so without the flag these rows would
    // push the answer DEEPER into "sum_of_entities" at the exact moment the
    // sum became a real consolidation.
    const withFlag = resolveBalanceSheetScope([entity("eden"), entity("cpc"), elim()], {
      holdingConsolidated: false,
    })
    const withoutFlag = resolveBalanceSheetScope(
      [entity("eden"), entity("cpc"), { companyId: null }],
      { holdingConsolidated: false },
    )

    expect(withFlag.entityCount).toBe(2)
    expect(withFlag.basis).toBe("consolidated_computed")
    expect(withoutFlag.entityCount).toBe(3)
    expect(withoutFlag.basis).toBe("sum_of_entities")
  })

  it("still refuses when a legacy unscoped row is mixed in", () => {
    // The client's elimination block was computed against ITS four entities.
    // An unknown extra contributor is not covered by it, and over-warning is
    // the safe direction here as everywhere else in this function.
    const scope = resolveBalanceSheetScope(
      [entity("eden"), entity("cpc"), { companyId: null }, elim()],
      { holdingConsolidated: false },
    )

    expect(scope.basis).toBe("sum_of_entities")
    expect(scope.eliminationsApplied).toBe(false)
  })

  it("refuses eliminations with nothing to eliminate between", () => {
    // Reachable: the entity sheets fail to import and the EJE sheet does not.
    // Calling that `single_entity` would publish the elimination block's own
    // −119M as somebody's balance sheet, confidently — the exact failure shape
    // 14.7 removed from the AI panel.
    const onlyElims = resolveBalanceSheetScope([elim(), elim()], {
      holdingConsolidated: false,
    })
    expect(onlyElims.basis).toBe("sum_of_entities")
    expect(onlyElims.eliminationsApplied).toBe(false)

    const oneEntity = resolveBalanceSheetScope([entity("eden"), elim()], {
      holdingConsolidated: false,
    })
    expect(oneEntity.eliminationsApplied).toBe(false)
  })

  it("lets the D/E ratio through once eliminations are applied", () => {
    // The ratio is refused on an un-eliminated sum because intragroup payables
    // inflate the numerator and parent investments inflate the denominator.
    // Both are gone here, so the ratio is a ratio again.
    const scope = resolveBalanceSheetScope([entity("a"), entity("b"), elim()], {
      holdingConsolidated: false,
    })
    expect(
      balanceSheetDebtToEquity({
        liabilities: 40,
        equity: 100,
        eliminationsApplied: scope.eliminationsApplied,
      }),
    ).toBeCloseTo(0.4, 5)
  })
})
