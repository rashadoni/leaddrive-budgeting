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
  parseSalesCustomers,
  resolveUnitPrice,
  inferQuantityScale,
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

describe("quantity unit guard (kg mislabelled as 'Ton')", () => {
  // The client's CPC actuals: "Net Miqdar Ton" holding kilograms. Their own
  // summary divides by 1000; without this the Sales price reads 1000x low.
  const KG_TX: unknown[][] = [
    ["Dövr", "Məhsul qrupu", "Net Miqdar Ton", "Net Satış AZN"],
    [new Date(2026, 0, 1), "Qlükoza", 635_437, 576_206],
    [new Date(2026, 1, 1), "Qlükoza", 851_189, 723_449],
    [new Date(2026, 0, 1), "Nişasta", 675_800, 496_449],
    [new Date(2026, 1, 1), "Nişasta", 414_950, 344_536],
  ]
  // Farming actuals genuinely in tonnes — must be left alone.
  const TONNE_TX: unknown[][] = [
    ["Dövr", "Product", "Satış, Ton", "Satış, AZN"],
    [new Date(2026, 0, 1), "Buğda", 25, 9_072],
    [new Date(2026, 0, 1), "Arpa", 98, 40_148],
    [new Date(2026, 1, 1), "Arpa", 198, 81_140],
    [new Date(2026, 1, 1), "Badam", 18, 32_580],
  ]

  it("divides by 1000 when the median implied price is impossibly low for a tonne", () => {
    const res = parseProductSalesSheet(wb("K", KG_TX), "K", XLSX, {
      entityCode: CPC,
      year: 2026,
    })
    const jan = res.rows.find((r) => r.identity.slug === "GLUCOSE" && r.month === 1)!
    expect(jan.quantity).toBeCloseTo(635.437, 3)
    expect(jan.amount).toBe(576_206) // money untouched
    expect(resolveUnitPrice(jan)).toBeCloseTo(906.79, 1) // ₼/tonne, matches the client's own summary
    expect(res.warnings.some((w) => w.includes("kilograms"))).toBe(true)
  })

  it("leaves a genuine tonnes column untouched", () => {
    const res = parseProductSalesSheet(wb("T2", TONNE_TX), "T2", XLSX, {
      entityCode: EDEN,
      year: 2026,
    })
    const wheat = res.rows.find((r) => r.identity.slug === "WHEAT")!
    expect(wheat.quantity).toBe(25)
    expect(resolveUnitPrice(wheat)).toBeCloseTo(362.88, 1)
    expect(res.warnings.some((w) => w.includes("kilograms"))).toBe(false)
  })

  it("never fires on a column that doesn't claim tonnes", () => {
    expect(inferQuantityScale([
      { quantity: 1000, amount: 900 },
      { quantity: 2000, amount: 1800 },
      { quantity: 3000, amount: 2700 },
    ], "Net Quantity").divisor).toBe(1)
  })

  it("needs 3+ priced rows before inferring (one cheap by-product can't flip a sheet)", () => {
    expect(
      inferQuantityScale([{ quantity: 1000, amount: 900 }], "Net Miqdar Ton").divisor,
    ).toBe(1)
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

describe("parseSalesCustomers — concentration from the fakt rows", () => {
  // The client's counterparty tab is a pre-computed summary the register
  // parser can't read; every fakt row names its customer, so HHI and
  // top-customer share are derivable from the source of record.
  const CUST: unknown[][] = [
    ["Dövr", "Müştəri adı", "Məhsul qrupu", "Net Miqdar Ton", "Net Satış AZN"],
    [new Date(2026, 0, 1), "ATS Food MMC", "Qlükoza", 10, 600_000],
    [new Date(2026, 1, 1), "ats food mmc", "Nişasta", 5, 200_000], // same buyer, other spelling
    [new Date(2026, 0, 1), "BB 7 MMC", "Qlükoza", 4, 150_000],
    [new Date(2026, 2, 1), "Bolluq LTD", "Fruktoza", 2, 50_000],
    [new Date(2025, 5, 1), "Köhnə MMC", "Qlükoza", 99, 900_000], // other year
  ]

  it("aggregates turnover per customer and ranks by size", () => {
    const { rows } = parseSalesCustomers(wb("C", CUST), "C", XLSX, { year: 2026 })
    expect(rows.map((r) => r.name)).toEqual(["ATS Food MMC", "BB 7 MMC", "Bolluq LTD"])
    expect(rows[0].amount).toBe(800_000) // both spellings folded together
  })

  it("computes share of the year's total turnover", () => {
    const { rows } = parseSalesCustomers(wb("C", CUST), "C", XLSX, { year: 2026 })
    // total 2026 = 800k + 150k + 50k = 1.0M
    expect(rows[0].sharePct).toBeCloseTo(80, 5)
    expect(rows[1].sharePct).toBeCloseTo(15, 5)
    expect(rows.reduce((s, r) => s + r.sharePct, 0)).toBeCloseTo(100, 5)
  })

  it("excludes other years (concentration is per-period)", () => {
    const { rows } = parseSalesCustomers(wb("C", CUST), "C", XLSX, { year: 2026 })
    expect(rows.some((r) => r.name === "Köhnə MMC")).toBe(false)
  })

  it("returns [] for a sheet with no customer column — never an error", () => {
    const NO_CUST: unknown[][] = [
      ["Dövr", "Məhsul qrupu", "Net Miqdar Ton", "Net Satış AZN"],
      [new Date(2026, 0, 1), "Qlükoza", 10, 11_000],
    ]
    const { rows, warnings } = parseSalesCustomers(wb("N", NO_CUST), "N", XLSX, { year: 2026 })
    expect(rows).toEqual([])
    expect(warnings).toEqual([])
  })

  it("returns [] for a budget grid (no customer dimension)", () => {
    const { rows } = parseSalesCustomers(wb("F", FARMING), "F", XLSX, { year: 2026 })
    expect(rows).toEqual([])
  })
})
