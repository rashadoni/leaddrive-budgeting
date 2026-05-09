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
