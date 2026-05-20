import { describe, it, expect } from "vitest"
import { buildEntitySheetMaps, resolveCompanyCodes } from "./wire-azseker-adapters"
import type { SheetClassification } from "./sheet-classifier"

function cls(
  sheetName: string,
  dataType: SheetClassification["dataType"],
  entityCode: string | null,
  confidence = 0.9,
): SheetClassification {
  return {
    sheetName,
    dataType,
    entityCode,
    confidence,
    reasoning: "test",
  }
}

describe("buildEntitySheetMaps", () => {
  it("groups P&L/BS/CF sheets by entity", () => {
    const result = buildEntitySheetMaps([
      cls("PLF CPC", "PLF", "AZSEKER-CPC"),
      cls("BS CPC", "BS", "AZSEKER-CPC"),
      cls("CF CPC", "CF", "AZSEKER-CPC"),
      cls("PLF EDEN", "PLF", "AZSEKER-EDEN"),
    ])
    const cpc = result.find((e) => e.code === "AZSEKER-CPC")!
    expect(cpc.plSheet).toBe("PLF CPC")
    expect(cpc.bsSheet).toBe("BS CPC")
    expect(cpc.cfSheet).toBe("CF CPC")
    const eden = result.find((e) => e.code === "AZSEKER-EDEN")!
    expect(eden.plSheet).toBe("PLF EDEN")
    expect(eden.bsSheet).toBeNull()
  })

  it("buckets cross-entity sheets under _CROSS", () => {
    const result = buildEntitySheetMaps([
      cls("Farming KPI", "KPI_FARMING", null),
      cls("CAPEX_Farm", "CAPEX", "AZSEKER-EDEN"),
      cls("Çıxarışların uçotu", "LAND_REGISTRY", "AZSEKER-EDEN"),
    ])
    const cross = result.find((e) => e.code === "_CROSS")
    expect(cross).toBeDefined()
    expect(cross!.kpiFarmingSheets).toEqual(["Farming KPI"])
    const eden = result.find((e) => e.code === "AZSEKER-EDEN")!
    expect(eden.capexSheets).toEqual(["CAPEX_Farm"])
    expect(eden.landSheets).toEqual(["Çıxarışların uçotu"])
  })

  it("skips INFO_SUMMARY + UNKNOWN classifications", () => {
    const result = buildEntitySheetMaps([
      cls("Actual >>>", "INFO_SUMMARY", null, 1.0),
      cls("Weird sheet", "UNKNOWN", null, 0.3),
      cls("PLF CPC", "PLF", "AZSEKER-CPC"),
    ])
    // Only AZSEKER-CPC should be present
    expect(result).toHaveLength(1)
    expect(result[0].code).toBe("AZSEKER-CPC")
  })

  it("skips low-confidence classifications (<0.5)", () => {
    const result = buildEntitySheetMaps([
      cls("Maybe PLF", "PLF", "AZSEKER-CPC", 0.4),
    ])
    expect(result).toHaveLength(0)
  })

  it("dedups duplicate PLF sheets (first one wins)", () => {
    const result = buildEntitySheetMaps([
      cls("PLF CPC", "PLF", "AZSEKER-CPC"),
      cls("PLF CPC v2 backup", "PLF", "AZSEKER-CPC"),
    ])
    const cpc = result.find((e) => e.code === "AZSEKER-CPC")!
    expect(cpc.plSheet).toBe("PLF CPC")
  })

  it("collects multiple KPI/Sales/CAPEX sheets per entity", () => {
    const result = buildEntitySheetMaps([
      cls("CAPEX_Farm", "CAPEX", "AZSEKER-EDEN"),
      cls("CAPEX_CPC_Extra", "CAPEX", "AZSEKER-EDEN"),
      cls("Sales 1", "SALES", "AZSEKER-EDEN"),
      cls("Sales 2", "SALES", "AZSEKER-EDEN"),
    ])
    const eden = result.find((e) => e.code === "AZSEKER-EDEN")!
    expect(eden.capexSheets).toEqual(["CAPEX_Farm", "CAPEX_CPC_Extra"])
    expect(eden.salesSheets).toEqual(["Sales 1", "Sales 2"])
  })
})

describe("resolveCompanyCodes", () => {
  it("extracts unique entity codes", () => {
    const codes = resolveCompanyCodes([
      cls("PLF CPC", "PLF", "AZSEKER-CPC"),
      cls("BS CPC", "BS", "AZSEKER-CPC"),
      cls("PLF EDEN", "PLF", "AZSEKER-EDEN"),
      cls("Cross", "KPI_FARMING", null),
    ])
    expect(codes.sort()).toEqual(["AZSEKER-CPC", "AZSEKER-EDEN"])
  })

  it("returns empty when no entities found", () => {
    expect(resolveCompanyCodes([])).toEqual([])
    expect(
      resolveCompanyCodes([cls("X", "KPI_FARMING", null)]),
    ).toEqual([])
  })
})
