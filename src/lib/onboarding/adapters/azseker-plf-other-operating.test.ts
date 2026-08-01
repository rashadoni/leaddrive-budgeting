// @vitest-environment node
/**
 * 2026-08-01 — the 13,453,098 AZN that Excel showed and every check passed.
 *
 * `PLF.07` is titled "OTHER OPERATING INCOME/EXPENSES" and holds both. Typing
 * it from the section number (`/^0[3-9]$/ -> expense`) sent its income through
 * the cost-sign pass, which negated it: subsidies and interest income reached
 * `budget_lines` NEGATIVE, and two later layers flipped the sign back while
 * calling it Revenue.
 *
 * Every code and label below is verbatim from `PLF Budget 2026` /
 * `PLF Actual 2025`, and every amount is the workbook's own annual figure, so
 * a fixture that drifts from the file is a failing test rather than a quiet
 * disagreement.
 */
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parsePlfPlSheet } from "./azseker-plf"

/** 2026 month serials, Jan..Dec, exactly as `PLF Budget 2026` row 1 has them. */
const M2026 = [
  46023, 46054, 46082, 46113, 46143, 46174, 46204, 46235, 46266, 46296, 46327,
  46357,
]

/** Spread an annual figure over twelve equal months. */
const spread = (annual: number) => Array(12).fill(annual / 12)

/**
 * The `PLF Budget 2026` EDEN block, trimmed to the rows that carry money.
 * Costs negative, income positive — the file's own convention.
 */
function edenBlock(extra: unknown[][] = []): XLSX.WorkBook {
  const aoa: unknown[][] = [
    ["", "", "", ...M2026],
    ["PLF.01", "REVENUE", "", ...spread(31_986_950)],
    ["PLF.01.01", "Revenue from Farming Activities", "", ...spread(31_736_950)],
    ["PLF.01.01.01", "Revenue from Sale of Wheat", "", ...spread(15_836_740)],
    ["PLF.02", "COST OF GOODS SOLD", "", ...spread(-20_000_000)],
    ["PLF.02.01", "Cost of Farming", "", ...spread(-20_000_000)],
    ["PLF.02.01.01", "Cost of Wheat", "", ...spread(-20_000_000)],
    ["PLF.03", "GROSS MARGIN", "", ...spread(11_986_950)],
    ["PLF.05", "SUPPORTING FUNCTIONS COST - HEAD OFFICE", "", ...spread(-1_000_000)],
    ["PLF.05.01", "Personnel Costs - G&A", "", ...spread(-1_000_000)],
    ["PLF.05.01.01", "Staff Salaries, Gross", "", ...spread(-1_000_000)],
    // ── PLF.07, rows 350-366 ────────────────────────────────────────────
    ["PLF.07", "OTHER OPERATING INCOME/EXPENSES", "", ...spread(13_453_098.10241)],
    ["PLF.07.01", "Interest Income (non-operating)", "", ...spread(300_000)],
    ["PLF.07.01.01", "Interest Income from Current Accounts & Deposits", "", ...spread(300_000)],
    ["PLF.07.02", "Non-Operating Income", "", ...spread(13_153_098.10241)],
    ["PLF.07.02.02", "Subsidies - Farming", "", ...spread(3_565_190)],
    ["PLF.07.02.03", "Subsidies - Investment", "", ...spread(355_951.1024166)],
    ["PLF.07.02.04", "Subsidies - Product", "", ...spread(9_231_957)],
    ["PLF.07.03", "Non-Operating Expenses", "", ...spread(-376_818.97)],
    ["PLF.07.03.01", "Production downtime", "", ...spread(-376_818.97)],
    ["PLF.08", "EBITDA", "", ...spread(24_063_229.13)],
    ["PLF.09.03", "Depreciation & Amortization", "", ...spread(-9_060_558.81418)],
    ["PLF.09.03.98", "Depreciation - Other Tangible Assets", "", ...spread(-9_060_558.81418)],
    ["PLF.10", "NET PROFIT / (LOSS)", "", ...spread(15_002_670.31)],
    ...extra,
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  return { SheetNames: ["PLF Budget 2026"], Sheets: { "PLF Budget 2026": ws } } as XLSX.WorkBook
}

const parse = (wb: XLSX.WorkBook) =>
  parsePlfPlSheet(wb, "PLF Budget 2026", XLSX, { preferYear: 2026 })

const annual = (lines: { code: string; totalAnnual: number }[], code: string) =>
  lines.find((l) => l.code === code)!.totalAnnual

describe("PLF.07 — income is stored with the sign its nature implies", () => {
  const { lines } = parse(edenBlock())

  it("stores Subsidies - Product POSITIVE, not as −9,231,957 of cost", () => {
    // The number the owner found in Excel. On the P&L page this row printed
    // −9,231,957 while the Revenue total it fed was +9,231,957 higher.
    expect(annual(lines, "PLF.07.02.04")).toBeCloseTo(9_231_957, 6)
  })

  it("types the whole income branch as revenue-conventioned, so nothing flips it", () => {
    for (const code of [
      "PLF.07.01.01",
      "PLF.07.02.02",
      "PLF.07.02.03",
      "PLF.07.02.04",
    ]) {
      expect(lines.find((l) => l.code === code)!.accountType).toBe("revenue")
    }
  })

  it("still stores the expense branch as positive cost", () => {
    const row = lines.find((l) => l.code === "PLF.07.03.01")!
    expect(row.accountType).toBe("expense")
    expect(row.totalAnnual).toBeCloseTo(376_818.97, 6)
  })

  it("leaves real sales and real costs exactly as they were", () => {
    expect(annual(lines, "PLF.01.01.01")).toBeCloseTo(15_836_740, 6)
    expect(annual(lines, "PLF.02.01.01")).toBeCloseTo(20_000_000, 6)
    expect(annual(lines, "PLF.05.01.01")).toBeCloseTo(1_000_000, 6)
  })

  it("does not read the file as debit-convention now that income left the evidence", () => {
    const { signConvention } = parse(edenBlock())
    expect(signConvention?.expenseConvention).toBe("negative_costs")
    expect(signConvention?.blockedReason).toBeNull()
  })

  it("never imports the sheet's own subtotal rows", () => {
    const codes = lines.map((l) => l.code)
    for (const subtotal of ["PLF.03", "PLF.07", "PLF.08", "PLF.10"]) {
      expect(codes).not.toContain(subtotal)
    }
  })
})

describe("PLF.07 — a branch the chart map does not know is audible", () => {
  it("warns rather than guessing silently, and still keeps the money", () => {
    const { lines, warnings } = parse(
      edenBlock([
        ["PLF.07.05", "Something The Client Added", "", ...spread(-50_000)],
      ]),
    )
    const row = lines.find((l) => l.code === "PLF.07.05")!
    expect(row.totalAnnual).toBeCloseTo(50_000, 6)
    expect(warnings.some((w) => w.reason.includes("PLF.07.05"))).toBe(true)
  })
})

describe("PLF.08.01 — the account beneath the EBITDA line", () => {
  it("imports as a cost, while PLF.08 itself stays a subtotal", () => {
    // 2025 chart: PLF.08 EBITDA is followed by three real accounts. The 2026
    // chart renumbered the first to PLF.09.01.
    const aoa: unknown[][] = [
      ["", "", "", ...M2026],
      ["PLF.01.01.06", "Revenue from Sale of Processed Corn Products", "", ...spread(16_428_572.72)],
      ["PLF.08", "EBITDA", "", ...spread(1_706_901.52)],
      ["PLF.08.01", "Shareholders' expense", "", ...spread(-174_491)],
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = {
      SheetNames: ["PLF Budget 2026"],
      Sheets: { "PLF Budget 2026": ws },
    } as XLSX.WorkBook
    const { lines } = parse(wb)
    const codes = lines.map((l) => l.code)
    expect(codes).toContain("PLF.08.01")
    expect(codes).not.toContain("PLF.08")
    const row = lines.find((l) => l.code === "PLF.08.01")!
    expect(row.accountType).toBe("expense")
    expect(row.totalAnnual).toBeCloseTo(174_491, 6)
  })
})
