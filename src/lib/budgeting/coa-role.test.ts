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
  otherOperatingContribution,
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
    expect(pnlSectionFromCode("PLF.09.03.09", "expense")).toBe("belowEbitda")
    expect(pnlSectionFromCode("PLF.12.01.01", "expense")).toBe("opex")
  })

  it("puts the WHOLE of PLF.07 in other-operating, not revenue and not below EBITDA", () => {
    // Both halves used to be wrong in opposite directions: `.01/.02` income
    // was routed into REVENUE (which is how 13.45M of subsidies inflated the
    // top line to 72,333,200 against the workbook's 58,880,102) and `.03/.04`
    // was pushed BELOW EBITDA. The sheet's own PLF.08 row says all four
    // branches sit above it.
    expect(pnlSectionFromCode("PLF.07.01.01", "revenue")).toBe("otherOperating")
    expect(pnlSectionFromCode("PLF.07.02.02", "revenue")).toBe("otherOperating")
    expect(pnlSectionFromCode("PLF.07.02.04", "revenue")).toBe("otherOperating")
    expect(pnlSectionFromCode("PLF.07.03.01", "expense")).toBe("otherOperating")
    expect(pnlSectionFromCode("PLF.07.04.01", "expense")).toBe("otherOperating")
  })

  it("gives PLF.08.01 the below-EBITDA line it never reached", () => {
    // 174,491 AZN of AZSF 2025 "Shareholders' expense". The importer wrote it
    // deliberately and argued the case in two files; this mapper returned null
    // for everything under PLF.08, so it landed in the database and then in no
    // P&L line at all.
    expect(pnlSectionFromCode("PLF.08.01", "expense")).toBe("belowEbitda")
    expect(pnlSectionFromCode("PLF.08.02", "expense")).toBe("belowEbitda")
  })

  it("skips Workbook computed total rows", () => {
    expect(pnlSectionFromCode("PLF.03", "expense")).toBeNull()
    // PLF.08 EXACTLY is the EBITDA subtotal — unlike its children above.
    expect(pnlSectionFromCode("PLF.08", "expense")).toBeNull()
    expect(pnlSectionFromCode("PLF.07", "expense")).toBeNull()
    expect(pnlSectionFromCode("PLF.10", "expense")).toBeNull()
  })

  it("falls back to accountType for unknown customer codes", () => {
    expect(pnlSectionFromCode("CUSTOM-REV", "revenue")).toBe("revenue")
    expect(pnlSectionFromCode("CUSTOM-COGS", "cogs")).toBe("cogs")
    expect(pnlSectionFromCode("CUSTOM-EXP", "expense")).toBe("opex")
    expect(pnlSectionFromCode("CUSTOM-ASSET", "asset")).toBeNull()
  })
})

describe("revenueContribution — the compensator is gone", () => {
  it("leaves a revenue row's sign alone", () => {
    expect(revenueContribution("PLF.01.01.01", 15_836_740)).toBe(15_836_740)
  })

  it("still flips contra-revenue (returns / discounts)", () => {
    expect(revenueContribution("602-01", 5_000)).toBe(-5_000)
    expect(revenueContribution("603-01", 1_200)).toBe(-1_200)
  })

  it("no longer takes a stored-sign argument at all", () => {
    // The `storedAs` parameter existed for exactly one caller shape:
    // PLF.07 income stored NEGATIVE under the expense convention while
    // `pnlSectionFromCode` claimed it was revenue. Both halves are gone, and a
    // compensator with nothing to compensate silently negates whatever trips
    // it next. Signature arity is the guard.
    expect(revenueContribution.length).toBe(2)
  })
})

describe("otherOperatingContribution — income positive, expense negative", () => {
  it("adds income rows, which are now stored POSITIVE", () => {
    expect(otherOperatingContribution("PLF.07.02.04", 9_231_957)).toBe(9_231_957)
    expect(otherOperatingContribution("PLF.07.01.01", 300_000)).toBe(300_000)
  })

  it("subtracts expense rows, which are stored cost-positive", () => {
    expect(otherOperatingContribution("PLF.07.03.01", 376_818.97)).toBe(-376_818.97)
    expect(otherOperatingContribution("PLF.07.04.01", 1_000)).toBe(-1_000)
  })

  it("nets the four 2026-budget branches to the sheet's own 13,076,279", () => {
    const net =
      otherOperatingContribution("PLF.07.01.01", 300_000) +
      otherOperatingContribution("PLF.07.02.02", 3_565_190) +
      otherOperatingContribution("PLF.07.02.03", 355_951.1024166) +
      otherOperatingContribution("PLF.07.02.04", 9_231_957) +
      otherOperatingContribution("PLF.07.03.01", 376_818.97)
    expect(net).toBeCloseTo(13_076_279.13, 2)
  })
})
