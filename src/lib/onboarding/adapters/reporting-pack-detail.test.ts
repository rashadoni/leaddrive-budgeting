import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import {
  parseReportingPackPlf,
  splitWorkbookByBu,
  mapReportingPackBu,
  REPORTING_PACK_SKIP_BU,
} from "./reporting-pack-detail"

// Real 2026 month serials (Jan..Dec) as they appear in the reporting pack.
const M2026 = [
  46023, 46054, 46082, 46113, 46143, 46174, 46204, 46235, 46266, 46296, 46327,
  46357,
]

/** Build a 12-month value array. */
const vals = (v: number) => Array(12).fill(v)

function buildSheet(): XLSX.WorkBook {
  // col0 code? In the real file the CODE is col 0 and LABEL col 1, months
  // start col 3. Mirror that exactly.
  const header = ["", "", "", ...M2026, "BU"]
  const aoa: unknown[][] = [
    header,
    // parent rows (must be skipped — not leaves)
    ["PLF.01", "REVENUE", "", ...vals(999), "AZSF"],
    ["PLF.01.01", "Revenue sub", "", ...vals(999), "AZSF"],
    // leaf revenue + leaf cogs for AZSF
    ["PLF.01.01.01", "Wheat", "", ...vals(10), "AZSF"],
    ["PLF.02.01.01", "COGS Wheat", "", ...vals(-5), "AZSF"],
    // leaf revenue for EDEN
    ["PLF.01.01.01", "Wheat", "", ...vals(20), "EDEN"],
    // elimination row — must be skipped
    ["PLF.01.01.01", "Elim", "", ...vals(-3), "EJE"],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  return { SheetNames: ["Actual PLF"], Sheets: { "Actual PLF": ws } } as XLSX.WorkBook
}

describe("reporting-pack-detail — BU split", () => {
  const wb = buildSheet()
  const res = parseReportingPackPlf(wb, "Actual PLF", XLSX, { preferYear: 2026 })

  it("splits rows into one result per BU value", () => {
    const bus = res.entities.map((e) => e.buCode).sort()
    expect(bus).toEqual(["AZSF", "EDEN", "EJE"])
  })

  it("maps BU values to canonical entity codes", () => {
    const azsf = res.entities.find((e) => e.buCode === "AZSF")!
    const eden = res.entities.find((e) => e.buCode === "EDEN")!
    expect(azsf.entityCode).toBe("AZSEKER-AZSF")
    expect(eden.entityCode).toBe("AZSEKER-EDEN")
    expect(azsf.skipped).toBe(false)
  })

  it("keeps only leaf codes (parents skipped, no double-count)", () => {
    const azsf = res.entities.find((e) => e.buCode === "AZSF")!
    const codes = azsf.lines.map((l) => l.code).sort()
    expect(codes).toEqual(["PLF.01.01.01", "PLF.02.01.01"])
    expect(codes).not.toContain("PLF.01")
    expect(codes).not.toContain("PLF.01.01")
  })

  it("normalises COGS sign (Excel-negative → positive charge)", () => {
    const azsf = res.entities.find((e) => e.buCode === "AZSF")!
    const cogs = azsf.lines.find((l) => l.code === "PLF.02.01.01")!
    // source -5 per month → cogs negated → +5
    expect(cogs.perMonth.every((v) => v === 5)).toBe(true)
    const rev = azsf.lines.find((l) => l.code === "PLF.01.01.01")!
    expect(rev.perMonth.every((v) => v === 10)).toBe(true)
  })

  it("flags EJE as skipped with null entity (no cross-entity write)", () => {
    const eje = res.entities.find((e) => e.buCode === "EJE")!
    expect(eje.skipped).toBe(true)
    expect(eje.entityCode).toBeNull()
    expect(REPORTING_PACK_SKIP_BU.has("EJE")).toBe(true)
  })

  it("separates the same leaf code across entities", () => {
    const azsf = res.entities.find((e) => e.buCode === "AZSF")!
    const eden = res.entities.find((e) => e.buCode === "EDEN")!
    const azsfRev = azsf.lines.find((l) => l.code === "PLF.01.01.01")!
    const edenRev = eden.lines.find((l) => l.code === "PLF.01.01.01")!
    expect(azsfRev.perMonth[0]).toBe(10)
    expect(edenRev.perMonth[0]).toBe(20)
  })
})

describe("mapReportingPackBu", () => {
  it("maps known BU labels case-insensitively", () => {
    expect(mapReportingPackBu("ProMalt")).toBe("AZSEKER-PROMALT")
    expect(mapReportingPackBu("cpc")).toBe("AZSEKER-CPC")
    expect(mapReportingPackBu("Horizon")).toBe("AZSEKER-HORIZON")
  })
  it("returns null for unknown / elimination / rollup BU", () => {
    expect(mapReportingPackBu("EJE")).toBeNull()
    expect(mapReportingPackBu("AJE")).toBeNull()
    expect(mapReportingPackBu("Consolidated")).toBeNull()
    expect(mapReportingPackBu("XYZ")).toBeNull()
  })
  it("keeps adjustment/rollup BU values in the skip set", () => {
    // AJE stays here as the FALLBACK: it is still not a company, so it may
    // never be written as one. What changed in 11.83 is that its rows are
    // folded into the company its parent BU column names before this set is
    // consulted — see the block below.
    for (const v of ["EJE", "AJE", "CONSOLIDATED"]) {
      expect(REPORTING_PACK_SKIP_BU.has(v)).toBe(true)
    }
  })
})

// ─── 11.83 — AJE is an adjustment, not an elimination ───────────────────
//
// On `PLF Budget 2026` the AJE block is 394 rows whose only money is
// `PLF.05.12.06` "Non-Recoverable VAT Expense" = −1,677,014.63 AZN, and BU_1
// reads EDEN on every one of them. The workbook's own EBITDA row proves where
// it belongs: EDEN 11,962,639.82 + CPC 2,127,732.48 + AJE (−1,677,014.63) =
// 12,413,357.67 = PLF.08 for legal entity EDEN. Dropping the block made the
// group 1.68M more profitable than the file says.
//
// EJE is the control: on every sheet that carries one its parent dimension is
// EJE itself, so it stays skipped.
describe("reporting-pack-detail — adjustment blocks fold, eliminations do not", () => {
  /** The budget shape: BU_1 = legal entity, BU_3 = operating leaf (+ AJE). */
  function budgetSheet(): XLSX.WorkBook {
    const header = ["", "", "", ...M2026, "BU_1", "BU_2", "BU_3", "BU_4"]
    const row = (
      code: string,
      label: string,
      v: number,
      bu1: string,
      bu3: string,
    ): unknown[] => [code, label, "", ...vals(v), bu1, "Core", bu3, "Combined"]
    const aoa: unknown[][] = [
      header,
      row("PLF.01.01.01", "Wheat", 1000, "EDEN", "EDEN"),
      row("PLF.05.12.06", "Non-Recoverable VAT", -100, "EDEN", "EDEN"),
      row("PLF.01.01.01", "Wheat", 500, "CPC", "CPC"),
      row("PLF.01.01.01", "Wheat", 700, "AZSF", "AZSF"),
      // The adjustment: EDEN's cost, filed under its own BU_3 leaf.
      row("PLF.05.12.06", "Non-Recoverable VAT", -400, "EDEN", "AJE"),
    ]
    return {
      SheetNames: ["Budget PLF"],
      Sheets: { "Budget PLF": XLSX.utils.aoa_to_sheet(aoa) },
    } as XLSX.WorkBook
  }

  const res = parseReportingPackPlf(budgetSheet(), "Budget PLF", XLSX, {
    preferYear: 2026,
    buHeader: "BU_3",
  })

  it("adds the AJE amount to EDEN instead of dropping it", () => {
    const eden = res.entities.find((e) => e.buCode === "EDEN")!
    const vat = eden.lines.filter((l) => l.code === "PLF.05.12.06")
    // Two source rows survive as two lines (the PLF handler sums them per
    // entity+code+period); together they are EDEN's own 100 plus AJE's 400.
    expect(vat).toHaveLength(2)
    expect(vat.reduce((s, l) => s + l.perMonth[0], 0)).toBe(500)
  })

  it("does not double-count: the AJE entity result is empty and skipped", () => {
    const aje = res.entities.find((e) => e.buCode === "AJE")!
    expect(aje.lines).toEqual([])
    expect(aje.skipped).toBe(true)
    expect(aje.foldedInto).toBe("AZSEKER-EDEN")
  })

  it("records the fold on the owner and explains it in the warnings", () => {
    const eden = res.entities.find((e) => e.buCode === "EDEN")!
    expect(eden.foldedFrom).toEqual([{ buCode: "AJE", rowCount: 1, viaHeader: "BU_1" }])
    expect(
      res.warnings.some(
        (w) =>
          w.includes('BU "AJE"') &&
          w.includes("folded into AZSEKER-EDEN") &&
          w.includes("BU_1"),
      ),
    ).toBe(true)
  })

  it("leaves the siblings alone", () => {
    const cpc = res.entities.find((e) => e.buCode === "CPC")!
    expect(cpc.lines.find((l) => l.code === "PLF.01.01.01")!.perMonth[0]).toBe(500)
    expect(cpc.foldedFrom).toBeUndefined()
    expect(res.entities.find((e) => e.buCode === "AZSF")!.lines).toHaveLength(1)
  })

  it("the apply seam skips the AJE workbook — the owner's workbook carries the rows", () => {
    const { splits } = splitWorkbookByBu(budgetSheet(), "Budget PLF", XLSX, {
      buHeader: "BU_3",
    })
    const aje = splits.find((s) => s.buCode === "AJE")!
    expect(aje.skipped).toBe(true)
    expect(aje.foldedInto).toBe("AZSEKER-EDEN")
    const eden = splits.find((s) => s.buCode === "EDEN")!
    expect(eden.skipped).toBe(false)
    const rows = XLSX.utils.sheet_to_json<unknown[]>(eden.workbook.Sheets["Budget PLF"], {
      header: 1,
      raw: true,
      blankrows: false,
    }) as unknown[][]
    // header + EDEN's 2 rows + the folded AJE row.
    expect(rows).toHaveLength(4)
    expect(rows.slice(1).map((r) => r[r.length - 2])).toEqual(["EDEN", "EDEN", "AJE"])
  })

  it("keeps EJE skipped — its own parent dimension is EJE, so it has no owner", () => {
    const header = ["", "", "", ...M2026, "BU", "BU_1"]
    const aoa: unknown[][] = [
      header,
      ["PLF.01.01.01", "Wheat", "", ...vals(1000), "EDEN", "EDEN"],
      ["PLF.01.01.01", "Elim", "", ...vals(-3), "EJE", "EJE"],
    ]
    const wb = {
      SheetNames: ["Actual PLF"],
      Sheets: { "Actual PLF": XLSX.utils.aoa_to_sheet(aoa) },
    } as XLSX.WorkBook
    const r = parseReportingPackPlf(wb, "Actual PLF", XLSX, { preferYear: 2026 })
    const eje = r.entities.find((e) => e.buCode === "EJE")!
    expect(eje.skipped).toBe(true)
    expect(eje.foldedInto).toBeUndefined()
    expect(r.entities.find((e) => e.buCode === "EDEN")!.foldedFrom).toBeUndefined()
  })

  it("says so loudly when an adjustment cannot be attributed", () => {
    // One BU column only — nothing to read the owner from.
    const header = ["", "", "", ...M2026, "BU"]
    const aoa: unknown[][] = [
      header,
      ["PLF.01.01.01", "Wheat", "", ...vals(1000), "EDEN"],
      ["PLF.05.12.06", "VAT", "", ...vals(-400), "AJE"],
    ]
    const wb = {
      SheetNames: ["Actual PLF"],
      Sheets: { "Actual PLF": XLSX.utils.aoa_to_sheet(aoa) },
    } as XLSX.WorkBook
    const r = parseReportingPackPlf(wb, "Actual PLF", XLSX, { preferYear: 2026 })
    expect(r.entities.find((e) => e.buCode === "AJE")!.foldedInto).toBeUndefined()
    expect(
      r.warnings.some(
        (w) => w.includes('BU "AJE"') && w.includes("NOT imported") && w.includes("adjustment"),
      ),
    ).toBe(true)
  })
})

// ─── Phase 11.36 — one file, ONE cost-sign convention ───────────────────
//
// This module splits a sheet into a synthetic worksheet per BU and calls the
// canonical parser once per entity. That made each call classify the cost-sign
// convention from ONE entity's rows, so a single workbook could land two
// contradictory conventions.
//
// The observable case is the MINORITY BU. `classifyCostSign` needs ≥70% of the
// section's gross amount plus the row-count majority, so a book that is clearly
// credit-convention as a whole (costs negative) can contain one small entity
// whose own rows are all positive — a contra/correction shape. Classified
// alone, that entity reads `positive_costs` and keeps its costs positive, so
// the same file lands +30 for one BU and −40 for its sibling.
//
// (An all-zero BU classifies as `no_evidence` and takes the default flip, but
// flipping zero is not observable — that scenario cannot prove anything, which
// is why it is not the one under test here.)
describe("reporting-pack-detail — cost-sign convention is per FILE, not per BU", () => {
  /** Credit-convention sheet (costs stored NEGATIVE) with one positive-cost BU. */
  function minorityBuSheet(): XLSX.WorkBook {
    const header = ["", "", "", ...M2026, "BU"]
    const aoa: unknown[][] = [
      header,
      // AZSF carries the file's convention: costs stored NEGATIVE (3 rows, 900).
      ["PLF.01.01.01", "Wheat", "", ...vals(1000), "AZSF"],
      ["PLF.02.01.01", "COGS Wheat", "", ...vals(-400), "AZSF"],
      ["PLF.02.01.02", "COGS Barley", "", ...vals(-300), "AZSF"],
      ["PLF.02.01.03", "COGS Corn", "", ...vals(-200), "AZSF"],
      // EDEN is the minority: one positive cost row (30) — 3% of the gross.
      ["PLF.01.01.01", "Wheat", "", ...vals(500), "EDEN"],
      ["PLF.02.01.04", "COGS Rye", "", ...vals(30), "EDEN"],
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    return { SheetNames: ["Actual PLF"], Sheets: { "Actual PLF": ws } } as XLSX.WorkBook
  }

  const res = parseReportingPackPlf(minorityBuSheet(), "Actual PLF", XLSX, {
    preferYear: 2026,
  })

  it("applies the file's verdict to a BU whose own rows read the other way", () => {
    // Pre-11.36 EDEN classified itself `positive_costs` and kept +30, while
    // AZSF read `negative_costs` and flipped to +400. Two conventions, one file.
    // Under the sheet-level verdict (`negative_costs`) EDEN flips too: −30.
    const eden = res.entities.find((e) => e.buCode === "EDEN")!
    const cogs = eden.lines.find((l) => l.code === "PLF.02.01.04")!
    expect(cogs.perMonth.every((v) => v === -30)).toBe(true)
  })

  it("leaves the majority BU on the same verdict it already had", () => {
    const azsf = res.entities.find((e) => e.buCode === "AZSF")!
    const cogs = azsf.lines.find((l) => l.code === "PLF.02.01.01")!
    expect(cogs.perMonth.every((v) => v === 400)).toBe(true)
  })

  it("never touches revenue, whichever way the cost verdict goes", () => {
    const eden = res.entities.find((e) => e.buCode === "EDEN")!
    const rev = eden.lines.find((l) => l.code === "PLF.01.01.01")!
    expect(rev.perMonth.every((v) => v === 500)).toBe(true)
  })

  it("reports the convention once at sheet level, not once per BU", () => {
    const notes = res.warnings.filter((w) => w.startsWith("Cost-sign convention"))
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatch(/stored NEGATIVE/i)
  })

  it("does NOT flip a debit-convention file", () => {
    const header = ["", "", "", ...M2026, "BU"]
    const aoa: unknown[][] = [
      header,
      ["PLF.01.01.01", "Wheat", "", ...vals(100), "AZSF"],
      ["PLF.02.01.01", "COGS Wheat", "", ...vals(40), "AZSF"],
      ["PLF.03.01.01", "Opex", "", ...vals(10), "AZSF"],
      ["PLF.01.01.01", "Wheat", "", ...vals(50), "EDEN"],
      ["PLF.02.01.02", "COGS Rye", "", ...vals(20), "EDEN"],
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = { SheetNames: ["Actual PLF"], Sheets: { "Actual PLF": ws } } as XLSX.WorkBook
    const r = parseReportingPackPlf(wb, "Actual PLF", XLSX, { preferYear: 2026 })
    const azsf = r.entities.find((e) => e.buCode === "AZSF")!
    expect(azsf.lines.find((l) => l.code === "PLF.02.01.01")!.perMonth.every((v) => v === 40)).toBe(
      true,
    )
    expect(azsf.lines.find((l) => l.code === "PLF.03.01.01")!.perMonth.every((v) => v === 10)).toBe(
      true,
    )
  })

  it("still flips a credit-convention file (the AZSEKER shape) — unchanged", () => {
    const r = parseReportingPackPlf(buildSheet(), "Actual PLF", XLSX, { preferYear: 2026 })
    const azsf = r.entities.find((e) => e.buCode === "AZSF")!
    const cogs = azsf.lines.find((l) => l.code === "PLF.02.01.01")!
    expect(cogs.perMonth.every((v) => v === 5)).toBe(true)
  })

  it("raises the ambiguous verdict once at sheet level, not per BU", () => {
    const header = ["", "", "", ...M2026, "BU"]
    const aoa: unknown[][] = [
      header,
      ["PLF.01.01.01", "Wheat", "", ...vals(100), "AZSF"],
      ["PLF.02.01.01", "COGS A", "", ...vals(40), "AZSF"],
      ["PLF.02.01.02", "COGS B", "", ...vals(-40), "AZSF"],
      ["PLF.01.01.01", "Wheat", "", ...vals(50), "EDEN"],
      ["PLF.02.01.03", "COGS C", "", ...vals(30), "EDEN"],
      ["PLF.02.01.04", "COGS D", "", ...vals(-30), "EDEN"],
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = { SheetNames: ["Actual PLF"], Sheets: { "Actual PLF": ws } } as XLSX.WorkBook
    const r = parseReportingPackPlf(wb, "Actual PLF", XLSX, { preferYear: 2026 })
    expect(r.warnings.filter((w) => w.startsWith("BLOCKED:"))).toHaveLength(1)
  })
})
