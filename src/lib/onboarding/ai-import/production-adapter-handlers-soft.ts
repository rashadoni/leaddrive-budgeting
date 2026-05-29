/**
 * Production-adapter soft-data + ops handlers — extracted from
 * production-adapter-registry.ts (Phase 8 D1 2026-05-29). Covers the
 * structural / non-tabular sheets (Land registry, CAPEX, Təsvir
 * descriptions, İcmal forward-forecast), company bootstrapping, and the
 * operational-facts / budget-actuals / sales-forecast importers, plus the
 * noop handler for info/unknown sheets. The registry assembler wires these
 * into the AdapterRegistry shape.
 */
import type { PrismaClient, Prisma } from "@prisma/client"
import type * as XLSXType from "xlsx"
import {
  type AdapterHandler,
  type AdapterRunInput,
  type AdapterRunResult,
} from "./adapter-registry"
import { parseLandRegistrySheet } from "../adapters/azseker-land-registry"
import {
  parseCapexFarmSheetFromAoa,
  parseCapexCpcSheetFromAoa,
} from "../adapters/azseker-workbook-capex"
import { parseTesvirSheet } from "../adapters/azseker-workbook-descriptions"
import { parseIcmalSheet } from "../adapters/azseker-farming-strategy"
import {
  canonicalizeHeaders,
  normalizeRow,
  findWorkbookDuplicates,
  type NormalizedRow,
} from "../companies-import"
import { runKpiBatch, type KpiImportRow } from "../kpi-import-batch"
import { parseOperationalFactsWorkbook } from "../operational-facts-import"
import { parseBudgetActualsWorkbook } from "../budget-actuals-import"
import { runActualsBatch, type ActualsImportRow } from "../actuals-import-batch"
import { parseSalesForecastWorkbook } from "../sales-forecast-import"
import {
  runSalesForecastBatch,
  type SalesForecastRow,
} from "../sales-forecast-batch"
import { buildReconKey, type ReconciliationKey } from "../reconciliation"
import { type OrgContext } from "./prod-adapter-context"

export function makeLandRegistryHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    const ctx = ctxRef.value ?? (await ensureCtx())
    const parsed = parseLandRegistrySheet(
      input.workbook,
      input.sheetName,
      input.XLSX,
    )
    // Per Phase 7.M Azik confirm 2026-05-19: all farming under Eden Agro.
    const target = input.entityCode ?? "AZSEKER-EDEN"
    const companyId = ctx.codeToId.get(target)
    return {
      summary: `${parsed.parcels.length} land parcels · ${parsed.totalHectares.toFixed(1)} ha`,
      itemCount: parsed.parcels.length,
      warnings: parsed.warnings,
      applyToDb: async (tx: Prisma.TransactionClient) => {
        if (!companyId || parsed.parcels.length === 0) {
          return { rowsInserted: 0 }
        }
        const company = await tx.company.findUnique({
          where: { id: companyId },
          select: { settings: true },
        })
        const prev = (company?.settings ?? {}) as Record<string, unknown>
        await tx.company.update({
          where: { id: companyId },
          data: {
            settings: {
              ...prev,
              landParcels: parsed.parcels,
              landTotalHectares: parsed.totalHectares,
              landTotalAnnualRentAzn: parsed.totalAnnualRentAzn,
              landRegistrySource: `multi-import:${input.sheetName}`,
            } as unknown as Prisma.InputJsonValue,
          },
        })
        return { rowsInserted: parsed.parcels.length }
      },
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// CAPEX handler — writes Company.settings per cost-centre group
// ──────────────────────────────────────────────────────────────────────

export function makeCapexHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    const ctx = ctxRef.value ?? (await ensureCtx())
    const sheet = input.workbook.Sheets[input.sheetName]
    if (!sheet) {
      return {
        summary: `CAPEX sheet "${input.sheetName}" not in workbook`,
        itemCount: 0,
        warnings: [`Sheet "${input.sheetName}" not found`],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    const aoa = input.XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      blankrows: true,
    }) as unknown[][]
    // Both parsers share the same output shape; sheet name hints which.
    const lower = input.sheetName.toLowerCase()
    const parsed = lower.includes("farm")
      ? parseCapexFarmSheetFromAoa(aoa, input.sheetName)
      : parseCapexCpcSheetFromAoa(aoa, input.sheetName)
    // Group initiatives by target companyCode.
    const byCompany = new Map<string, typeof parsed.initiatives>()
    for (const init of parsed.initiatives) {
      let arr = byCompany.get(init.companyCode)
      if (!arr) {
        arr = []
        byCompany.set(init.companyCode, arr)
      }
      arr.push(init)
    }
    return {
      summary: `${parsed.initiatives.length} CAPEX initiatives across ${byCompany.size} companies`,
      itemCount: parsed.initiatives.length,
      warnings: parsed.warnings,
      applyToDb: async (tx: Prisma.TransactionClient) => {
        let total = 0
        for (const [code, initiatives] of byCompany) {
          const companyId = ctx.codeToId.get(code)
          if (!companyId) continue
          const company = await tx.company.findUnique({
            where: { id: companyId },
            select: { settings: true },
          })
          const prev = (company?.settings ?? {}) as Record<string, unknown>
          const prevPlans = Array.isArray(prev.capexInitiatives)
            ? (prev.capexInitiatives as unknown[])
            : []
          // Replace per-sheet entries: drop prior rows from same source
          // sheet, then append fresh.
          const filtered = prevPlans.filter((p) => {
            const o = p as { sourceSheet?: string }
            return o.sourceSheet !== input.sheetName
          })
          const merged = [...filtered, ...initiatives]
          await tx.company.update({
            where: { id: companyId },
            data: {
              settings: {
                ...prev,
                capexInitiatives: merged,
                capexLastImportSource: `multi-import:${input.sheetName}`,
              } as unknown as Prisma.InputJsonValue,
            },
          })
          total += initiatives.length
        }
        return { rowsInserted: total }
      },
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// DESCRIPTIONS handler — writes Company.settings per entity
// ──────────────────────────────────────────────────────────────────────

export function makeDescriptionsHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    const ctx = ctxRef.value ?? (await ensureCtx())
    const parsed = parseTesvirSheet(
      input.workbook,
      input.sheetName,
      input.XLSX,
    )
    return {
      summary: `${parsed.descriptions.length} entity descriptions`,
      itemCount: parsed.descriptions.length,
      warnings: parsed.warnings,
      applyToDb: async (tx: Prisma.TransactionClient) => {
        let updates = 0
        for (const d of parsed.descriptions) {
          const companyId = ctx.codeToId.get(d.companyCode)
          if (!companyId) continue
          const company = await tx.company.findUnique({
            where: { id: companyId },
            select: { settings: true },
          })
          const prev = (company?.settings ?? {}) as Record<string, unknown>
          await tx.company.update({
            where: { id: companyId },
            data: {
              settings: {
                ...prev,
                strategicDescription: d.description,
                competitiveAdvantage: d.competitiveAdvantage,
                strategicFullText: d.fullText,
                strategicSource: `multi-import:${input.sheetName}`,
              } as unknown as Prisma.InputJsonValue,
            },
          })
          updates++
        }
        return { rowsInserted: updates }
      },
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// FORWARD-FORECAST handler — writes Organization.settings
// (INFO_SUMMARY classification + forward-forecast file-type)
// ──────────────────────────────────────────────────────────────────────

export function makeForwardForecastHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    const ctx = ctxRef.value ?? (await ensureCtx())
    const parsed = parseIcmalSheet(
      input.workbook,
      input.sheetName,
      input.XLSX,
    )
    return {
      summary: `${parsed.forecast.length} forecast years`,
      itemCount: parsed.forecast.length,
      warnings: parsed.warnings,
      applyToDb: async (tx: Prisma.TransactionClient) => {
        if (parsed.forecast.length === 0) return { rowsInserted: 0 }
        const org = await tx.organization.findUnique({
          where: { id: ctx.organizationId },
          select: { settings: true },
        })
        const prev = (org?.settings ?? {}) as Record<string, unknown>
        await tx.organization.update({
          where: { id: ctx.organizationId },
          data: {
            settings: {
              ...prev,
              forwardForecast: {
                years: parsed.forecast,
                source: `multi-import:${input.sheetName}`,
              },
            } as unknown as Prisma.InputJsonValue,
          },
        })
        return { rowsInserted: parsed.forecast.length }
      },
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// COMPANIES handler — bulk upsert of org entity tree.
// Reuses `companies-import` pure helpers (canonicalize → normalize →
// dedupe) so the validation surface is identical to the legacy
// /api/onboarding/import/companies route.
// ──────────────────────────────────────────────────────────────────────

export function makeCompaniesHandler(prisma: PrismaClient): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    const sheet = input.workbook.Sheets[input.sheetName]
    if (!sheet) {
      return {
        summary: `COMPANIES sheet "${input.sheetName}" not in workbook`,
        itemCount: 0,
        warnings: [`Sheet "${input.sheetName}" not found`],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    const rawRows = input.XLSX.utils.sheet_to_json(sheet, {
      defval: null,
    }) as Record<string, unknown>[]
    const canonical = canonicalizeHeaders(rawRows)
    const normalized: NormalizedRow[] = []
    const warnings: string[] = []
    canonical.forEach((row, idx) => {
      const out = normalizeRow(row, idx)
      if ("reason" in out) {
        warnings.push(`row ${out.row}: ${out.reason}`)
      } else {
        normalized.push(out)
      }
    })
    const dupes = findWorkbookDuplicates(normalized)
    for (const d of dupes) warnings.push(`row ${d.row}: ${d.reason}`)
    const validRows = normalized.filter(
      (r) => !dupes.some((d) => d.row === normalized.indexOf(r) + 2),
    )
    return {
      summary: `${validRows.length} companies parsed (${warnings.length} row warnings)`,
      itemCount: validRows.length,
      warnings,
      applyToDb: async (tx: Prisma.TransactionClient) => {
        if (validRows.length === 0) return { rowsInserted: 0 }
        // Resolve parent codes → parentCompanyId (parents must already exist
        // or be in the same batch). Two-pass: insert level=1 first, then
        // level=2 with parent ids resolved.
        const level1 = validRows.filter((r) => r.level === 1)
        const level2 = validRows.filter((r) => r.level === 2)
        let inserted = 0
        for (const r of level1) {
          await tx.company.upsert({
            where: {
              organizationId_code: {
                organizationId: input.organizationId,
                code: r.code,
              },
            },
            create: {
              organizationId: input.organizationId,
              code: r.code,
              name: r.name,
              industryCode: r.industry,
              level: 1,
              isActive: true,
            },
            update: {
              name: r.name,
              industryCode: r.industry,
            },
          })
          inserted++
        }
        if (level2.length > 0) {
          const parentCodes = Array.from(
            new Set(level2.map((r) => r.parentCompanyCode!)),
          )
          const parents = await tx.company.findMany({
            where: {
              organizationId: input.organizationId,
              code: { in: parentCodes },
            },
            select: { id: true, code: true },
          })
          const parentByCode = new Map(parents.map((p) => [p.code, p.id]))
          for (const r of level2) {
            const parentId = parentByCode.get(r.parentCompanyCode!)
            if (!parentId) {
              warnings.push(
                `row code=${r.code}: parent ${r.parentCompanyCode} not found`,
              )
              continue
            }
            await tx.company.upsert({
              where: {
                organizationId_code: {
                  organizationId: input.organizationId,
                  code: r.code,
                },
              },
              create: {
                organizationId: input.organizationId,
                parentCompanyId: parentId,
                code: r.code,
                name: r.name,
                industryCode: r.industry,
                level: 2,
                isActive: true,
              },
              update: {
                parentCompanyId: parentId,
                name: r.name,
                industryCode: r.industry,
              },
            })
            inserted++
          }
        }
        return { rowsInserted: inserted }
      },
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// OPS_FACTS handler — generic flat operational-facts sheet
// (companyCode|metric|date|value|unit|sourceNote). Phase 7.M Tier 7
// import consolidation: same target table as KPI handlers, but a
// different shape (metric in a column vs hardcoded layout). Reuses
// parseOperationalFactsWorkbook from /api/operational-facts/import.
// ──────────────────────────────────────────────────────────────────────

export function makeOpsFactsHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    const ctx = ctxRef.value ?? (await ensureCtx())
    const sheet = input.workbook.Sheets[input.sheetName]
    if (!sheet) {
      return {
        summary: `OPS_FACTS sheet "${input.sheetName}" not in workbook`,
        itemCount: 0,
        warnings: [`Sheet "${input.sheetName}" not found`],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    // parseOperationalFactsWorkbook reads SheetNames[0]. We wrap the
    // target sheet into a single-sheet workbook so the parser sees
    // exactly the sheet AI classified as OPS_FACTS — no dependence on
    // ordering in the source xlsx.
    const wrappedWorkbook = {
      Sheets: { [input.sheetName]: sheet },
      SheetNames: [input.sheetName],
      // Phase 8 D3 — wrappedWorkbook is shape-compatible with
      // XLSX.WorkBook for the parser's needs (Sheets + SheetNames).
      // Cast to the canonical type instead of `as any`.
    } as XLSXType.WorkBook
    const parsed = parseOperationalFactsWorkbook(wrappedWorkbook, input.XLSX)
    const warnings: string[] = []
    for (const e of parsed.errors) {
      warnings.push(`row ${e.rowNumber}: ${e.reason}`)
    }
    for (const w of parsed.warnings) {
      warnings.push(`row ${w.rowNumber}: ${w.message}`)
    }
    // Resolve companyCode → companyId via cached org context.
    const rows: KpiImportRow[] = []
    const expectedSums = new Map<ReconciliationKey, number>()
    const yearFilter = String(input.year)
    for (const p of parsed.rows) {
      const companyId = ctx.codeToId.get(p.companyCode)
      if (!companyId) {
        warnings.push(
          `row ${p.rowNumber}: companyCode "${p.companyCode}" not in org`,
        )
        continue
      }
      if (!p.date.startsWith(yearFilter)) {
        warnings.push(
          `row ${p.rowNumber}: date ${p.date} outside year ${yearFilter} — skipped`,
        )
        continue
      }
      rows.push({
        companyId,
        metric: p.metric,
        date: p.date,
        value: p.value,
        unit: p.unit || null,
        source: "ai_import_ops_facts",
      })
      const key = buildReconKey(companyId, p.metric, p.date)
      expectedSums.set(key, (expectedSums.get(key) ?? 0) + p.value)
    }
    return {
      summary: `${rows.length} ops-facts rows (${warnings.length} warnings)`,
      itemCount: rows.length,
      warnings,
      applyToDb: async (tx: Prisma.TransactionClient) => {
        if (rows.length === 0) return { rowsInserted: 0 }
        // Pass tx so runKpiBatch uses the outer (multi-file) transaction
        // — atomicity with sibling sheets in the same file group.
        const result = await runKpiBatch(tx, {
          organizationId: input.organizationId,
          label: `ai-import OPS_FACTS ${input.sheetName}`,
          actorUserId: "ai-import",
          sourceDocument: `ops-facts-sheet:${input.sheetName}`,
          companyIds: Array.from(new Set(rows.map((r) => r.companyId))),
          dateScope: [yearFilter],
          rows,
          expectedSums,
        })
        return { rowsInserted: result.metrics.rowsInserted }
      },
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// BUDGET_ACTUALS handler — flat budget-actuals sheet (category|amount|
// date|department|description|lineType|companyCode). Phase 7.M Tier 7
// (Phase 3): replaces /api/budgeting/import-csv. Writes BudgetActual
// rows scoped to the active BudgetPlan resolved via shared org context.
// REPLACE semantics by (planId, year) — purges prior actuals in scope
// before bulk-inserting the new batch (matches Phase 7.M bit-perfect
// re-import pattern).
// ──────────────────────────────────────────────────────────────────────

export function makeBudgetActualsHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    const ctx = ctxRef.value ?? (await ensureCtx())
    const sheet = input.workbook.Sheets[input.sheetName]
    if (!sheet) {
      return {
        summary: `BUDGET_ACTUALS sheet "${input.sheetName}" not in workbook`,
        itemCount: 0,
        warnings: [`Sheet "${input.sheetName}" not found`],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    // Single-sheet wrap so the parser sees exactly the AI-classified sheet
    const wrappedWorkbook = {
      Sheets: { [input.sheetName]: sheet },
      SheetNames: [input.sheetName],
      // Phase 8 D3 — typed wrap matching XLSX.WorkBook.
    } as XLSXType.WorkBook
    const parsed = parseBudgetActualsWorkbook(wrappedWorkbook, input.XLSX)
    const warnings: string[] = []
    for (const e of parsed.errors) {
      warnings.push(`row ${e.rowNumber}: ${e.reason}`)
    }
    for (const w of parsed.warnings) {
      warnings.push(`row ${w.rowNumber}: ${w.message}`)
    }

    // Resolve optional companyCode → companyId via ctx; year-filter rows
    const yearFilter = String(input.year)
    const rows: ActualsImportRow[] = []
    const expectedSums = new Map<ReconciliationKey, number>()
    for (const p of parsed.rows) {
      if (!p.date.startsWith(yearFilter)) {
        warnings.push(
          `row ${p.rowNumber}: date ${p.date} outside year ${yearFilter} — skipped`,
        )
        continue
      }
      let companyId: string | null = null
      if (p.companyCode) {
        const resolved = ctx.codeToId.get(p.companyCode)
        if (!resolved) {
          warnings.push(
            `row ${p.rowNumber}: companyCode "${p.companyCode}" not in org — leaving companyId null`,
          )
        } else {
          companyId = resolved
        }
      }
      rows.push({
        category: p.category,
        amount: p.amount,
        date: p.date,
        monthIndex: p.monthIndex,
        department: p.department,
        description: p.description,
        lineType: p.lineType,
        companyId,
      })
      const key = buildReconKey(
        ctx.planId,
        p.category,
        String(p.monthIndex),
      )
      expectedSums.set(key, (expectedSums.get(key) ?? 0) + p.amount)
    }

    return {
      summary: `${rows.length} budget-actuals rows (${warnings.length} warnings)`,
      itemCount: rows.length,
      warnings,
      applyToDb: async (tx: Prisma.TransactionClient) => {
        if (rows.length === 0) return { rowsInserted: 0 }
        const result = await runActualsBatch(tx, {
          organizationId: input.organizationId,
          planId: ctx.planId,
          label: `ai-import BUDGET_ACTUALS ${input.sheetName}`,
          actorUserId: "ai-import",
          sourceDocument: `budget-actuals-sheet:${input.sheetName}`,
          dateScope: [yearFilter],
          rows,
          expectedSums,
        })
        return { rowsInserted: result.metrics.rowsInserted }
      },
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// SALES_FORECAST handler — department×month grid. Phase 7.M Tier 7
// (Phase 4): replaces /api/budgeting/sales-forecast/import. Writes
// SalesForecast rows scoped to (org, year) via upsert by
// (organizationId, departmentId, year, month) unique key. Department
// labels resolved via ctx.deptLabelToId (case-insensitive). Unknown
// labels emit warnings and skip — same convention as the legacy route.
// ──────────────────────────────────────────────────────────────────────

export function makeSalesForecastHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    const ctx = ctxRef.value ?? (await ensureCtx())
    const sheet = input.workbook.Sheets[input.sheetName]
    if (!sheet) {
      return {
        summary: `SALES_FORECAST sheet "${input.sheetName}" not in workbook`,
        itemCount: 0,
        warnings: [`Sheet "${input.sheetName}" not found`],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    const wrappedWorkbook = {
      Sheets: { [input.sheetName]: sheet },
      SheetNames: [input.sheetName],
      // Phase 8 D3 — typed wrap matching XLSX.WorkBook.
    } as XLSXType.WorkBook
    const parsed = parseSalesForecastWorkbook(wrappedWorkbook, input.XLSX)
    const warnings: string[] = []
    for (const e of parsed.errors) {
      warnings.push(`row ${e.rowNumber}: ${e.reason}`)
    }
    for (const w of parsed.warnings) {
      warnings.push(`row ${w.rowNumber}: ${w.message}`)
    }

    // Resolve departmentLabel → departmentId via ctx; skip + warn on unknown
    const rows: SalesForecastRow[] = []
    const expectedSums = new Map<ReconciliationKey, number>()
    const unknownLabels = new Set<string>()
    for (const e of parsed.entries) {
      const deptId = ctx.deptLabelToId.get(e.departmentLabel)
      if (!deptId) {
        if (!unknownLabels.has(e.departmentLabel)) {
          warnings.push(
            `row ${e.rowNumber}: department label "${e.departmentLabel}" not in org (must match a BudgetDepartment.label with hasRevenue=true)`,
          )
          unknownLabels.add(e.departmentLabel)
        }
        continue
      }
      rows.push({
        departmentId: deptId,
        month: e.month,
        amount: e.amount,
      })
      const key = buildReconKey(deptId, String(e.month), "")
      expectedSums.set(key, (expectedSums.get(key) ?? 0) + e.amount)
    }

    return {
      summary: `${rows.length} sales-forecast cells (${warnings.length} warnings)`,
      itemCount: rows.length,
      warnings,
      applyToDb: async (tx: Prisma.TransactionClient) => {
        if (rows.length === 0) return { rowsInserted: 0 }
        const result = await runSalesForecastBatch(tx, {
          organizationId: input.organizationId,
          year: input.year,
          label: `ai-import SALES_FORECAST ${input.sheetName}`,
          actorUserId: "ai-import",
          sourceDocument: `sales-forecast-sheet:${input.sheetName}`,
          rows,
          expectedSums,
        })
        return { rowsInserted: result.metrics.rowsUpserted }
      },
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// noop — for INFO_SUMMARY / UNKNOWN
// ──────────────────────────────────────────────────────────────────────

export const noopHandler: AdapterHandler = async (input) => ({
  summary: `Sheet "${input.sheetName}" classified as info/unknown — no action`,
  itemCount: 0,
  warnings: [],
  applyToDb: async () => ({ rowsInserted: 0 }),
})
