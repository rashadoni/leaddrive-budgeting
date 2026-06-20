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
  })
  it("returns null for unknown / elimination BU", () => {
    expect(mapReportingPackBu("EJE")).toBeNull()
    expect(mapReportingPackBu("XYZ")).toBeNull()
  })
})
