import { describe, it, expect } from "vitest"
import { detectFileType } from "./file-type-detector"
import type { SheetClassification } from "./sheet-classifier"

/** Helper: build a classification stub with all required fields. */
function cls(
  sheetName: string,
  dataType: SheetClassification["dataType"],
  entityCode: string | null = null,
  confidence = 0.95,
): SheetClassification {
  return {
    sheetName,
    dataType,
    entityCode,
    confidence,
    reasoning: "test",
  }
}

describe("detectFileType", () => {
  it("classifies file with PLF + BS + CF as main-financial (typical Guvven Fin.xlsx)", () => {
    const result = detectFileType(
      [
        cls("Təsvir", "DESCRIPTIONS"),
        cls("PLF CPC", "PLF", "AZSEKER-CPC"),
        cls("BS CPC", "BS", "AZSEKER-CPC"),
        cls("CF CPC", "CF", "AZSEKER-CPC"),
        cls("PLF AZSF", "PLF", "AZSEKER-AZSF"),
        cls("BS AZSF", "BS", "AZSEKER-AZSF"),
        cls("CF AZSF", "CF", "AZSEKER-AZSF"),
        cls("Farming KPI", "KPI_FARMING"),
        cls("CPC KPI", "KPI_PROCESSING", "AZSEKER-CPC"),
        cls("Actual >>>", "INFO_SUMMARY"),
      ],
      "Guvven Fin.xlsx",
    )
    expect(result.fileType).toBe("main-financial")
    expect(result.confidence).toBeGreaterThan(0.8)
    expect(result.reasoning).toMatch(/PLF.*BS.*CF/)
    expect(result.sheetCounts.plf).toBe(2)
    expect(result.sheetCounts.bs).toBe(2)
    expect(result.sheetCounts.cf).toBe(2)
  })

  it("classifies file with only LAND_REGISTRY as land-registry", () => {
    const result = detectFileType(
      [cls("Sheet1", "LAND_REGISTRY", "AZSEKER-EDEN", 0.92)],
      "Çıxarışların uçotu.xlsx",
    )
    expect(result.fileType).toBe("land-registry")
    expect(result.confidence).toBeCloseTo(0.92)
    expect(result.reasoning).toMatch(/land registry/)
  })

  it("classifies CAPEX-only file as capex-plan", () => {
    const result = detectFileType(
      [
        cls("CAPEX >>>", "INFO_SUMMARY"),
        cls("CAPEX_Farm", "CAPEX", "AZSEKER-EDEN"),
        cls("CAPEX_CPC", "CAPEX", "AZSEKER-CPC"),
      ],
      "CapexPlan-2026.xlsx",
    )
    expect(result.fileType).toBe("capex-plan")
    expect(result.sheetCounts.capex).toBe(2)
  })

  it("classifies file with only Təsvir-style sheet as strategic-descriptions", () => {
    const result = detectFileType(
      [cls("Təsvir", "DESCRIPTIONS")],
      "Strategy-narrative.xlsx",
    )
    expect(result.fileType).toBe("strategic-descriptions")
    expect(result.reasoning).toMatch(/description/i)
  })

  it("classifies file with only KPI sheets as kpi-only", () => {
    const result = detectFileType(
      [
        cls("Farming KPI", "KPI_FARMING"),
        cls("CPC KPI", "KPI_PROCESSING", "AZSEKER-CPC"),
      ],
      "KPI-2026.xlsx",
    )
    expect(result.fileType).toBe("kpi-only")
    expect(result.sheetCounts.kpiFarming).toBe(1)
    expect(result.sheetCounts.kpiProcessing).toBe(1)
  })

  it("classifies Farming strategy.xlsx shape (heavy SALES + INFO_SUMMARY) as forward-forecast", () => {
    const result = detectFileType(
      [
        cls("İcmal", "INFO_SUMMARY"),
        cls("PL Support", "INFO_SUMMARY"),
        cls("Sales plan", "SALES"),
        cls("Satış aylıq", "SALES"),
        cls("Taxes", "INFO_SUMMARY"),
        cls("Cost card", "INFO_SUMMARY"),
        cls("AVCO", "INFO_SUMMARY"),
      ],
      "Farming strategy - Guvven.xlsx",
    )
    expect(result.fileType).toBe("forward-forecast")
    expect(result.reasoning).toMatch(/forward[- ]?forecast/)
  })

  it("classifies a file with COMPANIES sheet and no financials as company-setup (Phase 7.M Tier 6)", () => {
    const result = detectFileType(
      [cls("Companies", "COMPANIES")],
      "Company-tree.xlsx",
    )
    expect(result.fileType).toBe("company-setup")
    expect(result.sheetCounts.companies).toBe(1)
    expect(result.reasoning).toMatch(/entity-tree setup/)
  })

  it("COMPANIES sheet mixed with PLF/BS/CF falls through to main-financial (financial intent dominates)", () => {
    const result = detectFileType(
      [
        cls("Companies", "COMPANIES"),
        cls("PLF X", "PLF", "X"),
        cls("BS X", "BS", "X"),
        cls("CF X", "CF", "X"),
      ],
      "Mixed.xlsx",
    )
    expect(result.fileType).toBe("main-financial")
    expect(result.sheetCounts.companies).toBe(1)
  })

  it("filename hint flips mis-classified PLF sheets to forward-forecast (Phase 7.M Tier 5 fix)", () => {
    // Real-world Farming strategy.xlsx case: AI per-sheet classifier
    // mis-labels İcmal/PL Support/Taxes/GDX as PLF (because of "PL" /
    // tax-style headers), but there are NO BS or CF sheets and the
    // filename says "strategy" — must classify as forward-forecast,
    // not unknown.
    const result = detectFileType(
      [
        cls("İcmal", "PLF", null),
        cls("PL Support", "PLF", null),
        cls("Taxes", "PLF", null),
        cls("GDX", "PLF", null),
        cls("Satış aylıq", "SALES"),
      ],
      "Farming strategy - Guvven.xlsx",
    )
    expect(result.fileType).toBe("forward-forecast")
    expect(result.confidence).toBeGreaterThanOrEqual(0.7)
    expect(result.reasoning).toMatch(/Filename.*forward-forecast keyword/)
  })

  it("classifies empty / all-separator file as unknown", () => {
    const result = detectFileType(
      [
        cls(">>>", "INFO_SUMMARY"),
        cls("???", "UNKNOWN", null, 0),
      ],
      "Empty.xlsx",
    )
    expect(result.fileType).toBe("unknown")
    expect(result.confidence).toBe(0)
    expect(result.reasoning).toMatch(/No content sheets/)
  })

  it("classifies completely empty classification list as unknown", () => {
    const result = detectFileType([], "Empty.xlsx")
    expect(result.fileType).toBe("unknown")
    expect(result.confidence).toBe(0)
  })

  it("main-financial wins when file has both PLF and DESCRIPTIONS sheets", () => {
    const result = detectFileType(
      [
        cls("Təsvir", "DESCRIPTIONS"),
        cls("PLF CPC", "PLF", "AZSEKER-CPC"),
        cls("BS CPC", "BS", "AZSEKER-CPC"),
      ],
      "Mixed.xlsx",
    )
    expect(result.fileType).toBe("main-financial")
  })

  it("includes filename in reasoning for unknown shapes", () => {
    const result = detectFileType(
      [cls("RandomSheet", "UNKNOWN", null, 0.3)],
      "MysteryFile.xlsx",
    )
    expect(result.fileType).toBe("unknown")
    expect(result.reasoning).toMatch(/MysteryFile\.xlsx/)
  })

  it("sheetCounts diagnostic correctly buckets across all dataTypes", () => {
    const result = detectFileType(
      [
        cls("a", "PLF", "X"),
        cls("b", "BS", "X"),
        cls("c", "CF", "X"),
        cls("d", "KPI_FARMING"),
        cls("e", "KPI_PROCESSING"),
        cls("f", "CAPEX"),
        cls("g", "SALES"),
        cls("h", "LAND_REGISTRY"),
        cls("i", "DESCRIPTIONS"),
        cls("j", "INFO_SUMMARY"),
        cls("k", "COMPANIES"),
        cls("m", "OPS_FACTS"),
        cls("n", "BUDGET_ACTUALS"),
        cls("l", "UNKNOWN"),
      ],
      "AllShapes.xlsx",
    )
    expect(result.sheetCounts).toEqual({
      plf: 1,
      bs: 1,
      cf: 1,
      kpiFarming: 1,
      kpiProcessing: 1,
      capex: 1,
      sales: 1,
      landRegistry: 1,
      descriptions: 1,
      infoSummary: 1,
      companies: 1,
      opsFacts: 1,
      budgetActuals: 1,
      unknown: 1,
    })
  })

  // ──────────────────────────────────────────────────────────────────
  // Phase 7.M Tier 7 — OPS_FACTS file-type detection
  // ──────────────────────────────────────────────────────────────────

  it("classifies file with only OPS_FACTS sheet as ops-facts (Phase 7.M Tier 7)", () => {
    const result = detectFileType(
      [cls("OperationalFacts", "OPS_FACTS")],
      "ops-facts-batch.xlsx",
    )
    expect(result.fileType).toBe("ops-facts")
    expect(result.sheetCounts.opsFacts).toBe(1)
    expect(result.reasoning).toMatch(/operational-facts file/)
  })

  it("classifies multiple OPS_FACTS sheets without financials as ops-facts", () => {
    const result = detectFileType(
      [
        cls("Q1 Facts", "OPS_FACTS"),
        cls("Q2 Facts", "OPS_FACTS"),
        cls(">>>", "INFO_SUMMARY"),
      ],
      "quarterly-ops.xlsx",
    )
    expect(result.fileType).toBe("ops-facts")
    expect(result.sheetCounts.opsFacts).toBe(2)
  })

  it("OPS_FACTS mixed with PLF/BS/CF falls through to main-financial (financial intent dominates)", () => {
    const result = detectFileType(
      [
        cls("OperationalFacts", "OPS_FACTS"),
        cls("PLF X", "PLF", "X"),
        cls("BS X", "BS", "X"),
        cls("CF X", "CF", "X"),
      ],
      "Mixed.xlsx",
    )
    expect(result.fileType).toBe("main-financial")
    expect(result.sheetCounts.opsFacts).toBe(1)
  })

  // ──────────────────────────────────────────────────────────────────
  // Phase 7.M Tier 7 (Phase 3) — BUDGET_ACTUALS file-type detection
  // ──────────────────────────────────────────────────────────────────

  it("classifies file with only BUDGET_ACTUALS sheet as budget-actuals (Phase 7.M Tier 7 Phase 3)", () => {
    const result = detectFileType(
      [cls("Actuals2026", "BUDGET_ACTUALS")],
      "march-actuals.xlsx",
    )
    expect(result.fileType).toBe("budget-actuals")
    expect(result.sheetCounts.budgetActuals).toBe(1)
    expect(result.reasoning).toMatch(/standalone actuals file/)
  })

  it("classifies multiple BUDGET_ACTUALS sheets without financials as budget-actuals", () => {
    const result = detectFileType(
      [
        cls("Q1 Actuals", "BUDGET_ACTUALS"),
        cls("Q2 Actuals", "BUDGET_ACTUALS"),
      ],
      "quarterly-actuals.xlsx",
    )
    expect(result.fileType).toBe("budget-actuals")
    expect(result.sheetCounts.budgetActuals).toBe(2)
  })

  it("BUDGET_ACTUALS mixed with PLF/BS/CF falls through to main-financial", () => {
    const result = detectFileType(
      [
        cls("Actuals", "BUDGET_ACTUALS"),
        cls("PLF X", "PLF", "X"),
        cls("BS X", "BS", "X"),
      ],
      "Mixed.xlsx",
    )
    expect(result.fileType).toBe("main-financial")
    expect(result.sheetCounts.budgetActuals).toBe(1)
  })
})
