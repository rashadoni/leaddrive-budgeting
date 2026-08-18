/**
 * 2026-08-18 — the cost side the client has been shipping all along.
 *
 * `Sales Budget CPC 2026` carries six banner sections. The parser read three —
 * volumes, gross revenue, discounts — and walked past `COGS, ₼`,
 * `GROSS PROFIT, ₼` and `GROSS PROFIT MARGIN, %`. So the product table could
 * say what was sold and never what it cost, and the owner's question ("gross
 * margin per product, wheat and cotton and the others separately") had no
 * answer in a system holding a file that answers it.
 *
 * Two things are pinned, and the second is the one that matters for wheat:
 *
 *   1. cost is read, signed the way a consumer expects, and reproduces the
 *      sheet's own GROSS PROFIT column;
 *   2. a sheet with NO cost block leaves `cost` UNDEFINED rather than zero.
 *      Farming products in this workbook have sales and no costs at all; a
 *      zero there would render wheat at a 100% margin — a number that looks
 *      like an answer and is a fabrication.
 */
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parseProductSalesSheet } from "./product-sales-parser"

/** The client's banner layout: sections start at the columns given. */
function bannerSheet(opts: { withCogs: boolean }): XLSX.WorkBook {
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, i, 1)))
  const banner: unknown[] = []
  const header: unknown[] = []
  const rowA: unknown[] = []
  const rowB: unknown[] = []

  const put = (arr: unknown[], col: number, v: unknown) => {
    while (arr.length < col) arr.push(null)
    arr[col] = v
  }

  // Identity column.
  put(header, 0, "For PL")
  put(rowA, 0, "Glucose")
  put(rowB, 0, "Corn starch")

  // SALES VOLUMES, TON at col 2.
  put(banner, 2, "SALES VOLUMES, TON")
  months.forEach((m, i) => {
    put(header, 2 + i, m)
    put(rowA, 2 + i, i === 0 ? 100 : 0)
    put(rowB, 2 + i, i === 0 ? 50 : 0)
  })

  // COGS, ₼ at col 16 — negative in the file, as costs are throughout.
  if (opts.withCogs) {
    put(banner, 16, "COGS, ₼")
    months.forEach((m, i) => {
      put(header, 16 + i, m)
      put(rowA, 16 + i, i === 0 ? -2_688_419 : 0)
      put(rowB, 16 + i, i === 0 ? -2_026_908 : 0)
    })
  }

  // GROSS REVENUE, ₼ at col 30.
  const revCol = opts.withCogs ? 30 : 16
  put(banner, revCol, "GROSS REVENUE, ₼")
  months.forEach((m, i) => {
    put(header, revCol + i, m)
    put(rowA, revCol + i, i === 0 ? 5_085_990 : 0)
    put(rowB, revCol + i, i === 0 ? 3_605_280 : 0)
  })

  // GROSS PROFIT, ₼ — the sheet's own arithmetic, which must NOT be imported
  // as another money column.
  const gpCol = revCol + 14
  put(banner, gpCol, "GROSS PROFIT, ₼")
  months.forEach((m, i) => {
    put(header, gpCol + i, m)
    put(rowA, gpCol + i, i === 0 ? 2_397_571 : 0)
    put(rowB, gpCol + i, i === 0 ? 1_578_372 : 0)
  })

  const ws = XLSX.utils.aoa_to_sheet([banner, header, rowA, rowB])
  return { SheetNames: ["S"], Sheets: { S: ws } }
}

const parse = (wb: XLSX.WorkBook) =>
  parseProductSalesSheet(wb, "S", XLSX, { entityCode: "AZSEKER-CPC", year: 2026 })

describe("per-product COGS", () => {
  it("reads the cost block and reproduces the sheet's own gross profit", () => {
    const res = parse(bannerSheet({ withCogs: true }))
    const byCode = Object.fromEntries(res.rows.map((r) => [r.identity.code, r]))

    const glucose = byCode["AZSEKER_CPC__GLUCOSE"]
    expect(glucose.amount).toBeCloseTo(5_085_990, 2)
    // Stored positive-as-cost, so no consumer has to guess the sign.
    expect(glucose.cost).toBeCloseTo(2_688_419, 2)
    // The client's own GROSS PROFIT for the same cell, recomputed.
    expect(glucose.amount - glucose.cost!).toBeCloseTo(2_397_571, 2)
    // …and the margin the owner asked for: 47.1% on the real numbers.
    expect(((glucose.amount - glucose.cost!) / glucose.amount) * 100).toBeCloseTo(47.1, 1)

    const starch = byCode["AZSEKER_CPC__CORN_STARCH"]
    expect(((starch.amount - starch.cost!) / starch.amount) * 100).toBeCloseTo(43.8, 1)
  })

  it("does not import GROSS PROFIT as a second money column", () => {
    // It is the sheet's arithmetic over the two blocks beside it. Importing a
    // computed column next to its own inputs is how a total gets counted twice.
    const res = parse(bannerSheet({ withCogs: true }))
    const glucose = res.rows.find((r) => r.identity.code === "AZSEKER_CPC__GLUCOSE")!
    expect(glucose.amount).toBeCloseTo(5_085_990, 2) // not 5,085,990 + 2,397,571
  })

  it("leaves cost UNDEFINED when the sheet states none — never zero", () => {
    // The wheat case. `undefined` lets the surface say "no cost data"; a zero
    // would say "100% margin", which is a fabrication wearing a number.
    const res = parse(bannerSheet({ withCogs: false }))
    expect(res.rows.length).toBeGreaterThan(0)
    for (const row of res.rows) {
      expect(row.cost).toBeUndefined()
      expect(row.amount).toBeGreaterThan(0)
    }
  })
})
