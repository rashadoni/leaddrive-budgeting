// @vitest-environment node
/**
 * The single statement about the PLF chart, tested against the codes and
 * labels that actually appear in `actual-budget-v1.xlsx`.
 */
import { describe, it, expect } from "vitest"
import {
  plfNature,
  plfOtherOperatingSide,
  plfOtherOperatingContribution,
} from "./plf-chart"

describe("plfNature — section 07 is classified by branch, never by section", () => {
  it("calls the income branches income, whatever the section is titled", () => {
    // `FS line_FO` on every one of these leaves reads "Other income/(expense)".
    // The section they live in is titled "OTHER OPERATING INCOME/EXPENSES",
    // which is exactly why the section number cannot decide.
    expect(plfNature("PLF.07.01.01")).toBe("other_operating_income") // Interest Income
    expect(plfNature("PLF.07.01.99")).toBe("other_operating_income")
    expect(plfNature("PLF.07.02.02")).toBe("other_operating_income") // Subsidies - Farming
    expect(plfNature("PLF.07.02.03")).toBe("other_operating_income") // Subsidies - Investment
    expect(plfNature("PLF.07.02.04")).toBe("other_operating_income") // Subsidies - Product
  })

  it("calls the expense branches expense", () => {
    expect(plfNature("PLF.07.03.01")).toBe("other_operating_expense") // Production downtime
    expect(plfNature("PLF.07.03.99")).toBe("other_operating_expense")
    expect(plfNature("PLF.07.04.01")).toBe("other_operating_expense") // Gain/Loss on Disposal
  })

  it("says 'unmapped' for a branch it does not know, instead of guessing", () => {
    expect(plfOtherOperatingSide("PLF.07.05.01")).toBe("unmapped")
    // It still keeps the money flowing, under the historical treatment.
    expect(plfNature("PLF.07.05.01")).toBe("other_operating_expense")
  })

  it("returns null for codes outside PLF.07", () => {
    expect(plfOtherOperatingSide("PLF.01.01.01")).toBeNull()
    expect(plfOtherOperatingSide("PLF.07")).toBeNull() // the section row itself
    expect(plfOtherOperatingSide("601-01")).toBeNull()
  })
})

describe("plfNature — subtotal rows are a positive statement, not 'unknown'", () => {
  it("names the four rows the sheet computes for itself", () => {
    for (const code of ["PLF.03", "PLF.07", "PLF.08", "PLF.10"]) {
      expect(plfNature(code)).toBe("subtotal")
    }
  })

  it("does not extend that to their children — PLF.08.01 is a real account", () => {
    // 174,491 AZN, AZSF 2025 "Shareholders' expense". The 2026 chart moved it
    // to PLF.09.01; both must land below the EBITDA line.
    expect(plfNature("PLF.08.01")).toBe("below_ebitda")
    expect(plfNature("PLF.08.02")).toBe("below_ebitda") // Expenses of prior periods
    expect(plfNature("PLF.09.01")).toBe("below_ebitda")
    // An older AZSEKER chart numbered Sales & Marketing PLF.03.*.
    expect(plfNature("PLF.03.01.01")).toBe("opex")
  })
})

describe("plfNature — the uniform sections keep their historical nature", () => {
  it("maps revenue, COGS, the two cost blocks, provisions and tax", () => {
    expect(plfNature("PLF.01.01.01")).toBe("revenue")
    expect(plfNature("PLF.02.01.06")).toBe("cogs")
    expect(plfNature("PLF.04.04.01")).toBe("opex")
    expect(plfNature("PLF.05.15")).toBe("opex")
    expect(plfNature("PLF.09.03.98")).toBe("below_ebitda")
    expect(plfNature("PLF.12.01.01")).toBe("opex")
  })

  it("has no opinion on non-PLF codes or on PLF.11", () => {
    expect(plfNature("601-01")).toBeNull()
    expect(plfNature("CUSTOM")).toBeNull()
    expect(plfNature(null)).toBeNull()
    expect(plfNature(42)).toBeNull()
    // Biological-assets fair value: 2025 actuals only, zero in every
    // non-eliminating BU, and never imported. Left to the 2025-chart work
    // rather than silently given a home here.
    expect(plfNature("PLF.11.01.01")).toBeNull()
  })

  it("is case- and whitespace-insensitive, like every other code reader here", () => {
    expect(plfNature("  plf.07.02.04 ")).toBe("other_operating_income")
    expect(plfNature("plf.08")).toBe("subtotal")
  })
})

describe("plfOtherOperatingContribution", () => {
  it("is a no-op for anything outside the bucket", () => {
    expect(plfOtherOperatingContribution("PLF.01.01.01", 100)).toBe(100)
  })

  it("subtracts only the expense branches", () => {
    expect(plfOtherOperatingContribution("PLF.07.02.04", 100)).toBe(100)
    expect(plfOtherOperatingContribution("PLF.07.03.01", 100)).toBe(-100)
  })
})
