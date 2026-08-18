/**
 * 2026-08-18 — the EJE case: a BU block whose ONLY money is in its own
 * subtotal rows.
 *
 * On `actual-budget-v1.xlsx` the fact sheet's EJE block parses to zero
 * posting rows while its own PLF.08/PLF.10 state -15,218. The old pipeline
 * read that as "unknown layout", paid the dynamic detector to find the same
 * zero leaves, and dropped the block — consolidated EBITDA landed 15,218
 * ABOVE the file's own bottom line, and nobody was told.
 *
 * These tests pin the policy, both halves:
 *   - zero posting rows + material stated subtotals → derived `.DV` lines
 *     that hit the block's own bottom line exactly, plus a loud warning;
 *   - posting rows PRESENT that disagree with the stated subtotal → nothing
 *     is derived (a plug line would bury real mapping bugs), the CROSS-FOOT
 *     warning stays the only voice.
 */
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parsePlfPlSheet } from "./azseker-plf"
import type { CostSignDecision } from "../ai-import/cost-sign"

/** The whole-file verdict a BU-split caller passes down (AZSEKER files
 *  store costs negative). Explicit so the assertions below own the flip. */
const NEGATIVE_COSTS: CostSignDecision = {
  flipCogs: true,
  flipExpense: true,
  cogsConvention: "negative_costs",
  expenseConvention: "negative_costs",
  blockedReason: null,
  notes: [],
}

function workbook(rows: unknown[][]): XLSX.WorkBook {
  const header = [
    "Code",
    "Label",
    ...Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, i, 1))),
  ]
  const aoa: unknown[][] = [["PLF"], header, ...rows]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  return { SheetNames: ["S"], Sheets: { S: ws } }
}

/** 12 months: `value` in January, zero elsewhere. */
const jan = (value: number) => [value, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

describe("subtotal-only block synthesis", () => {
  it("derives the EJE shape: stated EBITDA/NET with zero posting rows", () => {
    const wb = workbook([
      ["PLF.05", "SUPPORTING FUNCTIONS COST", ...jan(0)],
      ["PLF.05.01.01", "Salaries", ...jan(0)],
      ["PLF.08", "EBITDA", ...jan(-15218)],
      ["PLF.10", "NET PROFIT / (LOSS)", ...jan(-15218)],
    ])
    const res = parsePlfPlSheet(wb, "S", XLSX, {
      preferYear: 2026,
      signOverride: NEGATIVE_COSTS,
    })

    // One derived line: the EBITDA residual (every section is zero, and
    // PLF.10 equals PLF.08 so there is no below-EBITDA residual either).
    expect(res.lines).toHaveLength(1)
    const line = res.lines[0]
    expect(line.code).toBe("PLF.05.98.DV")
    expect(line.derived).toBe(true)
    // File states -15,218 (cost, file convention); flipExpense stores it
    // positive, the same trip every parsed expense row makes.
    expect(line.perMonth[0]).toBeCloseTo(15218, 6)
    expect(line.totalAnnual).toBeCloseTo(15218, 6)

    // The parse now agrees with the sheet's own bottom line by construction.
    expect(res.crossFoot?.mismatch).toBe(false)
    expect(
      res.warnings.some((w) => w.reason.includes("SUBTOTAL-ONLY BLOCK")),
    ).toBe(true)
  })

  it("derives stated sections and the below-EBITDA residual separately", () => {
    const wb = workbook([
      // Zero-valued leaf children keep the sections PARENTS (a childless
      // section can be rescued as a leaf — see plf-leaf-codes.ts 11.74) and
      // mirror the real EJE shape: the posting rows exist, all of them zero.
      ["PLF.01", "REVENUE", ...jan(100)],
      ["PLF.01.01.01", "Revenue detail", ...jan(0)],
      ["PLF.02", "COST OF GOODS SOLD", ...jan(-40)],
      ["PLF.02.01.01", "COGS detail", ...jan(0)],
      ["PLF.08", "EBITDA", ...jan(60)],
      ["PLF.10", "NET PROFIT / (LOSS)", ...jan(50)],
    ])
    const res = parsePlfPlSheet(wb, "S", XLSX, {
      preferYear: 2026,
      signOverride: NEGATIVE_COSTS,
    })

    const byCode = Object.fromEntries(res.lines.map((l) => [l.code, l]))
    // Revenue never flips.
    expect(byCode["PLF.01.99.DV"]?.perMonth[0]).toBeCloseTo(100, 6)
    expect(byCode["PLF.01.99.DV"]?.accountType).toBe("revenue")
    // COGS stated -40, stored positive.
    expect(byCode["PLF.02.99.DV"]?.perMonth[0]).toBeCloseTo(40, 6)
    // EBITDA residual is zero (100 - 40 = 60 = stated PLF.08): no plug line.
    expect(byCode["PLF.05.98.DV"]).toBeUndefined()
    // Below-EBITDA residual: stated 50 - 60 = -10, stored positive.
    expect(byCode["PLF.09.99.DV"]?.perMonth[0]).toBeCloseTo(10, 6)
    expect(res.lines).toHaveLength(3)
    expect(res.crossFoot?.mismatch).toBe(false)
  })

  it("refuses to patch a block that HAS rows but disagrees with itself", () => {
    const wb = workbook([
      ["PLF.01.01.01", "Revenue from Sale of Wheat", ...jan(100)],
      ["PLF.10", "NET PROFIT / (LOSS)", ...jan(80)],
    ])
    const res = parsePlfPlSheet(wb, "S", XLSX, {
      preferYear: 2026,
      signOverride: NEGATIVE_COSTS,
    })

    // The real row imported; nothing was derived to close the 20 gap.
    expect(res.lines).toHaveLength(1)
    expect(res.lines[0].code).toBe("PLF.01.01.01")
    expect(res.lines.every((l) => !l.derived)).toBe(true)
    expect(res.crossFoot?.mismatch).toBe(true)
    expect(res.warnings.some((w) => w.reason.includes("CROSS-FOOT"))).toBe(true)
    expect(
      res.warnings.some((w) => w.reason.includes("SUBTOTAL-ONLY BLOCK")),
    ).toBe(false)
  })

  it("leaves a genuinely empty block alone", () => {
    const wb = workbook([
      ["PLF.01", "REVENUE", ...jan(0)],
      ["PLF.08", "EBITDA", ...jan(0)],
      ["PLF.10", "NET PROFIT / (LOSS)", ...jan(0)],
    ])
    const res = parsePlfPlSheet(wb, "S", XLSX, {
      preferYear: 2026,
      signOverride: NEGATIVE_COSTS,
    })

    expect(res.lines).toHaveLength(0)
    expect(
      res.warnings.some((w) => w.reason.includes("SUBTOTAL-ONLY BLOCK")),
    ).toBe(false)
  })
})
