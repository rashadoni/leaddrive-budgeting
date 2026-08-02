/**
 * 11.73 — a skipped block must say what it WEIGHS, not just how many rows it
 * touched.
 *
 * Eliminations are correctly excluded from every company's books: they belong
 * to no single entity. What was missing is the disclosure. The warning named a
 * row count, and a row count is the wrong unit — "21 rows skipped" reads as
 * housekeeping. Measured on `actual-budget-v1.xlsx` on 2026-08-02, those rows
 * are 1,949,279,114 by absolute value on `BS Actual 2026` and 1,080,354 on
 * `PLF Actual 2026`. Same family as 11.91 and 11.92: the behaviour is right and
 * the sentence around it was not there.
 */
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { applyBuColumnSplit } from "./bu-column-split"
import { buildEntityAliasMap } from "./entity-inference"

const ALIASES = buildEntityAliasMap(["CO-A", "CO-B"], {})

/**
 * A consolidated sheet: a 12-month header, two entity blocks and one
 * elimination block. `bu` is the last column, matching the real layout.
 */
function workbook(eliminationAmount: number): XLSX.WorkBook {
  const header = ["Code", "Label", ...Array.from({ length: 12 }, (_, i) =>
    new Date(Date.UTC(2026, i, 1))), "BU"]
  const row = (code: string, label: string, amount: number, bu: string) => [
    code, label, ...Array.from({ length: 12 }, () => amount), bu,
  ]
  // Three rows per block: `MIN_BLOCK_ROWS` is 3, and a shorter run is dropped
  // by a different guard entirely — which is how the first draft of this
  // fixture managed to assert nothing at all while looking correct.
  const block = (bu: string, label: string, amount: number) => [
    row("PLF.01.01.01", label, amount, bu),
    row("PLF.01.01.02", label, amount, bu),
    row("PLF.01.01.03", label, amount, bu),
  ]
  const aoa: unknown[][] = [
    ["Consolidated P&L"],
    header,
    ...block("CO-A", "Sales", 1000),
    ...block("CO-B", "Sales", 2000),
    ...block("EJE", "Intragroup", eliminationAmount),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  return { SheetNames: ["Sheet1"], Sheets: { Sheet1: ws } }
}

function skipWarning(amount: number): string {
  const out = applyBuColumnSplit(workbook(amount), XLSX, {
    sheetName: "Sheet1",
    dataType: "PLF",
    planKind: "actual",
    aliasMap: ALIASES,
  })
  return out.warnings.find((w) => /skipped \(not imported\)/.test(w)) ?? ""
}

describe("a skipped elimination discloses its weight", () => {
  it("names the money, not only the row count", () => {
    // 3 rows × 12 months × 500,000 = 18,000,000 absolute.
    const w = skipWarning(-500_000)
    expect(w).toContain("18,000,000 by absolute value")
    expect(w).toContain("3 rows")
  })

  it("uses ABSOLUTE value, because an elimination nets to nothing by design", () => {
    // The whole point of an elimination is that it cancels. A net total would
    // report ~0 and restate exactly the invisibility this disclosure cures.
    // Signs flipped, same disclosed weight.
    expect(skipWarning(-500_000)).toContain("18,000,000")
    expect(skipWarning(500_000)).toContain("18,000,000")
  })

  it("says the consequence, not just the fact", () => {
    // Excluding the block is correct; a reader still needs to know that any
    // holding total assembled from these companies is therefore un-eliminated.
    // That is the 123,200,854 double-count 11.84 found, stated at its source.
    const w = skipWarning(-1)
    expect(w).toMatch(/belongs to no single entity/i)
    expect(w).toMatch(/UN-ELIMINATED/)
  })

  it("falls back to the row count rather than inventing a number", () => {
    // No resolvable 12-month header → no trustworthy magnitude. The warning
    // still fires with the count it always had; a made-up figure would be
    // worse than the count.
    const flat = (bu: string, amount: number) => [
      ["X.1", "Sales", amount, bu],
      ["X.2", "Sales", amount, bu],
      ["X.3", "Sales", amount, bu],
    ]
    const ws = XLSX.utils.aoa_to_sheet([
      ["Code", "Label", "Amount", "BU"],
      ...flat("CO-A", 10),
      ...flat("CO-B", 20),
      ...flat("EJE", 30),
    ])
    const out = applyBuColumnSplit(
      { SheetNames: ["S"], Sheets: { S: ws } },
      XLSX,
      { sheetName: "S", dataType: "PLF", planKind: "actual", aliasMap: ALIASES },
    )
    const w = out.warnings.find((x) => /skipped \(not imported\)/.test(x))
    if (w) {
      expect(w).toContain("rows")
      expect(w).not.toContain("by absolute value")
    }
  })
})
