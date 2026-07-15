/**
 * 2026-07-15 — guards for the product-sales parsers.
 *
 * Fixtures mirror the REAL client shapes (redacted, tiny):
 *   • farming budget grid   — row sections (Ton / AZN / Qiymət) × month cols
 *   • processing banner grid — banner column-groups (VOLUMES / GROSS / DISCOUNTS)
 *   • transactional actuals  — one row per sale, AZ product names
 * Load-bearing behaviours: NET revenue basis, cross-language product pairing,
 * per-year filtering, and never inventing a price the money contradicts.
 */
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import {
  detectProductSalesShape,
  parseProductSalesSheet,
  resolveUnitPrice,
} from "./product-sales-parser"

const EDEN = "AZSEKER-EDEN"
const CPC = "AZSEKER-CPC"

function wb(name: string, aoa: unknown[][]): XLSX.WorkBook {
  const b = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(b, XLSX.utils.aoa_to_sheet(aoa), name)
  return b
}
const M = (y: number) => Array.from({ length: 3 }, (_, i) => new Date(y, i, 1))

// ── Fixture A: farming budget grid (Jan..Mar) ────────────────────────────
const FARMING: unknown[][] = [
  ["ƏKİNÇİLİK MƏHSULLARIN SATIŞ PLANI"],
  ["Məhsul", ...M(2026), "2026"],
  ["Satış plan, Ton"],
  ["Sales volume of Wheat", 100, 200, 0, 300],
  ["Sales volume of Barley", 50, 0, 25, 75],
  ["Satış plan, AZN"],
  ["Revenue from Sale of Wheat", 37000, 74000, 0, 111000],
  ["Revenue from Sale of Barley", 28000, 0, 14000, 42000],
  ["Satış plan, Qiymət"],
  ["Price of Wheat", 370, 370, 0, 370],
  ["Price of Barley", 560, 0, 560, 560],
  ["Satış plan, COGS"],
  ["Wheat Costs", -20000, -40000, 0, -60000],
]

// ── Fixture B: processing banner grid (Jan..Feb per section) ─────────────
const CPC_BANNER: unknown[][] = [
  [],
  [
    null, null, null, null,
    "SALES VOLUMES, TON", null, null,
    "GROSS REVENUE, ₼", null, null,
    "DISCOUNTS, ₼", null, null,
  ],
  [
    "For PLF", "Group", "Location", "For PL",
    ...M(2026).slice(0, 2), "Total",
    ...M(2026).slice(0, 2), "Total",
    ...M(2026).slice(0, 2), "Total",
  ],
  [
    "Ana məhsul", "Qlukoza", "Azerbaijan", "Glucose",
    100, 200, 300,
    100_000, 200_000, 300_000,
    -10_000, 0, -10_000,
  ],
  [
    "Ana məhsul", "Nişasta", "Export", "Corn starch (Export)",
    50, 0, 50,
    60_000, 0, 60_000,
    0, 0, 0,
  ],
]

// ── Fixture C: transactional actuals, AZ product names, 2 years ──────────
const TX: unknown[][] = [
  [],
  [],
  ["Dövr", "Seqment", "Müştəri adı", "Məhsul qrupu", "Məhsul", "Net Miqdar Ton", "Net Satış AZN"],
  [new Date(2026, 0, 1), "Azerbaijan", "A MMC", "Qlükoza", "Qlükoza-G40", 10, 11_000],
  [new Date(2026, 0, 1), "Azerbaijan", "B MMC", "Qlükoza", "Qlükoza-G40", 5, 5_500],
  [new Date(2026, 1, 1), "Azerbaijan", "A MMC", "Nişasta", "Nişasta Adi", 20, 20_000],
  [new Date(2025, 5, 1), "Azerbaijan", "A MMC", "Qlükoza", "Qlükoza-G40", 99, 99_000],
]

describe("detectProductSalesShape", () => {
  it("recognises each real shape", () => {
    expect(detectProductSalesShape(wb("F", FARMING), "F", XLSX)).toBe("budget_grid")
    expect(detectProductSalesShape(wb("C", CPC_BANNER), "C", XLSX)).toBe("budget_banner")
    expect(detectProductSalesShape(wb("T", TX), "T", XLSX)).toBe("transactions")
  })
  it("returns null for an unrelated sheet (no false routing)", () => {
    const other = wb("X", [["Code", "Name", "Jan"], ["PLF.01", "Revenue", 100]])
    expect(detectProductSalesShape(other, "X", XLSX)).toBeNull()
  })
})

describe("budget grid (farming)", () => {
  const res = parseProductSalesSheet(wb("F", FARMING), "F", XLSX, {
    entityCode: EDEN,
    year: 2026,
  })

  it("pairs qty + revenue + price per product-month, skipping the COGS section", () => {
    const wheatJan = res.rows.find(
      (r) => r.identity.slug === "WHEAT" && r.month === 1,
    )!
    expect(wheatJan.quantity).toBe(100)
    expect(wheatJan.amount).toBe(37_000)
    expect(wheatJan.explicitUnitPrice).toBe(370)
    // Wheat Costs must NOT become a product row of its own
    expect(res.rows.some((r) => /COST/i.test(r.identity.slug))).toBe(false)
  })

  it("ignores the annual total column (only 12 month columns count)", () => {
    const wheat = res.rows.filter((r) => r.identity.slug === "WHEAT")
    expect(wheat.map((r) => r.month).sort()).toEqual([1, 2])
    expect(wheat.reduce((s, r) => s + r.amount, 0)).toBe(111_000)
  })

  it("emits entity-namespaced codes", () => {
    expect(res.rows[0].identity.code.startsWith("AZSEKER_EDEN__")).toBe(true)
  })
})

describe("budget banner grid (processing) — NET revenue basis", () => {
  const res = parseProductSalesSheet(wb("C", CPC_BANNER), "C", XLSX, {
    entityCode: CPC,
    year: 2026,
  })

  it("subtracts discounts from gross (client decision: show NET)", () => {
    const jan = res.rows.find((r) => r.identity.slug === "GLUCOSE" && r.month === 1)!
    expect(jan.quantity).toBe(100)
    expect(jan.amount).toBe(90_000) // 100_000 gross + (−10_000) discount
    const feb = res.rows.find((r) => r.identity.slug === "GLUCOSE" && r.month === 2)!
    expect(feb.amount).toBe(200_000) // no discount that month
  })

  it("reads identity from 'For PL' and keeps Export separate", () => {
    const exp = res.rows.find((r) => r.identity.slug === "CORN_STARCH__EXPORT")!
    expect(exp.month).toBe(1)
    expect(exp.amount).toBe(60_000)
  })

  it("does not leak the section 'Total' columns into a month", () => {
    const glucose = res.rows.filter((r) => r.identity.slug === "GLUCOSE")
    expect(glucose.map((r) => r.month).sort()).toEqual([1, 2])
  })
})

describe("transactional actuals", () => {
  const res = parseProductSalesSheet(wb("T", TX), "T", XLSX, {
    entityCode: CPC,
    year: 2026,
  })

  it("aggregates rows to product × month", () => {
    const jan = res.rows.find((r) => r.identity.slug === "GLUCOSE" && r.month === 1)!
    expect(jan.quantity).toBe(15) // 10 + 5
    expect(jan.amount).toBe(16_500) // 11_000 + 5_500
  })

  it("filters out rows from another year and says so", () => {
    expect(res.rows.some((r) => r.year !== 2026)).toBe(false)
    expect(res.warnings.some((w) => w.includes("outside 2026"))).toBe(true)
  })

  it("AZ product names resolve to the SAME codes the EN budget produced", () => {
    const budget = parseProductSalesSheet(wb("C", CPC_BANNER), "C", XLSX, {
      entityCode: CPC,
      year: 2026,
    })
    const actualGlucose = res.rows.find((r) => r.identity.slug === "GLUCOSE")!
    const budgetGlucose = budget.rows.find((r) => r.identity.slug === "GLUCOSE")!
    expect(actualGlucose.identity.code).toBe(budgetGlucose.identity.code)
  })
})

describe("resolveUnitPrice", () => {
  const base = {
    identity: { slug: "X", code: "E__X", name: "X", known: true },
    month: 1,
    year: 2026,
  }
  it("uses the explicit price when it agrees with amount/quantity", () => {
    expect(
      resolveUnitPrice({ ...base, quantity: 100, amount: 37_000, explicitUnitPrice: 370 }),
    ).toBe(370)
  })
  it("prefers the money when the stated price contradicts it", () => {
    expect(
      resolveUnitPrice({ ...base, quantity: 100, amount: 37_000, explicitUnitPrice: 999 }),
    ).toBe(370)
  })
  it("derives the price when none is stated", () => {
    expect(resolveUnitPrice({ ...base, quantity: 50, amount: 28_000 })).toBe(560)
  })
  it("returns 0 for a zero-quantity row (schema has no nullable price)", () => {
    expect(resolveUnitPrice({ ...base, quantity: 0, amount: 5_000 })).toBe(0)
  })
  it("handles negative (return / credit-note) rows", () => {
    expect(resolveUnitPrice({ ...base, quantity: -10, amount: -3_700 })).toBe(370)
  })
})
