/**
 * Phase 7.M Tier 3 — tests for Təsvir sheet parser. Mirrors the actual
 * sheet layout we observed in `Guvven Fin.xlsx` (May 19) where Azik
 * filled in EDEN AGRO + CPC; AZSF + MALT not yet present.
 */
import { describe, it, expect } from "vitest"
import {
  parseTesvirSheetFromAoa,
  resolveEntityCodeFromTesvirLabel,
} from "./azseker-workbook-descriptions"

describe("resolveEntityCodeFromTesvirLabel", () => {
  it("maps EDEN AGRO → AZSEKER-EDEN", () => {
    expect(resolveEntityCodeFromTesvirLabel("EDEN AGRO")).toBe(
      "AZSEKER-EDEN",
    )
  })
  it("maps CPC → AZSEKER-CPC", () => {
    expect(resolveEntityCodeFromTesvirLabel("CPC")).toBe("AZSEKER-CPC")
  })
  it("maps AZSF → AZSEKER-AZSF", () => {
    expect(resolveEntityCodeFromTesvirLabel("AZSF")).toBe("AZSEKER-AZSF")
  })
  it("maps Azərşəkər (alt form) → AZSEKER-AZSF", () => {
    expect(resolveEntityCodeFromTesvirLabel("Azərşəkər")).toBe(
      "AZSEKER-AZSF",
    )
  })
  it("maps Malt → AZSEKER-MALT", () => {
    expect(resolveEntityCodeFromTesvirLabel("Malt")).toBe("AZSEKER-MALT")
  })
  it("maps Promalt MMC → AZSEKER-PROMALT", () => {
    expect(resolveEntityCodeFromTesvirLabel("Promalt MMC")).toBe(
      "AZSEKER-PROMALT",
    )
  })
  it("returns null for unknown labels", () => {
    expect(resolveEntityCodeFromTesvirLabel("Random Company")).toBeNull()
    expect(resolveEntityCodeFromTesvirLabel("")).toBeNull()
  })
  it("is whitespace + case tolerant", () => {
    expect(resolveEntityCodeFromTesvirLabel("  eden agro  ")).toBe(
      "AZSEKER-EDEN",
    )
  })
})

describe("parseTesvirSheetFromAoa", () => {
  it("parses the actual May 19 layout (EDEN AGRO + CPC with advantage rows)", () => {
    const aoa: unknown[][] = [
      [], // row 1 (empty)
      [null, "Şirkət", "Təsvir"], // row 2 — headers
      [null, "EDEN AGRO", "Əkinçilik ilə məşğul olan bir şirkətdir..."],
      [null, "", "Şirkətin əsas üstünlüyü, müasir suvarma sistemlərinin..."],
      [], // row 5 (blank separator)
      [null, "CPC", "Cənubi qafqazında tək qarğıdalı dərin emalı..."],
      [null, "", "Zavod Oğuzda yerləşir və müasir avadanlıqlarına..."],
    ]
    const result = parseTesvirSheetFromAoa(aoa)
    expect(result.descriptions).toHaveLength(2)
    expect(result.descriptions[0].companyCode).toBe("AZSEKER-EDEN")
    expect(result.descriptions[0].entityLabel).toBe("EDEN AGRO")
    expect(result.descriptions[0].description).toMatch(/Əkinçilik/)
    expect(result.descriptions[0].competitiveAdvantage).toMatch(
      /müasir suvarma/,
    )
    expect(result.descriptions[0].fullText).toContain("Əkinçilik")
    expect(result.descriptions[0].fullText).toContain("müasir suvarma")
    expect(result.descriptions[1].companyCode).toBe("AZSEKER-CPC")
    expect(result.descriptions[1].competitiveAdvantage).toMatch(/Oğuzda/)
    expect(result.warnings).toEqual([])
  })

  it("handles entity with only main description, no advantage row", () => {
    const aoa: unknown[][] = [
      [null, "Şirkət", "Təsvir"],
      [null, "AZSF", "Sugar production facility."],
      [], // blank — no advantage line for AZSF
      [null, "CPC", "Corn deep processing."],
    ]
    const result = parseTesvirSheetFromAoa(aoa)
    expect(result.descriptions).toHaveLength(2)
    expect(result.descriptions[0].competitiveAdvantage).toBeNull()
    expect(result.descriptions[0].fullText).toBe(
      "Sugar production facility.",
    )
    expect(result.descriptions[1].companyCode).toBe("AZSEKER-CPC")
  })

  it("skips empty descriptions with a warning", () => {
    const aoa: unknown[][] = [
      [null, "EDEN AGRO", ""], // empty description
      [null, "CPC", "Real text."],
    ]
    const result = parseTesvirSheetFromAoa(aoa)
    expect(result.descriptions).toHaveLength(1)
    expect(result.descriptions[0].companyCode).toBe("AZSEKER-CPC")
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0]).toMatch(/Empty description/)
  })

  it("skips unknown entity labels silently", () => {
    const aoa: unknown[][] = [
      [null, "EDEN AGRO", "Eden text."],
      [null, "Random Company", "Random text."],
      [null, "CPC", "CPC text."],
    ]
    const result = parseTesvirSheetFromAoa(aoa)
    expect(result.descriptions).toHaveLength(2)
    expect(result.descriptions.map((d) => d.companyCode)).toEqual([
      "AZSEKER-EDEN",
      "AZSEKER-CPC",
    ])
  })

  it("dedups duplicate entity entries with a warning", () => {
    const aoa: unknown[][] = [
      [null, "EDEN AGRO", "First entry."],
      [],
      [null, "EDEN AGRO", "Second entry — should be skipped."],
    ]
    const result = parseTesvirSheetFromAoa(aoa)
    expect(result.descriptions).toHaveLength(1)
    expect(result.descriptions[0].description).toBe("First entry.")
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0]).toMatch(/Duplicate/)
  })

  it("returns empty result for empty sheet", () => {
    const result = parseTesvirSheetFromAoa([])
    expect(result.descriptions).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.rowsExamined).toBe(0)
  })

  it("ignores non-string label cells gracefully", () => {
    const aoa: unknown[][] = [
      [null, 12345, "Numeric label — ignored."],
      [null, null, "Null label — ignored."],
      [null, "EDEN AGRO", "Eden description."],
    ]
    const result = parseTesvirSheetFromAoa(aoa)
    expect(result.descriptions).toHaveLength(1)
    expect(result.descriptions[0].companyCode).toBe("AZSEKER-EDEN")
  })
})
