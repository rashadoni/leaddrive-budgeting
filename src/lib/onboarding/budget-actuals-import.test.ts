/**
 * Phase 7.M Tier 7 (Phase 3) — budget-actuals parser tests.
 * Pure module tests — no Prisma, no LLM.
 */
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parseBudgetActualsWorkbook } from "./budget-actuals-import"

function buildWorkbook(aoa: Array<Array<unknown>>): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  return wb
}

describe("parseBudgetActualsWorkbook", () => {
  it("parses canonical header set into validated rows", () => {
    const wb = buildWorkbook([
      ["category", "amount", "date", "department", "description", "lineType"],
      ["Office Rent", 5000, "2026-03-15", "Admin", "March rent", "expense"],
      ["Software Sales", 12000, "2026-03-20", "Sales", "Q1 software", "revenue"],
    ])
    const result = parseBudgetActualsWorkbook(wb, XLSX)
    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toMatchObject({
      category: "Office Rent",
      amount: 5000,
      date: "2026-03-15",
      monthIndex: 2, // March = 0-indexed 2
      department: "Admin",
      description: "March rent",
      lineType: "expense",
      companyCode: null,
    })
    expect(result.rows[1]).toMatchObject({
      category: "Software Sales",
      amount: 12000,
      lineType: "revenue",
      monthIndex: 2,
    })
  })

  it("accepts header aliases (Account/Sum/Period/Memo/Type)", () => {
    const wb = buildWorkbook([
      ["Account", "Sum", "Period", "Dept", "Memo", "Type"],
      ["Marketing", 1500, "2026-01-10", "Marketing", "Ads", "expense"],
    ])
    const result = parseBudgetActualsWorkbook(wb, XLSX)
    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      category: "Marketing",
      amount: 1500,
      department: "Marketing",
      description: "Ads",
      monthIndex: 0,
    })
  })

  it("takes absolute value of amount (CSV-route convention)", () => {
    const wb = buildWorkbook([
      ["category", "amount", "date"],
      ["Returns", -2500, "2026-04-01"],
    ])
    const result = parseBudgetActualsWorkbook(wb, XLSX)
    expect(result.rows[0].amount).toBe(2500)
  })

  it("rejects rows with missing category", () => {
    const wb = buildWorkbook([
      ["category", "amount", "date"],
      ["", 100, "2026-01-01"],
      ["Valid", 200, "2026-01-02"],
    ])
    const result = parseBudgetActualsWorkbook(wb, XLSX)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({
      rowNumber: 2,
      reason: "Missing category",
    })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].category).toBe("Valid")
  })

  it("rejects an unparseable amount but KEEPS an explicit zero", () => {
    // Phase 11.15 — a 0 in the sheet is data. It used to be rejected
    // alongside unparseable cells, so a genuine zero both vanished from the
    // import and appeared in the error list as a parse failure.
    const wb = buildWorkbook([
      ["category", "amount", "date"],
      ["Cat1", 0, "2026-01-01"],
      ["Cat2", "abc", "2026-01-02"],
      ["Cat3", 100, "2026-01-03"],
    ])
    const result = parseBudgetActualsWorkbook(wb, XLSX)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].reason).toMatch(/Invalid amount/)
    expect(result.rows).toHaveLength(2)
    expect(result.rows.find((r) => r.category === "Cat1")?.amount).toBe(0)
  })

  describe("Phase 11.15 — credit notes and the file's sign convention", () => {
    it("keeps a reversal NEGATIVE in a charge-positive file", () => {
      // Math.abs() used to run on every amount, turning a -500 correction
      // into a +500 charge — it inflated the actual instead of reducing it.
      const wb = buildWorkbook([
        ["category", "amount", "date"],
        ["Cat1", 1000, "2026-01-01"],
        ["Cat2", 800, "2026-01-02"],
        ["Cat3", -500, "2026-01-03"],
      ])
      const result = parseBudgetActualsWorkbook(wb, XLSX)
      expect(result.signConvention?.expenseConvention).toBe("positive_costs")
      expect(result.rows.map((r) => r.amount)).toEqual([1000, 800, -500])
    })

    it("normalizes a charge-negative file, and its reversal stays a credit", () => {
      // A sheet storing expenses negative must land charge-positive in the
      // DB. Simply dropping Math.abs() would have flipped every actual
      // negative — the same convention trap Phase 11.9 closed for the P&L.
      const wb = buildWorkbook([
        ["category", "amount", "date"],
        ["Cat1", -1000, "2026-01-01"],
        ["Cat2", -800, "2026-01-02"],
        ["Cat3", 500, "2026-01-03"],
      ])
      const result = parseBudgetActualsWorkbook(wb, XLSX)
      expect(result.signConvention?.expenseConvention).toBe("negative_costs")
      expect(result.rows.map((r) => r.amount)).toEqual([1000, 800, -500])
    })
  })

  it("rejects rows with malformed date", () => {
    const wb = buildWorkbook([
      ["category", "amount", "date"],
      ["Cat1", 100, "not-a-date"],
      ["Cat2", 200, "2026-02-15"],
    ])
    const result = parseBudgetActualsWorkbook(wb, XLSX)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].reason).toMatch(/Malformed date/)
    expect(result.rows).toHaveLength(1)
  })

  it("parses DD.MM.YYYY date format (Excel EU locale)", () => {
    const wb = buildWorkbook([
      ["category", "amount", "date"],
      ["Cat1", 100, "15.03.2026"],
    ])
    const result = parseBudgetActualsWorkbook(wb, XLSX)
    expect(result.errors).toEqual([])
    expect(result.rows[0].date).toBe("2026-03-15")
    expect(result.rows[0].monthIndex).toBe(2)
  })

  it("captures companyCode when column present", () => {
    const wb = buildWorkbook([
      ["category", "amount", "date", "companyCode"],
      ["Cat1", 100, "2026-01-01", "AZSEKER-CPC"],
      ["Cat2", 200, "2026-01-02", ""],
    ])
    const result = parseBudgetActualsWorkbook(wb, XLSX)
    expect(result.errors).toEqual([])
    expect(result.rows[0].companyCode).toBe("AZSEKER-CPC")
    expect(result.rows[1].companyCode).toBeNull()
  })

  it("returns missing-required-header error with header list", () => {
    const wb = buildWorkbook([
      ["category", "department"], // missing amount + date
      ["Cat1", "Admin"],
    ])
    const result = parseBudgetActualsWorkbook(wb, XLSX)
    expect(result.errors.length).toBeGreaterThanOrEqual(2)
    expect(result.errors.some((e) => e.reason.includes("amount"))).toBe(true)
    expect(result.errors.some((e) => e.reason.includes("date"))).toBe(true)
    expect(result.rows).toEqual([])
  })

  it("warns + defaults unknown lineType to expense", () => {
    const wb = buildWorkbook([
      ["category", "amount", "date", "lineType"],
      ["Cat1", 100, "2026-01-01", "marketing"],
    ])
    const result = parseBudgetActualsWorkbook(wb, XLSX)
    expect(result.errors).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].message).toMatch(/unknown lineType.*marketing/)
    expect(result.rows[0].lineType).toBe("expense")
  })

  it("truncates description > 500 chars and emits warning", () => {
    const longDesc = "x".repeat(600)
    const wb = buildWorkbook([
      ["category", "amount", "date", "description"],
      ["Cat1", 100, "2026-01-01", longDesc],
    ])
    const result = parseBudgetActualsWorkbook(wb, XLSX)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].message).toMatch(/truncated to 500/)
    expect(result.rows[0].description?.length).toBe(500)
  })

  it("returns error for workbook with no sheets", () => {
    const wb: XLSX.WorkBook = { Sheets: {}, SheetNames: [] }
    const result = parseBudgetActualsWorkbook(wb, XLSX)
    expect(result.errors[0].reason).toMatch(/no sheets/)
    expect(result.rows).toEqual([])
  })

  it("returns error for workbook with only header row", () => {
    const wb = buildWorkbook([["category", "amount", "date"]])
    const result = parseBudgetActualsWorkbook(wb, XLSX)
    expect(result.errors[0].reason).toMatch(/at least one data row/)
    expect(result.rows).toEqual([])
  })
})
