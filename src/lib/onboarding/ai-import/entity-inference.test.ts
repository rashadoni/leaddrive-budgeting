import { describe, it, expect } from "vitest"
import {
  inferEntities,
  buildEntityAliasMap,
  type EntityInferenceSheet,
} from "./entity-inference"

const known = ["AZSEKER-CPC", "AZSEKER-EDEN", "AZSEKER-AZSF"]

function sheet(
  sheetName: string,
  dataType: EntityInferenceSheet["dataType"],
  entityCode: string | null = null,
): EntityInferenceSheet {
  return { sheetName, dataType, entityCode }
}

describe("buildEntityAliasMap", () => {
  it("derives trailing-segment aliases + full-code aliases", () => {
    const m = buildEntityAliasMap(known)
    expect(m["EDEN"]).toBe("AZSEKER-EDEN")
    expect(m["CPC"]).toBe("AZSEKER-CPC")
    expect(m["AZSEKER-CPC"]).toBe("AZSEKER-CPC")
  })

  it("skips trailing segments shorter than 3 chars (noise guard)", () => {
    const m = buildEntityAliasMap(["ORG-AB", "ORG-XY"])
    expect(m["AB"]).toBeUndefined()
    expect(m["XY"]).toBeUndefined()
    // full codes still present
    expect(m["ORG-AB"]).toBe("ORG-AB")
  })

  it("explicit aliases override derived ones", () => {
    const m = buildEntityAliasMap(known, { Guvven: "AZSEKER-CPC" })
    expect(m["GUVVEN"]).toBe("AZSEKER-CPC")
  })
})

describe("inferEntities — rule 1: filename", () => {
  it("assigns entity-less PLF/BS to the entity named in the filename", () => {
    const sheets = [sheet("PLF Actual 2025", "PLF"), sheet("BS Actual 2025", "BS")]
    const res = inferEntities(sheets, {
      filenameHint: "Guvven Fin - CPC 2026.xlsx",
      knownEntityCodes: known,
    })
    expect(res).toHaveLength(2)
    expect(res.every((r) => r.entityCode === "AZSEKER-CPC")).toBe(true)
    expect(res[0].inferredBy).toBe("filename")
  })

  it("does NOT match an alias buried inside a larger word", () => {
    const res = inferEntities([sheet("PLF Actual 2025", "PLF")], {
      filenameHint: "CONCEPCION-report.xlsx", // contains 'CPC' substring
      knownEntityCodes: known,
    })
    expect(res).toHaveLength(0)
  })

  it("ignores filename when it names TWO different entities (ambiguous)", () => {
    const res = inferEntities([sheet("PLF Actual 2025", "PLF")], {
      filenameHint: "CPC-and-EDEN-combined.xlsx",
      knownEntityCodes: known,
      holdingCompanyCode: "AZSEKER",
    })
    // No single filename entity → falls through; no resolved sheets, no holding rule
    expect(res).toHaveLength(0)
  })

  it("filename wins over single-entity propagation", () => {
    const sheets = [
      sheet("Satış CPC Fakt", "BUDGET_ACTUALS", "AZSEKER-CPC"),
      sheet("PLF Actual 2025", "PLF"),
    ]
    const res = inferEntities(sheets, {
      filenameHint: "report-EDEN.xlsx",
      knownEntityCodes: known,
    })
    expect(res[0].entityCode).toBe("AZSEKER-EDEN")
    expect(res[0].inferredBy).toBe("filename")
  })
})

describe("inferEntities — rule 2: single-entity propagation", () => {
  it("propagates the sole resolved entity to entity-less statements", () => {
    const sheets = [
      sheet("Satış CPC Fakt", "BUDGET_ACTUALS", "AZSEKER-CPC"),
      sheet("Sales Budget CPC", "SALES", "AZSEKER-CPC"),
      sheet("PLF Actual 2025", "PLF"),
      sheet("BS Actual 2025", "BS"),
    ]
    const res = inferEntities(sheets, { knownEntityCodes: known })
    expect(res).toHaveLength(2)
    expect(res.every((r) => r.entityCode === "AZSEKER-CPC")).toBe(true)
    expect(res.every((r) => r.inferredBy === "single-entity-propagation")).toBe(true)
  })

  it("does NOT fire when two distinct entities are present", () => {
    const sheets = [
      sheet("Satış CPC Fakt", "BUDGET_ACTUALS", "AZSEKER-CPC"),
      sheet("Satış Əkinçilik", "BUDGET_ACTUALS", "AZSEKER-EDEN"),
      sheet("PLF Actual 2025", "PLF"),
    ]
    const res = inferEntities(sheets, { knownEntityCodes: known })
    // two entities + no holding code → statement stays null
    expect(res).toHaveLength(0)
  })
})

describe("inferEntities — rule 3: holding-consolidated", () => {
  it("assigns the holding to entity-less statements when workbook spans ≥2 entities", () => {
    const sheets = [
      sheet("Satış CPC Fakt", "BUDGET_ACTUALS", "AZSEKER-CPC"),
      sheet("Satış Əkinçilik", "BUDGET_ACTUALS", "AZSEKER-EDEN"),
      sheet("PLF Actual 2025", "PLF"),
      sheet("BS Actual 2025", "BS"),
      sheet("CF Actual 2025", "CF"),
    ]
    const res = inferEntities(sheets, {
      knownEntityCodes: known,
      holdingCompanyCode: "AZSEKER",
    })
    expect(res).toHaveLength(3)
    expect(res.every((r) => r.entityCode === "AZSEKER")).toBe(true)
    expect(res.every((r) => r.inferredBy === "holding-consolidated")).toBe(true)
  })

  it("is review-grade confidence (<0.6) so it surfaces for confirmation", () => {
    const sheets = [
      sheet("Satış CPC Fakt", "BUDGET_ACTUALS", "AZSEKER-CPC"),
      sheet("Satış Əkinçilik", "BUDGET_ACTUALS", "AZSEKER-EDEN"),
      sheet("PLF Actual 2025", "PLF"),
    ]
    const res = inferEntities(sheets, {
      knownEntityCodes: known,
      holdingCompanyCode: "AZSEKER",
    })
    expect(res[0].confidence).toBeLessThan(0.6)
  })

  it("does NOT fire without a holding code (leaves null for manual pick)", () => {
    const sheets = [
      sheet("Satış CPC Fakt", "BUDGET_ACTUALS", "AZSEKER-CPC"),
      sheet("Satış Əkinçilik", "BUDGET_ACTUALS", "AZSEKER-EDEN"),
      sheet("PLF Actual 2025", "PLF"),
    ]
    const res = inferEntities(sheets, { knownEntityCodes: known })
    expect(res).toHaveLength(0)
  })
})

describe("inferEntities — scope + no-op guards", () => {
  it("never touches sheets that already carry an entity", () => {
    const sheets = [sheet("PLF CPC", "PLF", "AZSEKER-CPC")]
    const res = inferEntities(sheets, {
      filenameHint: "EDEN.xlsx",
      knownEntityCodes: known,
    })
    expect(res).toHaveLength(0)
  })

  it("only infers for statement types (PLF/BS/CF), not SALES/KPI/etc.", () => {
    const sheets = [
      sheet("Sales summary", "SALES"),
      sheet("Tech", "UNKNOWN"),
      sheet("PLF Actual", "PLF"),
    ]
    const res = inferEntities(sheets, {
      filenameHint: "CPC.xlsx",
      knownEntityCodes: known,
    })
    expect(res).toHaveLength(1)
    expect(res[0].sheetName).toBe("PLF Actual")
  })

  it("returns empty for a workbook with no signal at all", () => {
    const sheets = [sheet("PLF Actual 2025", "PLF"), sheet("BS Actual 2025", "BS")]
    const res = inferEntities(sheets, { knownEntityCodes: known })
    expect(res).toHaveLength(0)
  })

  it("matches the real actual-budget-v1.xlsx shape (Eden+CPC sales, null PLF/BS → holding)", () => {
    // Mirrors the live dry-run preview classification.
    const sheets = [
      sheet("İcmal", "RISK_REGISTER"),
      sheet("PLF Actual 2025", "PLF"),
      sheet("PLF Actual 2026", "PLF"),
      sheet("BS Actual 2025", "BS"),
      sheet("BS Actual 2026", "BS"),
      sheet("Satış Əkinçilik Fakt", "BUDGET_ACTUALS", "AZSEKER-EDEN"),
      sheet("Satış CPC Fakt", "BUDGET_ACTUALS", "AZSEKER-CPC"),
      sheet("PLF Budget 2026", "PLF"),
    ]
    const res = inferEntities(sheets, {
      knownEntityCodes: known,
      holdingCompanyCode: "AZSEKER",
    })
    // all 5 entity-less PLF/BS sheets → holding, review-grade
    expect(res).toHaveLength(5)
    expect(new Set(res.map((r) => r.entityCode))).toEqual(new Set(["AZSEKER"]))
    expect(res.every((r) => r.confidence < 0.6)).toBe(true)
  })
})
