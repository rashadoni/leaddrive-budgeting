/**
 * Reporting-pack importer — apply path for the FO Holding monthly reporting
 * pack ("Reporting 2026.xlsx" family).
 *
 * The AI Auto Import classifier mis-routes this file's sheets (proven
 * 2026-06-20), so this is a DEDICATED importer that targets the detail
 * sheets directly:
 *
 *   Actual PLF / BS Actual / CF Actual   → "actual" plan
 *   Budget PLF / Budget CF               → "budget" plan
 *
 * Two modes:
 *   • preview — uses the PURE BU-aware parsers (parseReportingPack*). Zero
 *     DB writes, zero LLM. Returns per-entity line counts + totals.
 *   • apply   — feeds one synthetic single-entity workbook per BU to the
 *     EXISTING, audited production handlers (makePlfHandler / makeBsHandler /
 *     makeCfHandler via buildProductionAdapterRegistry), inside ONE prisma
 *     transaction. No new clean-slate / insert / reconciliation logic is
 *     written here — it is all reused from the handler chain, once per entity.
 *
 * Safety:
 *   • apply only touches an entity whose preview line count is > 0, so the
 *     handlers' paid dynamic-LLM fallback (fires on a 0-row parse) is never
 *     reached.
 *   • all writes run in a single $transaction → partial failure rolls back.
 *   • EJE eliminations + unmapped BU values are skipped (flagged in
 *     reporting-pack-detail).
 */
import type { PrismaClient } from "@prisma/client"
import type * as XLSXType from "xlsx"
import { buildProductionAdapterRegistry } from "../ai-import/production-adapter-registry"
import type {
  AdapterRegistry,
  AdapterRunResult,
} from "../ai-import/adapter-registry"
import {
  splitWorkbookByBu,
  parseReportingPackPlf,
  parseReportingPackBs,
  parseReportingPackCf,
} from "./reporting-pack-detail"

export type ReportingPackPlanKind = "actual" | "budget"
export type ReportingPackDataType = "PLF" | "BS" | "CF"

export interface DetailSheetConfig {
  sheetName: string
  dataType: ReportingPackDataType
  planKind: ReportingPackPlanKind
  /** Header label of the operating-entity column. Defaults to "BU"; the
   *  budget P&L uses a BU_1..BU_4 hierarchy whose leaf is "BU_3". */
  buHeader?: string
}

/**
 * The detail sheets this importer reads, in apply order (P&L → BS → CF).
 *
 * NOTE — "Budget CF" is deliberately EXCLUDED. `cash_flow_entries` is
 * org+year-scoped with NO plan-kind dimension (no planId/kind column), and
 * the CF handler ignores `targetPlanKind` — it writes every row under one
 * `source`/`year`/entity scope. So importing a budget CF alongside the actual
 * CF for the same year makes the budget batch's clean-slate archive the
 * actual rows (verified on the 2026-06-20 dev apply: budget ProMalt CF wiped
 * the 52 actual ProMalt CF rows). CF is actuals-only in this data model;
 * budget cash flow has no distinct home until a CF budget model exists.
 */
export const REPORTING_PACK_DETAIL_SHEETS: DetailSheetConfig[] = [
  { sheetName: "Actual PLF", dataType: "PLF", planKind: "actual" },
  { sheetName: "BS Actual", dataType: "BS", planKind: "actual" },
  { sheetName: "CF Actual", dataType: "CF", planKind: "actual" },
  { sheetName: "Budget PLF", dataType: "PLF", planKind: "budget", buHeader: "BU_3" },
]

export interface EntityImportReport {
  sheetName: string
  dataType: ReportingPackDataType
  planKind: ReportingPackPlanKind
  buCode: string
  entityCode: string | null
  skipped: boolean
  /** Leaf lines parsed for this entity on this sheet. */
  lineCount: number
  /** Σ of all amounts for the target year — a sanity figure for the report. */
  total: number
  /** Rows actually written (apply mode only). */
  rowsWritten?: number
  warnings: string[]
}

export interface ReportingPackImportResult {
  mode: "preview" | "applied"
  organizationId: string
  year: number
  reports: EntityImportReport[]
  totalLineCount: number
  totalRowsWritten: number
  /** Distinct entity codes touched (apply mode) — for downstream recompute. */
  affectedEntities: string[]
  warnings: string[]
}

export interface ReportingPackImportInput {
  workbook: XLSXType.WorkBook
  organizationId: string
  year: number
  mode: "preview" | "apply"
}

export interface ReportingPackImportDeps {
  prisma: PrismaClient
  XLSX: typeof XLSXType
  /** Override the adapter registry (tests). Default: production registry. */
  registry?: AdapterRegistry
  /** Called AFTER a successful apply with the touched entity codes — wire
   *  the indicator recompute here. No-op by default. */
  onAfterApply?: (entityCodes: string[]) => Promise<void>
}

/** Sum every monthly amount a pure-parser entity produced for the year. */
function sumEntityTotal(
  dataType: ReportingPackDataType,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lines: any[],
  year: number,
): number {
  let total = 0
  for (const line of lines) {
    if (dataType === "BS") {
      for (const [period, amount] of Object.entries(
        line.monthlyAmounts as Record<string, number>,
      )) {
        if (period.startsWith(String(year))) total += amount
      }
    } else {
      for (const v of line.perMonth as number[]) total += v
    }
  }
  return total
}

/** Build the per-entity PREVIEW report for one detail sheet (pure, no DB). */
function previewSheet(
  cfg: DetailSheetConfig,
  workbook: XLSXType.WorkBook,
  xlsx: typeof XLSXType,
  year: number,
): { reports: EntityImportReport[]; warnings: string[] } {
  if (!workbook.Sheets[cfg.sheetName]) {
    return { reports: [], warnings: [`Sheet "${cfg.sheetName}" not present — skipped`] }
  }
  const parseOpts = { preferYear: year, buHeader: cfg.buHeader }
  const parsed =
    cfg.dataType === "PLF"
      ? parseReportingPackPlf(workbook, cfg.sheetName, xlsx, parseOpts)
      : cfg.dataType === "BS"
        ? parseReportingPackBs(workbook, cfg.sheetName, xlsx, parseOpts)
        : parseReportingPackCf(workbook, cfg.sheetName, xlsx, parseOpts)

  const reports: EntityImportReport[] = parsed.entities.map((e) => ({
    sheetName: cfg.sheetName,
    dataType: cfg.dataType,
    planKind: cfg.planKind,
    buCode: e.buCode,
    entityCode: e.entityCode,
    skipped: e.skipped,
    lineCount: e.lines.length,
    total: sumEntityTotal(cfg.dataType, e.lines, year),
    warnings: [],
  }))
  return { reports, warnings: parsed.warnings }
}

/**
 * Run the reporting-pack import. `mode: "preview"` never touches the DB.
 */
export async function runReportingPackImport(
  input: ReportingPackImportInput,
  deps: ReportingPackImportDeps,
): Promise<ReportingPackImportResult> {
  const { workbook, organizationId, year } = input
  const { prisma, XLSX } = deps

  // ── Phase 1: PREVIEW (pure parsers, no DB, no LLM) ─────────────────
  const reports: EntityImportReport[] = []
  const warnings: string[] = []
  for (const cfg of REPORTING_PACK_DETAIL_SHEETS) {
    const { reports: sheetReports, warnings: w } = previewSheet(cfg, workbook, XLSX, year)
    reports.push(...sheetReports)
    warnings.push(...w)
  }
  const totalLineCount = reports.reduce((s, r) => s + (r.skipped ? 0 : r.lineCount), 0)

  if (input.mode === "preview") {
    return {
      mode: "preview",
      organizationId,
      year,
      reports,
      totalLineCount,
      totalRowsWritten: 0,
      affectedEntities: [],
      warnings,
    }
  }

  // ── Phase 2: APPLY — reuse production handlers per entity, one tx ──
  const registry = deps.registry ?? buildProductionAdapterRegistry(prisma)
  // Index preview line counts by (sheet, BU) so we only write entities that
  // actually parsed >0 rows (keeps the handlers' LLM fallback unreachable).
  const lineCountByKey = new Map<string, number>()
  for (const r of reports) lineCountByKey.set(`${r.sheetName}::${r.buCode}`, r.lineCount)

  interface Committable {
    report: EntityImportReport
    result: AdapterRunResult
  }
  const committable: Committable[] = []
  const affected = new Set<string>()

  for (const cfg of REPORTING_PACK_DETAIL_SHEETS) {
    if (!workbook.Sheets[cfg.sheetName]) continue
    const { splits, warnings: splitWarnings } = splitWorkbookByBu(
      workbook,
      cfg.sheetName,
      XLSX,
      { buHeader: cfg.buHeader },
    )
    warnings.push(...splitWarnings)
    const handler = registry.get(cfg.dataType)
    if (!handler) {
      warnings.push(`No adapter for dataType="${cfg.dataType}" (${cfg.sheetName})`)
      continue
    }
    for (const split of splits) {
      const key = `${cfg.sheetName}::${split.buCode}`
      const report = reports.find(
        (r) => r.sheetName === cfg.sheetName && r.buCode === split.buCode,
      )
      if (split.skipped || !split.entityCode) continue
      if ((lineCountByKey.get(key) ?? 0) === 0) continue // nothing to write
      const result = await handler({
        workbook: split.workbook,
        sheetName: cfg.sheetName,
        entityCode: split.entityCode,
        year,
        organizationId,
        XLSX,
        targetPlanKind: cfg.planKind,
      })
      if (report) report.warnings.push(...result.warnings)
      committable.push({ report: report!, result })
      affected.add(split.entityCode)
    }
  }

  let totalRowsWritten = 0
  await prisma.$transaction(async (tx) => {
    for (const c of committable) {
      const applied = await c.result.applyToDb(tx)
      totalRowsWritten += applied.rowsInserted
      if (c.report) c.report.rowsWritten = applied.rowsInserted
    }
  })

  const affectedEntities = Array.from(affected)
  if (deps.onAfterApply && affectedEntities.length > 0) {
    await deps.onAfterApply(affectedEntities)
  }

  return {
    mode: "applied",
    organizationId,
    year,
    reports,
    totalLineCount,
    totalRowsWritten,
    affectedEntities,
    warnings,
  }
}
