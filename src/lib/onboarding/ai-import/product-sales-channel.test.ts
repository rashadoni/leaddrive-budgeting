/**
 * 2026-08-18 — the export channel the actuals state and the import ignored.
 *
 * The budget states the sales channel inside its "For PL" label
 * (`Glucose (Export)` → `..__GLUCOSE__EXPORT`); the transactional actuals
 * state it in a `Seqment` column (Azerbaijan / Export) that the parser never
 * read. So export sales folded into the domestic product code while the
 * export BUDGET kept its own — one product wearing two rows on the Satış tab,
 * and the deviation on both of them wrong:
 *
 *   Qlükoza   fact 3.2M (domestic 2,030,437 + export 1,190,426) vs budget 1.8M
 *   Glucose   fact 0                                            vs budget 862k
 *
 * Both numbers came from `actual-budget-v1.xlsx`, Jan–May 2026, and neither is
 * a number anyone can act on. Reading the column that was already there splits
 * the fact the same way the budget is split.
 */
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parseProductSalesSheet } from "./product-sales-parser"
import { resolveProductIdentity } from "./product-identity"

/** The CPC actuals header, in the client's own column order. */
const HEADER = [
  "Dövr",
  "Seqment",
  "Müştəri adı",
  "Məhsul qrupu",
  "Məhsul",
  "Net Miqdar Ton",
  "Net Satış AZN",
]

function txSheet(rows: unknown[][]): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet([HEADER, ...rows])
  return { SheetNames: ["S"], Sheets: { S: ws } }
}

const jan = new Date(Date.UTC(2026, 0, 1))

describe("sales channel — the actuals split the way the budget does", () => {
  it("routes an Export row to the __EXPORT code and a domestic row to the plain one", () => {
    const res = parseProductSalesSheet(
      txSheet([
        [jan, "Azerbaijan", "Client A", "Qlükoza", "Qlükoza-G40", 100, 2030437],
        [jan, "Export", "Client B", "Qlükoza", "Qlükoza-G40", 60, 1190426],
      ]),
      "S",
      XLSX,
      { entityCode: "AZSEKER-CPC", year: 2026 },
    )

    const byCode = Object.fromEntries(
      res.rows.map((r) => [r.identity.code, r.amount]),
    )
    expect(byCode["AZSEKER_CPC__GLUCOSE"]).toBeCloseTo(2030437, 2)
    expect(byCode["AZSEKER_CPC__GLUCOSE__EXPORT"]).toBeCloseTo(1190426, 2)
    // The two must not have collapsed into one row.
    expect(res.rows).toHaveLength(2)
  })

  it("matches the code the budget's own label produces", () => {
    // Budget side: the channel rides inside the label.
    const fromBudgetLabel = resolveProductIdentity("Glucose (Export)", "AZSEKER-CPC")
    // Actual side: the channel rides in the Seqment column.
    const fromActualColumn = resolveProductIdentity("Qlükoza", "AZSEKER-CPC", {
      channel: "Export",
    })
    expect(fromActualColumn.code).toBe(fromBudgetLabel.code)
    expect(fromActualColumn.code).toBe("AZSEKER_CPC__GLUCOSE__EXPORT")
  })

  it("leaves a sheet without a channel column exactly as it was", () => {
    const feb = new Date(Date.UTC(2026, 1, 1))
    const noSegment = [
      ["Dövr", "Məhsul qrupu", "Net Miqdar Ton", "Net Satış AZN"],
      [jan, "Qlükoza", 100, 500],
      [feb, "Qlükoza", 100, 500],
    ]
    const ws = XLSX.utils.aoa_to_sheet(noSegment)
    const res = parseProductSalesSheet(
      { SheetNames: ["S"], Sheets: { S: ws } },
      "S",
      XLSX,
      { entityCode: "AZSEKER-CPC", year: 2026 },
    )
    // One row per month, both on the plain code — no channel, no qualifier.
    expect(res.rows).toHaveLength(2)
    expect(
      res.rows.every((r) => r.identity.code === "AZSEKER_CPC__GLUCOSE"),
    ).toBe(true)
  })

  it("never mints a parallel product for an unrecognised channel", () => {
    // "Main"/"Other" are the Bölgü column's values, not channels. If one ever
    // reaches the channel slot, the row must keep the plain product code
    // rather than invent AZSEKER_CPC__GLUCOSE__MAIN.
    expect(
      resolveProductIdentity("Qlükoza", "AZSEKER-CPC", { channel: "Main" }).code,
    ).toBe("AZSEKER_CPC__GLUCOSE")
    expect(
      resolveProductIdentity("Qlükoza", "AZSEKER-CPC", { channel: "Azerbaijan" }).code,
    ).toBe("AZSEKER_CPC__GLUCOSE")
    expect(
      resolveProductIdentity("Qlükoza", "AZSEKER-CPC", { channel: "" }).code,
    ).toBe("AZSEKER_CPC__GLUCOSE")
  })
})
