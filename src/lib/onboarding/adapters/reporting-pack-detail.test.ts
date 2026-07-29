import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import {
  parseReportingPackPlf,
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
    for (const v of ["EJE", "AJE", "CONSOLIDATED"]) {
      expect(REPORTING_PACK_SKIP_BU.has(v)).toBe(true)
    }
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
