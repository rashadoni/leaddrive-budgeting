// @vitest-environment node
/**
 * Phase 7.G Turn LXV — guard tests for shared import-keyword catalog.
 *
 * Locks the 3 SAP-code regex shapes + AZ section-header content matchers.
 * Catches accidental regex drift (the kind that would silently misclassify
 * Excel rows + corrupt imported budgets — high-leverage gate).
 */

import { describe, it, expect } from "vitest"
import {
  SAP_CODE_PREFIX,
  SAP_CODE_FULL,
  COST_ACCOUNT_PREFIX,
  looksLikeCode,
  looksLikeSapCode,
  looksLikeCostAccount,
  HEADER_COST_CENTER_LOWER,
  HEADER_NON_RAW_MATERIAL_PREFIX_LOWER,
  HEADER_RAW_MATERIAL_PREFIX_LOWER,
  HEADER_TOTAL_LOWER,
  COLUMN_AMOUNT_LOWER,
  COLUMN_QUANTITY_LOWER,
  COLUMN_PRICE_LOWER,
  isIndirectCostHeader,
  isRawMaterialHeader,
} from "./keywords"

describe("SAP_CODE_PREFIX (loose 3-digit prefix)", () => {
  it("matches 3-digit prefix", () => {
    expect(SAP_CODE_PREFIX.test("601")).toBe(true)
    expect(SAP_CODE_PREFIX.test("703-A1")).toBe(true)
    expect(SAP_CODE_PREFIX.test("711-something")).toBe(true)
  })

  it("does NOT match non-digit prefix", () => {
    expect(SAP_CODE_PREFIX.test("Salary")).toBe(false)
    expect(SAP_CODE_PREFIX.test("ABC-123")).toBe(false)
    expect(SAP_CODE_PREFIX.test("")).toBe(false)
  })

  it("does NOT match 1-2 digit prefix", () => {
    expect(SAP_CODE_PREFIX.test("12")).toBe(false)
    expect(SAP_CODE_PREFIX.test("1-2-3")).toBe(false)
  })

  it("looksLikeCode wrapper matches regex", () => {
    expect(looksLikeCode("601")).toBe(true)
    expect(looksLikeCode("Salary")).toBe(false)
  })
})

describe("SAP_CODE_FULL (full shape with optional dash-segments)", () => {
  it("matches full SAP-code shapes", () => {
    expect(SAP_CODE_FULL.test("601")).toBe(true)
    expect(SAP_CODE_FULL.test("703-1")).toBe(true)
    expect(SAP_CODE_FULL.test("703-1-2")).toBe(true)
    expect(SAP_CODE_FULL.test("711-001-A")).toBe(false) // letter in segment
  })

  it("rejects partial / extended forms", () => {
    expect(SAP_CODE_FULL.test("601-Salary")).toBe(false) // text suffix
    expect(SAP_CODE_FULL.test("703 ")).toBe(false) // trailing space
    expect(SAP_CODE_FULL.test("12")).toBe(false) // 2-digit
  })

  it("looksLikeSapCode wrapper matches regex", () => {
    expect(looksLikeSapCode("703-1")).toBe(true)
    expect(looksLikeSapCode("Salary")).toBe(false)
  })
})

describe("COST_ACCOUNT_PREFIX (7xx- specifically)", () => {
  it("matches 7xx- cost accounts", () => {
    expect(COST_ACCOUNT_PREFIX.test("703-A1")).toBe(true)
    expect(COST_ACCOUNT_PREFIX.test("711-")).toBe(true)
    expect(COST_ACCOUNT_PREFIX.test("799-anything")).toBe(true)
  })

  it("does NOT match 6xx (revenue) or 8xx (other)", () => {
    expect(COST_ACCOUNT_PREFIX.test("601-Sales")).toBe(false)
    expect(COST_ACCOUNT_PREFIX.test("801-Other")).toBe(false)
  })

  it("does NOT match 7xx WITHOUT dash (incomplete cost-account format)", () => {
    expect(COST_ACCOUNT_PREFIX.test("703")).toBe(false)
    expect(COST_ACCOUNT_PREFIX.test("711abc")).toBe(false)
  })

  it("looksLikeCostAccount wrapper", () => {
    expect(looksLikeCostAccount("703-1")).toBe(true)
    expect(looksLikeCostAccount("601-2")).toBe(false)
  })
})

describe("AZ section-header content matchers (lowercased)", () => {
  it("HEADER_COST_CENTER_LOWER is exact lowercased AZ", () => {
    expect(HEADER_COST_CENTER_LOWER).toBe("xərc mərkəzi")
  })

  it("HEADER_NON_RAW_MATERIAL_PREFIX_LOWER is qeyri-xammal", () => {
    expect(HEADER_NON_RAW_MATERIAL_PREFIX_LOWER).toBe("qeyri-xammal")
  })

  it("HEADER_RAW_MATERIAL_PREFIX_LOWER is xammal xərcləri", () => {
    expect(HEADER_RAW_MATERIAL_PREFIX_LOWER).toBe("xammal xərcləri")
  })

  it("HEADER_TOTAL_LOWER + column matchers correct", () => {
    expect(HEADER_TOTAL_LOWER).toBe("cəmi")
    expect(COLUMN_AMOUNT_LOWER).toBe("məbləğ")
    expect(COLUMN_QUANTITY_LOWER).toBe("miqdar")
    expect(COLUMN_PRICE_LOWER).toBe("qiymət")
  })
})

describe("isIndirectCostHeader / isRawMaterialHeader predicates", () => {
  it("isIndirectCostHeader matches 'qeyri-xammal xərclər' substring", () => {
    expect(isIndirectCostHeader("qeyri-xammal xərclər (703)")).toBe(true)
    expect(isIndirectCostHeader("xərc mərkəzi: qeyri-xammal xərclər")).toBe(
      true,
    )
  })

  it("isIndirectCostHeader matches 'istehsal xərci' alternative", () => {
    expect(isIndirectCostHeader("istehsal xərci")).toBe(true)
    expect(isIndirectCostHeader("ümumi istehsal xərci yığını")).toBe(true)
  })

  it("isIndirectCostHeader rejects unrelated text", () => {
    expect(isIndirectCostHeader("salary")).toBe(false)
    expect(isIndirectCostHeader("xammal xərcləri")).toBe(false) // raw material, not indirect
    expect(isIndirectCostHeader("")).toBe(false)
  })

  it("isRawMaterialHeader matches 'xammal xərcləri' substring", () => {
    expect(isRawMaterialHeader("xammal xərcləri:")).toBe(true)
    expect(isRawMaterialHeader("section: xammal xərcləri")).toBe(true)
  })

  it("isRawMaterialHeader rejects qeyri-xammal (NOT raw material despite token overlap)", () => {
    // "qeyri-xammal xərclər" contains "xammal xərclər" via tokenization,
    // but per AZ semantics this is INDIRECT cost, not raw material.
    // Predicate must use the FULL phrase "xammal xərcləri" (with the
    // possessive `i` suffix) to disambiguate.
    expect(isRawMaterialHeader("qeyri-xammal xərclər")).toBe(false)
  })
})
