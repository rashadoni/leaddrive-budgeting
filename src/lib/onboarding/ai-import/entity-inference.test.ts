import { describe, it, expect } from "vitest"
import {
  inferEntities,
  buildEntityAliasMap,
  scanDominantEntity,
  scanHeaderEntity,
  scanStatementEntities,
  isEliminationLikeEntityValue,
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

  it("normalizes explicit aliases before storing them", () => {
    const m = buildEntityAliasMap(known, { " az sf ": "AZSEKER-AZSF" })
    expect(m["AZ SF"]).toBe("AZSEKER-AZSF")
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
    // (kept below — see original holding-default case)
    expect(true).toBe(true)
  })
})

describe("scanDominantEntity (cell content scan)", () => {
  const aliasMap = buildEntityAliasMap(known, { AZSF: "AZSEKER" })

  it("reads the dominant entity code repeated in a trailing column", () => {
    // Mirrors PLF Actual 2025: 'CPC' repeated in cols 17-18 across rows.
    const rows = [
      ["PLF.01", "REVENUE", "", 100, 200, "", "", "", "", "", "", "", "", "", "", "", "", "CPC", "CPC"],
      ["PLF.02", "COGS", "", 50, 60, "", "", "", "", "", "", "", "", "", "", "", "", "CPC", "CPC"],
      ["PLF.03", "OPEX", "", 10, 20, "", "", "", "", "", "", "", "", "", "", "", "", "CPC", "CPC"],
    ]
    expect(scanDominantEntity(rows, aliasMap)?.entityCode).toBe("AZSEKER-CPC")
  })

  it("maps the AZSF alias to the holding code", () => {
    const rows = [
      ["BS.01", "ASSETS", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "AZSF", "AZSF"],
      ["BS.02", "LIAB", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "AZSF", "AZSF"],
      ["BS.03", "EQUITY", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "AZSF", "AZSF"],
    ]
    expect(scanDominantEntity(rows, aliasMap)?.entityCode).toBe("AZSEKER")
  })

  it("returns null on a tie between two entities (ambiguous)", () => {
    const rows = [
      ["x", "CPC", "EDEN"],
      ["y", "CPC", "EDEN"],
      ["z", "CPC", "EDEN"],
    ]
    expect(scanDominantEntity(rows, aliasMap)).toBeNull()
  })

  it("returns null below the minimum-cells threshold (stray mention)", () => {
    const rows = [["note: see CPC report", "", "CPC"]]
    expect(scanDominantEntity(rows, aliasMap)).toBeNull()
  })

  it("does not substring-match (CONCEPCION ≠ CPC)", () => {
    const rows = [["CONCEPCION"], ["CONCEPCION"], ["CONCEPCION"]]
    expect(scanDominantEntity(rows, aliasMap)).toBeNull()
  })

  it("returns null on a NEAR-tie (consolidated sheet — runner-up within 2×)", () => {
    // EDEN 4 vs AZSF 3 — a marginal lead, not 2× dominance ⇒ ambiguous multi-
    // entity ⇒ null (the 1070-vs-1068 consolidated-collapse class).
    const rows = [
      ["a", "EDEN"], ["b", "EDEN"], ["c", "EDEN"], ["d", "EDEN"],
      ["e", "AZSF"], ["f", "AZSF"], ["g", "AZSF"],
    ]
    expect(scanDominantEntity(rows, aliasMap)).toBeNull()
  })

  it("resolves when the top is ≥2× the runner-up (clear owner + stray mention)", () => {
    const rows = [
      ["a", "CPC"], ["b", "CPC"], ["c", "CPC"],
      ["d", "CPC"], ["e", "CPC"], ["f", "CPC"],
      ["g", "EDEN"], ["h", "EDEN"], // 2 vs 6 → 6 ≥ 2×2 ⇒ CPC
    ]
    expect(scanDominantEntity(rows, aliasMap)?.entityCode).toBe("AZSEKER-CPC")
  })
})

describe("scanHeaderEntity", () => {
  const aliasMap = buildEntityAliasMap(known, { Guvven: "AZSEKER-CPC" })

  it("resolves a single entity from title/header text", () => {
    const rows = [
      ["Guvven CPC P&L Actual 2026"],
      ["Code", "Name", "Jan", "Feb"],
      ["PLF.01", "Revenue", 1, 2],
    ]
    expect(scanHeaderEntity(rows, aliasMap)?.entityCode).toBe("AZSEKER-CPC")
  })

  it("returns null when headers mention multiple entities", () => {
    const rows = [["CPC vs EDEN"], ["Code", "Jan"]]
    expect(scanHeaderEntity(rows, aliasMap)).toBeNull()
  })

  it("does not treat elimination headers as entity aliases", () => {
    expect(isEliminationLikeEntityValue("EJE")).toBe(true)
    expect(scanHeaderEntity([["EJE elimination"]], aliasMap)).toBeNull()
  })
})

describe("scanStatementEntities", () => {
  const aliasMap = buildEntityAliasMap(known, { AZSF: "AZSEKER" })
  const rowsByName: Record<string, unknown[][]> = {
    "PLF Actual 2025": [
      ["PLF.01", "REVENUE", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "CPC", "CPC"],
      ["PLF.02", "COGS", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "CPC", "CPC"],
      ["PLF.03", "OPEX", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "CPC", "CPC"],
    ],
    "PLF Actual 2026": [
      ["PLF.01", "REVENUE", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "AZSF", "AZSF"],
      ["PLF.02", "COGS", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "AZSF", "AZSF"],
      ["PLF.03", "OPEX", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "AZSF", "AZSF"],
    ],
    "Satış CPC Fakt": [["x"], ["y"]], // already has entity — skipped
  }

  it("auto-resolves CPC for 2025 and the holding for 2026 (AZSF alias)", () => {
    const sheets: EntityInferenceSheet[] = [
      sheet("PLF Actual 2025", "PLF"),
      sheet("PLF Actual 2026", "PLF"),
      sheet("Satış CPC Fakt", "BUDGET_ACTUALS", "AZSEKER-CPC"),
    ]
    const res = scanStatementEntities(sheets, (n) => rowsByName[n] ?? [], aliasMap)
    expect(res).toHaveLength(2)
    const byName = Object.fromEntries(res.map((r) => [r.sheetName, r.entityCode]))
    expect(byName["PLF Actual 2025"]).toBe("AZSEKER-CPC")
    expect(byName["PLF Actual 2026"]).toBe("AZSEKER")
    expect(res.every((r) => r.inferredBy === "cell-scan")).toBe(true)
  })

  it("skips sheets that already carry an entity", () => {
    const sheets: EntityInferenceSheet[] = [
      sheet("Satış CPC Fakt", "BUDGET_ACTUALS", "AZSEKER-CPC"),
    ]
    expect(scanStatementEntities(sheets, (n) => rowsByName[n] ?? [], aliasMap)).toHaveLength(0)
  })

  it("skips a consolidated multi-entity BU sheet (never collapses it)", () => {
    // An un-splittable multi-BU sheet (e.g. PLF Budget 2026's BU_1..BU_4) must
    // not cell-scan-resolve — it stays null → adapter no-op, not a wrong write.
    const rows: Record<string, unknown[][]> = {
      "PLF Consolidated": [
        ["PLF.01", "REVENUE", "BU"],
        ["PLF.01", "r", "CPC"],
        ["PLF.02", "r", "CPC"],
        ["PLF.01", "r", "EDEN"],
        ["PLF.02", "r", "EDEN"],
      ],
    }
    const sheets: EntityInferenceSheet[] = [sheet("PLF Consolidated", "PLF")]
    expect(scanStatementEntities(sheets, (n) => rows[n] ?? [], aliasMap)).toEqual([])
  })

  it("resolves an entity-less statement from a single header alias", () => {
    const rows: Record<string, unknown[][]> = {
      "PLF": [
        ["Actual P&L for EDEN"],
        ["Code", "Name", "Jan"],
        ["PLF.01.01", "Revenue", 1],
      ],
    }
    const sheets: EntityInferenceSheet[] = [sheet("PLF", "PLF")]
    const res = scanStatementEntities(sheets, (n) => rows[n] ?? [], aliasMap)
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({
      entityCode: "AZSEKER-EDEN",
      inferredBy: "header-scan",
    })
  })
})

describe("inferEntities — original holding-default case (kept)", () => {
  it("real actual-budget-v1.xlsx shape (Eden+CPC sales, null PLF/BS → holding)", () => {
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
