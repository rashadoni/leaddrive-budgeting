/**
 * Phase 7.M Tier 4 (2026-05-19) — AI Import: AZSEKER adapter wiring.
 *
 * Bridges the AI classifier output to the existing Phase 7.M batch
 * import functions. The classifier emits one entry per sheet; this
 * module groups them by entity + dataType and calls the right Phase
 * 7.M batch function.
 *
 * Why this design:
 *   • Existing batch functions (runImportBatch, runBalanceSheetBatch,
 *     runKpiBatch, runCashFlowBatch) already handle reconciliation,
 *     soft-delete, atomic write. Don't duplicate.
 *   • AI's job is to figure out WHICH sheets go to WHICH adapter.
 *     This wrapper does the routing.
 *   • For unknown classifications, falls back to the generic AI mapper
 *     (existing runMapper) — out of scope for this iteration.
 */
import type { PrismaClient } from "@prisma/client"
import type { SheetClassification } from "./sheet-classifier"

/**
 * Group classifications by entity + sheet family — the shape needed by
 * the existing Phase 7.M ENTITIES array in import-workbook/route.ts.
 *
 * Output:
 *   { code, plSheet, bsSheet, cfSheet } per entity for which the AI
 *   classifier identified PLF/BS/CF sheets.
 */
export interface EntitySheetMap {
  code: string
  plSheet: string | null
  bsSheet: string | null
  cfSheet: string | null
  kpiFarmingSheets: string[]
  kpiProcessingSheets: string[]
  capexSheets: string[]
  salesSheets: string[]
  landSheets: string[]
  descriptionSheets: string[]
}

export function buildEntitySheetMaps(
  classifications: ReadonlyArray<SheetClassification>,
): EntitySheetMap[] {
  const byEntity = new Map<string, EntitySheetMap>()
  // Cross-entity sheets get a synthetic "_CROSS" bucket
  const crossEntity: EntitySheetMap = {
    code: "_CROSS",
    plSheet: null,
    bsSheet: null,
    cfSheet: null,
    kpiFarmingSheets: [],
    kpiProcessingSheets: [],
    capexSheets: [],
    salesSheets: [],
    landSheets: [],
    descriptionSheets: [],
  }

  function getEntity(code: string): EntitySheetMap {
    if (code === "_CROSS") return crossEntity
    let m = byEntity.get(code)
    if (!m) {
      m = {
        code,
        plSheet: null,
        bsSheet: null,
        cfSheet: null,
        kpiFarmingSheets: [],
        kpiProcessingSheets: [],
        capexSheets: [],
        salesSheets: [],
        landSheets: [],
        descriptionSheets: [],
      }
      byEntity.set(code, m)
    }
    return m
  }

  for (const c of classifications) {
    if (
      c.dataType === "INFO_SUMMARY" ||
      c.dataType === "UNKNOWN" ||
      c.confidence < 0.5
    )
      continue

    const entityKey = c.entityCode ?? "_CROSS"
    const e = getEntity(entityKey)
    switch (c.dataType) {
      case "PLF":
        if (!e.plSheet) e.plSheet = c.sheetName
        break
      case "BS":
        if (!e.bsSheet) e.bsSheet = c.sheetName
        break
      case "CF":
        if (!e.cfSheet) e.cfSheet = c.sheetName
        break
      case "KPI_FARMING":
        e.kpiFarmingSheets.push(c.sheetName)
        break
      case "KPI_PROCESSING":
        e.kpiProcessingSheets.push(c.sheetName)
        break
      case "CAPEX":
        e.capexSheets.push(c.sheetName)
        break
      case "SALES":
        e.salesSheets.push(c.sheetName)
        break
      case "LAND_REGISTRY":
        e.landSheets.push(c.sheetName)
        break
      case "DESCRIPTIONS":
        e.descriptionSheets.push(c.sheetName)
        break
    }
  }

  const all = Array.from(byEntity.values())
  if (
    crossEntity.kpiFarmingSheets.length ||
    crossEntity.capexSheets.length ||
    crossEntity.salesSheets.length ||
    crossEntity.landSheets.length ||
    crossEntity.descriptionSheets.length
  ) {
    all.push(crossEntity)
  }
  return all
}

/**
 * Resolve a list of company codes from the AI classifier output. Used
 * to look up company ids in one DB call. Includes _CROSS if present.
 */
export function resolveCompanyCodes(
  classifications: ReadonlyArray<SheetClassification>,
): string[] {
  const set = new Set<string>()
  for (const c of classifications) {
    if (c.entityCode) set.add(c.entityCode)
  }
  return Array.from(set)
}

/**
 * Look up `{ id, code }` for each company code in one DB query.
 * Returns a map for O(1) lookup downstream.
 */
export async function fetchCompanyIds(
  prisma: PrismaClient,
  organizationId: string,
  codes: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map()
  const rows = await prisma.company.findMany({
    where: {
      organizationId,
      code: { in: Array.from(codes) },
    },
    select: { id: true, code: true },
  })
  const map = new Map<string, string>()
  for (const r of rows) map.set(r.code, r.id)
  return map
}
