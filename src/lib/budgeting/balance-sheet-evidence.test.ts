import { describe, expect, it } from "vitest"
import {
  getBalanceSheetSectionData,
  getLatestBalanceSheetEvidenceMonth,
  normalizeBalanceSheetMonth,
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
    })
  })
})
