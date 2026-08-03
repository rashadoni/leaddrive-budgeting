import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parseEliminationBlock, isIntragroupEliminationBuValue } from "./bs-eliminations"

/** The serials the client's own header row uses for Jan/Feb 2026. */
const JAN = 46023
const FEB = 46054

const HEADER: unknown[] = [null, null, null, JAN, FEB]

function sheetOf(rows: unknown[][]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER, ...rows]), "EJE")
  return wb
}

const parse = (rows: unknown[][]) =>
  parseEliminationBlock(sheetOf(rows), "EJE", XLSX, { preferYear: 2026 })

/**
 * A minimal balanced elimination with every shape the real block contains:
 * two four-segment investment reversals, their three-segment equity
 * counterpart, the sheet's own subtotal row, and the uncoded deferred asset.
 */
const BALANCED: unknown[][] = [
  ["BS.01.01.05.03", "Investments in Joint Ventures (ProMalt Investment)", null, -100, -110],
  ["BS.02.01.01", "Share/Charter capital", null, 100, 110],
  ["BS.02", "EQUITY", null, 100, 110],
  ["BS.01.01.05.03", "Investments in Joint Ventures (QTA Investment)", null, -50, -50],
  ["---", "Deferred Asset on Business Combination", null, 50, 50],
]

describe("parseEliminationBlock — reading the block the statement is coded above", () => {
  it("posts four-segment detail to the three-segment line the entities use", () => {
    // The whole point. Entity blocks post `BS.01.01.05` "Equity Investments";
    // the elimination posts `BS.01.01.05.03` per intercompany holding. Keeping
    // them at four segments would put the reversal on a line no entity uses,
    // so it would never net against anything on screen.
    const r = parse(BALANCED)
    expect(r.blocked).toBeNull()
    const equityInvestments = r.lines.find((l) => l.code === "BS.01.01.05")
    expect(equityInvestments?.lineType).toBe("asset")
    expect(equityInvestments?.monthlyAmounts["2026-01"]).toBe(-150)
    expect(equityInvestments?.monthlyAmounts["2026-02"]).toBe(-160)
  })

  it("names every source line that folded into a total", () => {
    // "Equity Investments moved by 150" is not reviewable; "…because of these
    // two named intercompany holdings" is.
    const r = parse(BALANCED)
    const labels = r.lines
      .find((l) => l.code === "BS.01.01.05")!
      .sources.map((s) => s.label)
    expect(labels).toEqual([
      "Investments in Joint Ventures (ProMalt Investment)",
      "Investments in Joint Ventures (QTA Investment)",
    ])
  })

  it("ignores the block's own subtotal rows", () => {
    // `BS.02` restates the equity line directly above it. Counting it would
    // double the equity side and, because the asset side would not move, would
    // also make the block miss balance — a second failure hiding the first.
    const r = parse(BALANCED)
    expect(r.totalsByMonth["2026-01"].equity).toBe(100)
    expect(r.totalsByMonth["2026-01"].residual).toBe(0)
  })

  it("classifies the uncoded deferred asset from its label, on its own line", () => {
    const r = parse(BALANCED)
    const deferred = r.lines.find((l) => l.code === "BS.01.01.99")
    expect(deferred?.lineType).toBe("asset")
    expect(deferred?.monthlyAmounts["2026-01"]).toBe(50)
    // And says so: the side cannot be derived from the arithmetic, because a
    // single unpaired entry balances the block either way.
    expect(r.warnings.join(" ")).toMatch(/no chart code/i)
    expect(r.warnings.join(" ")).toMatch(/label is the only evidence/i)
  })

  it("reports the per-month totals a caller needs to consolidate", () => {
    const r = parse(BALANCED)
    expect(r.totalsByMonth["2026-01"]).toEqual({
      assets: -100,
      liabilities: 0,
      equity: 100,
      residual: 0,
    })
    expect(r.totalsByMonth["2026-02"].assets).toBe(-110)
  })
})

describe("what it refuses, and why refusing is the safe direction", () => {
  it("refuses a block that does not balance, naming the month and the gap", () => {
    // Half an elimination is the one outcome worse than none: the group total
    // was at least honestly un-eliminated before, and A ≠ L + E stops
    // `normalizeBalanceSheetMonth` publishing liabilities and equity at all.
    const r = parse(BALANCED.filter((row) => row[0] !== "---"))
    expect(r.blocked).toMatch(/does not balance/i)
    expect(r.blocked).toMatch(/2026-01/)
    expect(r.blocked).toMatch(/-50\.00|50\.00/)
    expect(r.lines).toEqual([])
  })

  it("refuses an uncoded line that carries money and is not in the table", () => {
    // This is the exact shape of the deferred asset — a six-figure line with
    // `---` in the code column. Guessing a home for the next one is how a
    // group balance sheet ends up wrong and balanced, which nothing
    // downstream can detect.
    const r = parse([
      ...BALANCED,
      ["---", "Some New Consolidation Entry", null, 900_000, 900_000],
    ])
    expect(r.blocked).toMatch(/no usable chart code/i)
    expect(r.blocked).toMatch(/Some New Consolidation Entry/)
    // Absolute value across every month it touches — a balance-sheet line
    // that sits at 900,000 for two months is 1.8M of unattributed movement to
    // whoever has to decide what it is, not 900,000.
    expect(r.blocked).toMatch(/1,800,000/)
  })

  it("lets an uncoded line through when it carries nothing", () => {
    // The sheet is full of spacer and header rows. Only a row that moves
    // money is a decision.
    const r = parse([...BALANCED, ["---", "Spacer", null, 0, null]])
    expect(r.blocked).toBeNull()
  })

  it("does not treat a year with no columns as a failure", () => {
    // A workbook legitimately ships one balance-sheet tab per year.
    const r = parseEliminationBlock(sheetOf(BALANCED), "EJE", XLSX, { preferYear: 2029 })
    expect(r.blocked).toBeNull()
    expect(r.lines).toEqual([])
    expect(r.warnings.join(" ")).toMatch(/nothing to import/i)
  })

  it("does not blow up on a sheet that is not there", () => {
    const r = parseEliminationBlock(sheetOf(BALANCED), "nope", XLSX, { preferYear: 2026 })
    expect(r.blocked).toMatch(/not found/i)
  })
})

describe("isIntragroupEliminationBuValue — the label is the only guard", () => {
  it("accepts the labels a real elimination block carries", () => {
    for (const v of ["EJE", "eje", " Eje ", "ELIM", "Eliminations", "INTERCOMPANY", "Intragroup", "eliminasiya"]) {
      expect(isIntragroupEliminationBuValue(v), v).toBe(true)
    }
  })

  it("REFUSES consolidation labels — they are totals, not eliminations", () => {
    // The dangerous case. `isEliminationLikeEntityValue` says true to all of
    // these because it answers "is this not a company?". Routing a totals
    // block to the elimination writer adds a second whole balance sheet to the
    // group, and the A + L + E = 0 gate cannot object because a consolidated
    // balance sheet balances too.
    for (const v of ["CONSOLIDATED", "CONSOL", "CONSOLIDATION", "Total", "GROUP"]) {
      expect(isIntragroupEliminationBuValue(v), v).toBe(false)
    }
  })

  it("REFUSES the management-adjustment labels", () => {
    // AJE belongs to a real entity and is folded into it (11.83), never
    // treated as the group's elimination.
    for (const v of ["AJE", "ADJ", "MJE", "TB ADJ"]) {
      expect(isIntragroupEliminationBuValue(v), v).toBe(false)
    }
  })

  it("matches whole labels, so a company keeps its name", () => {
    for (const v of ["Intergroup Trading LLC", "Elimco MMC", "EJE Holdings", "", null, undefined]) {
      expect(isIntragroupEliminationBuValue(v), String(v)).toBe(false)
    }
  })
})
