/**
 * Phase 11.37 — reading the money unit off the workbook.
 *
 * The cases that matter here are the REJECTIONS. A detector that reads a unit
 * from the wrong cell is worse than no detector: it rescales a balance sheet
 * with confidence, and the reconciliation guard cannot see it because that
 * check is scale-invariant. Every noise string below is real — taken from
 * `Reporting 2026.xlsx`.
 */
import { describe, it, expect } from "vitest"
import { parseUnitLabel, detectWorkbookUnitScale, type UnitScanSheet } from "./unit-scale"

describe("parseUnitLabel", () => {
  it("reads the declaration this workbook actually carries", () => {
    expect(parseUnitLabel("AZN thousand")).toEqual({ factor: 1000, label: "AZN thousand" })
  })

  it("reads the common spellings of the same thing", () => {
    for (const s of ["AZN '000", "thousand AZN", "in thousands of AZN", "min AZN", "тыс. AZN"]) {
      expect(parseUnitLabel(s), s).toMatchObject({ factor: 1000 })
    }
  })

  it("reads millions and billions", () => {
    expect(parseUnitLabel("AZN million")).toMatchObject({ factor: 1_000_000 })
    expect(parseUnitLabel("mln AZN")).toMatchObject({ factor: 1_000_000 })
    expect(parseUnitLabel("AZN mlrd")).toMatchObject({ factor: 1_000_000_000 })
  })

  it("REJECTS a bare currency — it is usually a column header, not a unit", () => {
    // Learned from the real pack: `Marginality!B3` is a per-row unit-of-measure
    // column reading "AZN". Accepting it as ×1 manufactured a self-conflict and
    // disabled detection on the very file this exists to read.
    expect(parseUnitLabel("AZN")).toBeNull()
    expect(parseUnitLabel("₼")).toBeNull()
  })

  it("REJECTS a column header that merely contains a currency", () => {
    expect(parseUnitLabel("Revenue, AZN")).toBeNull()
    expect(parseUnitLabel("Revenue")).toBeNull()
  })

  it("REJECTS the document descriptions that live in these workbooks", () => {
    for (const s of [
      "HF kommunal -000021401  EBBO 538278(21.12.2021)",
      "Продажи 000000003 от 02.01.2026 16:31:07",
      "Услуги 000000203 от 28.01.2025 20:23:24",
      "Consolidated Balance Sheet",
    ]) {
      expect(parseUnitLabel(s), s).toBeNull()
    }
  })

  it("REJECTS a magnitude with no currency", () => {
    expect(parseUnitLabel("thousand")).toBeNull()
    expect(parseUnitLabel("'000")).toBeNull()
  })

  it("REJECTS a label naming two different magnitudes", () => {
    expect(parseUnitLabel("AZN thousand million")).toBeNull()
  })

  it("ignores non-strings and blanks without complaint", () => {
    expect(parseUnitLabel(null)).toBeNull()
    expect(parseUnitLabel(1000)).toBeNull()
    expect(parseUnitLabel("   ")).toBeNull()
  })
})

describe("detectWorkbookUnitScale", () => {
  const sheet = (name: string, rows: unknown[][]): UnitScanSheet => ({ name, rows })

  it("finds the declaration on a SIBLING sheet — the BS tab carries none", () => {
    const res = detectWorkbookUnitScale(
      [
        sheet("BS", [["", "", "Consolidated Balance Sheet"], ["", "", 46113]]),
        sheet("CONS PL_1", [["AZN thousand", "Consolidated (Month to Date)"]]),
      ],
      ["BS"],
    )
    expect(res.conflict).toBeNull()
    expect(res.scale).toMatchObject({ factor: 1000, source: "CONS PL_1!A1" })
  })

  it("prefers the sheet being imported when it declares its own unit", () => {
    const res = detectWorkbookUnitScale(
      [
        sheet("CONS PL_1", [["AZN thousand"]]),
        sheet("BS", [["AZN thousand", "Consolidated Balance Sheet"]]),
      ],
      ["BS"],
    )
    expect(res.scale?.source).toBe("BS!A1")
  })

  it("reports a genuine disagreement instead of picking by preference order", () => {
    const res = detectWorkbookUnitScale([
      sheet("A", [["AZN thousand"]]),
      sheet("B", [["AZN million"]]),
    ])
    expect(res.scale).toBeNull()
    expect(res.conflict).toMatch(/more than one money unit/)
    expect(res.found).toHaveLength(2)
  })

  it("returns nothing — not a default — when no sheet declares a unit", () => {
    const res = detectWorkbookUnitScale([sheet("BS", [["Consolidated Balance Sheet"]])])
    expect(res.scale).toBeNull()
    expect(res.conflict).toBeNull()
  })

  it("does not scan far enough into a sheet to hit its data rows", () => {
    const rows: unknown[][] = [[], [], [], [], [], ["AZN thousand"]]
    expect(detectWorkbookUnitScale([sheet("X", rows)]).scale).toBeNull()
  })
})
