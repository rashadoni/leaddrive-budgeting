/**
 * Phase 7.M Tier 5 (2026-05-20) — file-type detector.
 *
 * Pure stateless function: takes a sheet-classifier output for a single
 * xlsx file and decides what KIND of file this is (`main-financial`,
 * `forward-forecast`, `land-registry`, `strategic-descriptions`,
 * `capex-plan`, `kpi-only`, `unknown`).
 *
 * This is the second-stage classifier — first the per-sheet classifier
 * decides individual sheet dataTypes, then THIS function aggregates
 * those dataTypes into a file-level decision used by the multi-file
 * orchestrator to:
 *   • Group files for atomic per-group commit
 *   • Choose the right parser pipeline
 *   • Decide apply order (descriptions → main → kpi → capex → land →
 *     forward-forecast per Phase 4 dependency graph)
 *
 * Decision priority (when a file's sheets straddle multiple shapes):
 *   1. main-financial wins if PLF + BS + CF exist for any entity —
 *      it's the bedrock workbook, must apply first.
 *   2. land-registry wins for files containing LAND_REGISTRY sheets
 *      AND fewer than 2 PLF/BS/CF sheets (otherwise main-financial wins).
 *   3. forward-forecast wins when INFO_SUMMARY/year-2027+ patterns
 *      dominate (no PLF/BS/CF).
 *   4. strategic-descriptions when DESCRIPTIONS sheets present without
 *      any PLF/BS/CF.
 *   5. capex-plan when CAPEX sheets dominate (no PLF/BS/CF).
 *   6. kpi-only when only KPI_FARMING / KPI_PROCESSING sheets without
 *      any PLF/BS/CF.
 *   7. unknown otherwise — file shape doesn't match any known pattern.
 */
import type { SheetClassification } from "./sheet-classifier"

export type FileType =
  | "main-financial"
  | "forward-forecast"
  | "land-registry"
  | "strategic-descriptions"
  | "capex-plan"
  | "kpi-only"
  // Phase 7.M Tier 6 — onboarding consolidation. company-setup file
  // bootstraps / updates the org's entity hierarchy. Detected by a
  // COMPANIES-classified sheet without any financial sheets.
  | "company-setup"
  // Phase 7.M Tier 7 — import consolidation. ops-facts file holds one
  // or more generic flat operational-facts sheets (companyCode|metric|
  // date|value|unit). Same target table as KPI sheets (operational_facts)
  // but a different shape — Azik KPI sheets have hardcoded metric layout;
  // OPS_FACTS sheets carry the metric name in a column. Detected by
  // OPS_FACTS-classified sheet(s) without any PLF/BS/CF.
  | "ops-facts"
  // Phase 7.M Tier 7 — import consolidation (Phase 3). budget-actuals
  // file holds one or more flat budget-actuals sheets (category|amount|
  // date|...). Writes to `budget_actuals` table (separate from BudgetLine/
  // PLF). Detected by BUDGET_ACTUALS-classified sheet(s) without PLF/BS/CF.
  | "budget-actuals"
  | "unknown"

export interface FileTypeResult {
  /** Detected file type — one of the 7 buckets. */
  fileType: FileType
  /** Confidence 0..1 — derived from sheet-level confidence weighted
   *  by dominance of matching sheets. <0.6 means manual review needed. */
  confidence: number
  /** One-line explanation citing the dominant signal. */
  reasoning: string
  /** Diagnostic: per-shape sheet counts, useful for the UI to render
   *  "2 PLF + 1 BS + 1 CF → main-financial". */
  sheetCounts: {
    plf: number
    bs: number
    cf: number
    kpiFarming: number
    kpiProcessing: number
    capex: number
    sales: number
    landRegistry: number
    descriptions: number
    infoSummary: number
    companies: number
    opsFacts: number
    budgetActuals: number
    unknown: number
  }
}

/** Compute per-shape counts from classification list. */
function bucketSheets(
  classifications: ReadonlyArray<SheetClassification>,
): FileTypeResult["sheetCounts"] {
  const counts = {
    plf: 0,
    bs: 0,
    cf: 0,
    kpiFarming: 0,
    kpiProcessing: 0,
    capex: 0,
    sales: 0,
    landRegistry: 0,
    descriptions: 0,
    infoSummary: 0,
    companies: 0,
    opsFacts: 0,
    budgetActuals: 0,
    unknown: 0,
  }
  for (const c of classifications) {
    switch (c.dataType) {
      case "PLF":
        counts.plf++
        break
      case "BS":
        counts.bs++
        break
      case "CF":
        counts.cf++
        break
      case "KPI_FARMING":
        counts.kpiFarming++
        break
      case "KPI_PROCESSING":
        counts.kpiProcessing++
        break
      case "CAPEX":
        counts.capex++
        break
      case "SALES":
        counts.sales++
        break
      case "LAND_REGISTRY":
        counts.landRegistry++
        break
      case "DESCRIPTIONS":
        counts.descriptions++
        break
      case "INFO_SUMMARY":
        counts.infoSummary++
        break
      case "COMPANIES":
        counts.companies++
        break
      case "OPS_FACTS":
        counts.opsFacts++
        break
      case "BUDGET_ACTUALS":
        counts.budgetActuals++
        break
      case "UNKNOWN":
        counts.unknown++
        break
    }
  }
  return counts
}

/** Weighted average of sheet-level confidence over sheets that are not
 *  separators. Used as the file-level confidence basis. */
function avgConfidenceOver(
  classifications: ReadonlyArray<SheetClassification>,
  predicate: (c: SheetClassification) => boolean,
): number {
  const matched = classifications.filter(predicate)
  if (matched.length === 0) return 0
  const sum = matched.reduce((s, c) => s + c.confidence, 0)
  return sum / matched.length
}

/** Filename hint — used as soft prior when sheet-shape is ambiguous.
 *
 *  Real-world: "Farming strategy - Guvven.xlsx" contains forecast sheets
 *  named "İcmal" / "PL Support" / "Taxes" etc. The per-sheet classifier
 *  often labels these as PLF (misleading), so without a filename hint
 *  we'd fail to detect forward-forecast.
 *
 *  Rules:
 *  - Strong forward-forecast keywords: "strategy" / "forecast" /
 *    "scenario" / "projection" / "icmal" — file name in any case.
 *  - Strong land-registry keywords: "çıxarış" / "cixaris" / "land".
 */
const FORWARD_FORECAST_KEYWORDS = [
  "strategy",
  "forecast",
  "scenario",
  "projection",
  "icmal",
  "i̇cmal", // Azerbaijani lowercase İ
]
const LAND_REGISTRY_KEYWORDS = ["çıxarış", "cixaris", "torpaq"]

function filenameHints(filename: string): {
  forwardForecast: boolean
  landRegistry: boolean
} {
  const norm = filename.toLowerCase()
  return {
    forwardForecast: FORWARD_FORECAST_KEYWORDS.some((k) => norm.includes(k)),
    landRegistry: LAND_REGISTRY_KEYWORDS.some((k) => norm.includes(k)),
  }
}

/**
 * Decide file type from classifications + filename hint.
 *
 * @param classifications — sheet-classifier output for ONE file
 * @param filename — original file name; used only for the reasoning
 *   string (filename is a soft hint already injected into the classifier
 *   prompt; we don't double-count it here)
 */
export function detectFileType(
  classifications: ReadonlyArray<SheetClassification>,
  filename: string,
): FileTypeResult {
  const counts = bucketSheets(classifications)
  const totalContentSheets =
    classifications.length - counts.infoSummary - counts.unknown
  const hints = filenameHints(filename)

  // Empty / all-separator file → unknown immediately.
  if (totalContentSheets === 0) {
    return {
      fileType: "unknown",
      confidence: 0,
      reasoning: `No content sheets detected in "${filename}" (only separators / unknowns)`,
      sheetCounts: counts,
    }
  }

  // Priority 0: filename strongly hints forward-forecast AND we don't
  // have a complete main-financial trio (BS+CF missing) AND the file
  // contains forecast-shape sheets (PLF / SALES / KPI / INFO_SUMMARY).
  // Real-world: "Farming strategy - Guvven.xlsx" has PLF-shaped İcmal /
  // PL Support / Taxes / GDX sheets that the per-sheet classifier
  // mis-labels as PLF. The forward-forecast filename overrides — but
  // only if there's actually forecast content. Pure DESCRIPTIONS-only
  // files with "strategy" in the name fall through to priority 4.
  const forecastShapeCount =
    counts.plf +
    counts.sales +
    counts.kpiFarming +
    counts.kpiProcessing +
    counts.infoSummary
  if (
    hints.forwardForecast &&
    (counts.bs === 0 || counts.cf === 0) &&
    forecastShapeCount >= 2
  ) {
    const conf = Math.max(
      0.7,
      avgConfidenceOver(
        classifications,
        (c) =>
          c.dataType === "PLF" ||
          c.dataType === "SALES" ||
          c.dataType === "KPI_FARMING" ||
          c.dataType === "KPI_PROCESSING" ||
          c.dataType === "INFO_SUMMARY",
      ),
    )
    return {
      fileType: "forward-forecast",
      confidence: conf,
      reasoning: `Filename "${filename}" matches forward-forecast keyword; ${forecastShapeCount} forecast-shape sheets without BS+CF trio → multi-year projection`,
      sheetCounts: counts,
    }
  }

  // Priority 0.5: company-setup — file contains a COMPANIES sheet AND
  // no financial sheets. Setup files are bootstrapping the org's entity
  // tree (e.g. for a fresh tenant) so they must NOT trip the financial
  // pipeline. If a file mixes COMPANIES with PLF/BS/CF, the financial
  // intent dominates (it's a workbook that happens to also list entities).
  if (
    counts.companies >= 1 &&
    counts.plf === 0 &&
    counts.bs === 0 &&
    counts.cf === 0
  ) {
    const conf = avgConfidenceOver(
      classifications,
      (c) => c.dataType === "COMPANIES",
    )
    return {
      fileType: "company-setup",
      confidence: conf,
      reasoning: `${counts.companies} COMPANIES sheet(s), no PLF/BS/CF → entity-tree setup file`,
      sheetCounts: counts,
    }
  }

  // Priority 1: main-financial — PLF + BS + CF for at least one entity.
  // Heuristic: ≥1 PLF AND (≥1 BS OR ≥1 CF). Single PLF without BS/CF
  // is suspicious — could be a forecasting workbook, fall through.
  if (counts.plf >= 1 && (counts.bs >= 1 || counts.cf >= 1)) {
    const conf = avgConfidenceOver(
      classifications,
      (c) => c.dataType === "PLF" || c.dataType === "BS" || c.dataType === "CF",
    )
    return {
      fileType: "main-financial",
      confidence: conf,
      reasoning: `${counts.plf} PLF + ${counts.bs} BS + ${counts.cf} CF sheets → primary financial workbook`,
      sheetCounts: counts,
    }
  }

  // Priority 2: land-registry — landRegistry sheets without PLF/BS/CF.
  if (counts.landRegistry >= 1 && counts.plf === 0 && counts.bs === 0 && counts.cf === 0) {
    const conf = avgConfidenceOver(
      classifications,
      (c) => c.dataType === "LAND_REGISTRY",
    )
    return {
      fileType: "land-registry",
      confidence: conf,
      reasoning: `${counts.landRegistry} land registry sheet(s), no PLF/BS/CF → land titles file`,
      sheetCounts: counts,
    }
  }

  // Priority 3: capex-plan — CAPEX sheets dominate without PLF/BS/CF.
  if (counts.capex >= 1 && counts.plf === 0 && counts.bs === 0 && counts.cf === 0) {
    const conf = avgConfidenceOver(
      classifications,
      (c) => c.dataType === "CAPEX",
    )
    return {
      fileType: "capex-plan",
      confidence: conf,
      reasoning: `${counts.capex} CAPEX sheet(s), no PLF/BS/CF → standalone CAPEX file`,
      sheetCounts: counts,
    }
  }

  // Priority 4: strategic-descriptions — DESCRIPTIONS only.
  if (counts.descriptions >= 1 && counts.plf === 0 && counts.bs === 0 && counts.cf === 0) {
    const conf = avgConfidenceOver(
      classifications,
      (c) => c.dataType === "DESCRIPTIONS",
    )
    return {
      fileType: "strategic-descriptions",
      confidence: conf,
      reasoning: `${counts.descriptions} description sheet(s), no PLF/BS/CF → strategic narrative file`,
      sheetCounts: counts,
    }
  }

  // Priority 5: kpi-only — KPI sheets without PLF/BS/CF.
  // Also catches forecast-shape KPI-rich files like Farming strategy
  // (which has İcmal forward forecast — classified as INFO_SUMMARY or
  // KPI_PROCESSING depending on sheet structure).
  const kpiCount = counts.kpiFarming + counts.kpiProcessing
  if (kpiCount >= 1 && counts.plf === 0 && counts.bs === 0 && counts.cf === 0) {
    const conf = avgConfidenceOver(
      classifications,
      (c) => c.dataType === "KPI_FARMING" || c.dataType === "KPI_PROCESSING",
    )
    return {
      fileType: "kpi-only",
      confidence: conf,
      reasoning: `${kpiCount} KPI sheet(s), no PLF/BS/CF → standalone KPI file`,
      sheetCounts: counts,
    }
  }

  // Priority 5.5: ops-facts — generic flat operational-facts sheet(s)
  // without PLF/BS/CF. Same target table as KPI sheets (operational_facts)
  // but different shape — companyCode|metric|date|value|unit columns.
  // Mixed with PLF/BS/CF → falls through to main-financial (financial
  // intent dominates, mirrors the COMPANIES heuristic).
  if (counts.opsFacts >= 1 && counts.plf === 0 && counts.bs === 0 && counts.cf === 0) {
    const conf = avgConfidenceOver(
      classifications,
      (c) => c.dataType === "OPS_FACTS",
    )
    return {
      fileType: "ops-facts",
      confidence: conf,
      reasoning: `${counts.opsFacts} ops-facts sheet(s), no PLF/BS/CF → standalone operational-facts file`,
      sheetCounts: counts,
    }
  }

  // Priority 5.7: budget-actuals — flat budget-actuals sheet(s) without
  // PLF/BS/CF. Writes to `budget_actuals` table. Mixed with PLF/BS/CF
  // → falls through to main-financial (PLF carries the forecast plan,
  // BUDGET_ACTUALS imports the historical actuals against that plan —
  // typically uploaded separately, so we never expect them in the same
  // workbook anyway).
  if (
    counts.budgetActuals >= 1 &&
    counts.plf === 0 &&
    counts.bs === 0 &&
    counts.cf === 0
  ) {
    const conf = avgConfidenceOver(
      classifications,
      (c) => c.dataType === "BUDGET_ACTUALS",
    )
    return {
      fileType: "budget-actuals",
      confidence: conf,
      reasoning: `${counts.budgetActuals} budget-actuals sheet(s), no PLF/BS/CF → standalone actuals file`,
      sheetCounts: counts,
    }
  }

  // Priority 6: forward-forecast — file has heavy SALES + INFO_SUMMARY
  // patterns suggesting multi-year projection (Farming strategy shape).
  // Recognised by: ≥2 SALES sheets OR ≥3 INFO_SUMMARY without PLF/BS/CF.
  if (
    counts.plf === 0 &&
    counts.bs === 0 &&
    counts.cf === 0 &&
    (counts.sales >= 2 || counts.infoSummary >= 3)
  ) {
    const conf = avgConfidenceOver(
      classifications,
      (c) => c.dataType === "SALES" || c.dataType === "INFO_SUMMARY",
    )
    return {
      fileType: "forward-forecast",
      confidence: conf,
      reasoning: `${counts.sales} sales + ${counts.infoSummary} summary sheets, no PLF/BS/CF → forward forecast file`,
      sheetCounts: counts,
    }
  }

  // Fall-through: unknown shape. Honest about not knowing.
  return {
    fileType: "unknown",
    confidence: 0,
    reasoning: `Sheet shape mix doesn't match any known file type for "${filename}" (counts: ${JSON.stringify(counts)})`,
    sheetCounts: counts,
  }
}
