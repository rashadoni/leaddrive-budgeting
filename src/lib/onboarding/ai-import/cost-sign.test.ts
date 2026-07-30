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
import { resolveCostSigns, isIncomeNaturedLabel } from "./cost-sign"

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

// ── 2026-07-30 — income filed under a cost section ────────────────
//
// A chart of accounts routinely files income where the mapper sees expense:
// AzerSheker's PLF.07 is literally titled "OTHER OPERATING INCOME/EXPENSES"
// and holds Subsidies and Interest Income. Those lines are legitimately
// POSITIVE while real costs are stored negative, so they poison the very
// evidence the classifier reasons over.
//
// Measured on actual-budget-v1.xlsx, entity EDEN: four income leaves worth
// ₼3.25M against ₼6.7M of real costs pushed the negative share to 0.673 —
// under the 0.70 floor — so the classifier refused to guess and the routing
// gate blocked the entire import. The data was never wrong; the population
// was.
describe("isIncomeNaturedLabel", () => {
  it("recognises the real labels that caused the block", () => {
    for (const l of [
      "Subsidies - Farming",
      "Subsidies - Investment",
      "Interest Income from Current Accounts & Deposits",
      "Other Non-Operating Income",
    ]) {
      expect(isIncomeNaturedLabel(l), l).toBe(true)
    }
  })

  it("works across the three languages the product ships", () => {
    expect(isIncomeNaturedLabel("Faiz gəliri")).toBe(true)
    expect(isIncomeNaturedLabel("Прочий доход")).toBe(true)
    expect(isIncomeNaturedLabel("Субсидия на посев")).toBe(true)
  })

  it("does NOT strip income TAX — that is a cost", () => {
    // The trap: the label contains "income" and is an expense.
    expect(isIncomeNaturedLabel("Income Tax Expense")).toBe(false)
    expect(isIncomeNaturedLabel("Mənfəət vergisi")).toBe(false)
    expect(isIncomeNaturedLabel("Налог на доход")).toBe(false)
  })

  it("leaves ordinary cost lines alone", () => {
    for (const l of ["Personnel Costs - G&A", "Depreciation - Machinery", "Parking & Washing"]) {
      expect(isIncomeNaturedLabel(l), l).toBe(false)
    }
  })

  it("treats a missing label as NOT income — absence is not evidence", () => {
    expect(isIncomeNaturedLabel(null)).toBe(false)
    expect(isIncomeNaturedLabel("")).toBe(false)
  })
})

describe("resolveCostSigns — income lines do not vote", () => {
  // EDEN's real shape, rounded: four income leaves against real costs.
  const expenses = [-2_950_681, -1_194_785, -1_500_000, -1_000_000, 3_011_174, 124_686, 107_889, 4_203]
  const labels = [
    "Depreciation - Machinery & Equipment",
    "Personnel Costs - G&A",
    "Rent",
    "Utilities",
    "Subsidies - Farming",
    "Subsidies - Investment",
    "Interest Income from Current Accounts & Deposits",
    "Other Non-Operating Income",
  ]

  it("BLOCKS without labels — the pre-fix behaviour, kept for callers that pass none", () => {
    const d = resolveCostSigns([], expenses)
    expect(d.expenseConvention).toBe("ambiguous")
    expect(d.blockedReason).toMatch(/ambiguous for expenses/)
  })

  it("resolves cleanly once the income lines are named", () => {
    const d = resolveCostSigns([], expenses, { expense: labels })
    expect(d.expenseConvention).toBe("negative_costs")
    expect(d.blockedReason).toBeNull()
    expect(d.flipExpense).toBe(true)
  })

  it("still BLOCKS when the mixture is genuine, not income", () => {
    // Excluding income must not become "never block": real contra rows of
    // comparable size are exactly what the gate exists for.
    const mixed = [-1000, -1000, 900, 950]
    const plain = ["Rent", "Utilities", "Repairs credit", "Freight credit"]
    expect(resolveCostSigns([], mixed, { expense: plain }).expenseConvention).toBe("ambiguous")
  })

  it("does not change a verdict that was already clean", () => {
    const clean = [-1000, -2000, -3000]
    const withLabels = resolveCostSigns([], clean, { expense: ["A", "B", "C"] })
    const without = resolveCostSigns([], clean)
    expect(withLabels.expenseConvention).toBe(without.expenseConvention)
  })
})

