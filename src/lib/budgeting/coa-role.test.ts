// @vitest-environment node
/**
 * Phase 7.G Turn LXXV — guard tests for ChartOfAccount role classifier.
 * Locks: prefix → role mapping (8 buckets), contra-revenue identification,
 * P&L section aggregation, defensive null/empty handling.
 */

import { describe, it, expect } from "vitest"
import {
  deriveRoleFromCode,
  isContraRevenueCode,
  pnlSectionFromCode,
  revenueContribution,
  pnlSectionFromRole,
} from "./coa-role"

describe("deriveRoleFromCode — 8 role buckets", () => {
  it("revenue: 601, 611 → revenue", () => {
    expect(deriveRoleFromCode("601")).toBe("revenue")
    expect(deriveRoleFromCode("601-01")).toBe("revenue")
    expect(deriveRoleFromCode("601-01-02")).toBe("revenue")
    expect(deriveRoleFromCode("611")).toBe("revenue")
    expect(deriveRoleFromCode("611-05")).toBe("revenue")
  })

  it("contra-revenue: 602, 603 → revenue (sign-flip handled by consumer)", () => {
    expect(deriveRoleFromCode("602")).toBe("revenue")
    expect(deriveRoleFromCode("602-01")).toBe("revenue")
    expect(deriveRoleFromCode("603")).toBe("revenue")
  })

  it("cogs: 701 → cogs", () => {
    expect(deriveRoleFromCode("701")).toBe("cogs")
    expect(deriveRoleFromCode("701-02-03")).toBe("cogs")
  })

  it("opex: 711, 721 → opex", () => {
    expect(deriveRoleFromCode("711")).toBe("opex")
    expect(deriveRoleFromCode("711-02")).toBe("opex")
    expect(deriveRoleFromCode("721")).toBe("opex")
    expect(deriveRoleFromCode("721-09-01")).toBe("opex")
  })

  it("finance: 731 → finance", () => {
    expect(deriveRoleFromCode("731")).toBe("finance")
    expect(deriveRoleFromCode("731-01")).toBe("finance")
  })

  it("tax_costs: 741 → tax_costs", () => {
    expect(deriveRoleFromCode("741")).toBe("tax_costs")
  })

  it("non_operating: 751, 761, 771 → non_operating", () => {
    expect(deriveRoleFromCode("751")).toBe("non_operating")
    expect(deriveRoleFromCode("761")).toBe("non_operating")
    expect(deriveRoleFromCode("771")).toBe("non_operating")
  })

  it("tax: 801 → tax", () => {
    expect(deriveRoleFromCode("801")).toBe("tax")
  })

  it("unknown: balance-sheet codes (1xx-5xx) + unrecognized → unknown", () => {
    expect(deriveRoleFromCode("100")).toBe("unknown") // asset
    expect(deriveRoleFromCode("200")).toBe("unknown") // liability
    expect(deriveRoleFromCode("500")).toBe("unknown") // equity
    expect(deriveRoleFromCode("999")).toBe("unknown")
  })

  it("defensive: returns 'unknown' for null/empty/non-string input", () => {
    expect(deriveRoleFromCode("")).toBe("unknown")
    expect(deriveRoleFromCode("   ")).toBe("unknown")
    expect(deriveRoleFromCode(null as unknown as string)).toBe("unknown")
    expect(deriveRoleFromCode(undefined as unknown as string)).toBe("unknown")
    expect(deriveRoleFromCode(42 as unknown as string)).toBe("unknown")
  })

  it("trims whitespace before matching", () => {
    expect(deriveRoleFromCode("  601-01  ")).toBe("revenue")
    expect(deriveRoleFromCode("\t701\n")).toBe("cogs")
  })
})

describe("isContraRevenueCode — sign-flip predicate", () => {
  it("true for 602, 603 (with or without sub-segments)", () => {
    expect(isContraRevenueCode("602")).toBe(true)
    expect(isContraRevenueCode("602-01")).toBe(true)
    expect(isContraRevenueCode("603")).toBe(true)
    expect(isContraRevenueCode("603-05-02")).toBe(true)
  })

  it("false for top-line revenue (601, 611)", () => {
    expect(isContraRevenueCode("601")).toBe(false)
    expect(isContraRevenueCode("611")).toBe(false)
  })

  it("false for non-revenue codes", () => {
    expect(isContraRevenueCode("701")).toBe(false)
    expect(isContraRevenueCode("711")).toBe(false)
    expect(isContraRevenueCode("100")).toBe(false)
  })

  it("defensive: null/empty/non-string returns false", () => {
    expect(isContraRevenueCode("")).toBe(false)
    expect(isContraRevenueCode(null as unknown as string)).toBe(false)
  })
})

describe("pnlSectionFromRole — role → P&L section", () => {
  it("revenue → revenue", () => {
    expect(pnlSectionFromRole("revenue")).toBe("revenue")
  })

  it("cogs → cogs", () => {
    expect(pnlSectionFromRole("cogs")).toBe("cogs")
  })

  it("opex → opex", () => {
    expect(pnlSectionFromRole("opex")).toBe("opex")
  })

  it("finance/tax_costs/non_operating/tax → belowEbitda", () => {
    expect(pnlSectionFromRole("finance")).toBe("belowEbitda")
    expect(pnlSectionFromRole("tax_costs")).toBe("belowEbitda")
    expect(pnlSectionFromRole("non_operating")).toBe("belowEbitda")
    expect(pnlSectionFromRole("tax")).toBe("belowEbitda")
  })

  it("unknown → null (out of P&L scope)", () => {
    expect(pnlSectionFromRole("unknown")).toBeNull()
  })
})

describe("pnlSectionFromCode — SAP + Workbook imported codes", () => {
  it("keeps SAP code sections unchanged", () => {
    expect(pnlSectionFromCode("601-01", "expense")).toBe("revenue")
    expect(pnlSectionFromCode("701-01", "expense")).toBe("cogs")
    expect(pnlSectionFromCode("721-02", "expense")).toBe("opex")
    expect(pnlSectionFromCode("741-01", "expense")).toBe("belowEbitda")
  })

  it("maps Workbook PLF revenue, COGS, OpEx and below-EBITDA codes", () => {
    expect(pnlSectionFromCode("PLF.01.02.01", "expense")).toBe("revenue")
    expect(pnlSectionFromCode("PLF.02.02.01", "expense")).toBe("cogs")
    expect(pnlSectionFromCode("PLF.04.02.02", "expense")).toBe("opex")
    expect(pnlSectionFromCode("PLF.05.01.01", "expense")).toBe("opex")
    expect(pnlSectionFromCode("PLF.07.02.02", "expense")).toBe("revenue")
    expect(pnlSectionFromCode("PLF.07.03.01", "expense")).toBe("belowEbitda")
    expect(pnlSectionFromCode("PLF.09.03.09", "expense")).toBe("belowEbitda")
    expect(pnlSectionFromCode("PLF.12.01.01", "expense")).toBe("opex")
  })

  it("skips Workbook computed total rows", () => {
    expect(pnlSectionFromCode("PLF.03", "expense")).toBeNull()
    expect(pnlSectionFromCode("PLF.08.01", "expense")).toBeNull()
    expect(pnlSectionFromCode("PLF.10", "expense")).toBeNull()
  })

  it("falls back to accountType for unknown customer codes", () => {
    expect(pnlSectionFromCode("CUSTOM-REV", "revenue")).toBe("revenue")
    expect(pnlSectionFromCode("CUSTOM-COGS", "cogs")).toBe("cogs")
    expect(pnlSectionFromCode("CUSTOM-EXP", "expense")).toBe("opex")
    expect(pnlSectionFromCode("CUSTOM-ASSET", "asset")).toBeNull()
  })
})

describe("revenueContribution — the two sign conventions", () => {
  // `storedAs` is BudgetLine.lineType (the importer's sign convention), NOT
  // ChartOfAccount.accountType. The FO subsidies are accountType=revenue but
  // lineType=expense, so their income sits NEGATIVE; reading them as-is
  // SUBTRACTED 13.45M and drove the 2026 budget's Net Profit to −10.6M
  // against the workbook's own +3.83M.
  it("negates income stored under the cost convention (lineType=expense)", () => {
    expect(revenueContribution("PLF.07.02.02", "expense", -3_570_000)).toBe(3_570_000)
    expect(revenueContribution("PLF.07.01.01", "expense", -300_000)).toBe(300_000)
  })

  it("leaves a revenue-typed row's sign alone", () => {
    expect(revenueContribution("PLF.01.01.01", "revenue", 15_836_740)).toBe(15_836_740)
  })

  it("still flips contra-revenue (returns / discounts)", () => {
    expect(revenueContribution("602-01", "revenue", 5_000)).toBe(-5_000)
    expect(revenueContribution("603-01", "revenue", 1_200)).toBe(-1_200)
  })

  it("an expense-typed row carrying a real cost turns negative — it is not revenue", () => {
    // Guard against blindly negating: only rows the classifier puts in the
    // revenue section reach this helper, and a positive cost there would be a
    // genuine income reversal.
    expect(revenueContribution("PLF.07.02.02", "expense", 100_000)).toBe(-100_000)
  })

  it("treats a null accountType as the cost convention (import default)", () => {
    expect(revenueContribution("PLF.07.02.04", null, -9_230_000)).toBe(9_230_000)
  })
})
