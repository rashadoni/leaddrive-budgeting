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
  parseCounterpartyRegister,
  counterpartyRoleFromSheet,
} from "./counterparty-register"
import { parseCourtDisputes, COURT_DISPUTE_METRICS } from "./court-disputes-parse"
import {
  parseAuditFindings,
  auditCompletedPct,
  AUDIT_FINDING_METRICS,
} from "./audit-findings-parse"
import { parseRiskRegister } from "./risk-register-parse"
import {
  parseIcmalBudgetLines,
  allocateIcmalBudget,
  buildIcmalMonthlyRows,
} from "../adapters/icmal-budget"
import {
  createCoACache,
  preWarmCoACache,
  resolveOrCreateAccountId,
} from "../upsert-chart-of-account"
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
import { assertNoCollateralDeletion } from "../collateral-guard"
import { type OrgContext, resolveOrgContext, logger } from "./prod-adapter-context"

export function makeLandRegistryHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    // Y5b: resolve via ensureCtx() (per-(org,year,kind) cache) — do NOT
    // short-circuit on the shared ctxRef, which holds only the
    // first-resolved kind and would mis-route later sheets of the other
    // kind (budget rows → actuals plan, or vice-versa).
    const ctx = await ensureCtx()
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
    // Y5b: resolve via ensureCtx() (per-(org,year,kind) cache) — do NOT
    // short-circuit on the shared ctxRef, which holds only the
    // first-resolved kind and would mis-route later sheets of the other
    // kind (budget rows → actuals plan, or vice-versa).
    const ctx = await ensureCtx()
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
    // Y5b: resolve via ensureCtx() (per-(org,year,kind) cache) — do NOT
    // short-circuit on the shared ctxRef, which holds only the
    // first-resolved kind and would mis-route later sheets of the other
    // kind (budget rows → actuals plan, or vice-versa).
    const ctx = await ensureCtx()
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
    // Y5b: resolve via ensureCtx() (per-(org,year,kind) cache) — do NOT
    // short-circuit on the shared ctxRef, which holds only the
    // first-resolved kind and would mis-route later sheets of the other
    // kind (budget rows → actuals plan, or vice-versa).
    const ctx = await ensureCtx()
    const parsed = parseIcmalSheet(
      input.workbook,
      input.sheetName,
      input.XLSX,
    )
    // İcmal also IS the budget: parse the import-year column into operating
    // budget lines (single source of truth: adapters/icmal-budget.ts). Empty
    // for non-İcmal INFO_SUMMARY sheets (no year-pair header / group tokens),
    // so they safely skip the budget write.
    const aoaForBudget = input.XLSX.utils.sheet_to_json(
      input.workbook.Sheets[input.sheetName],
      { header: 1 },
    ) as unknown[][]
    const budgetMonthly = buildIcmalMonthlyRows(
      allocateIcmalBudget(parseIcmalBudgetLines(aoaForBudget, input.year).lines),
    )

    return {
      summary:
        `${parsed.forecast.length} forecast years` +
        (budgetMonthly.length ? ` + İcmal budget (${budgetMonthly.length} monthly lines)` : ""),
      itemCount: parsed.forecast.length,
      warnings: parsed.warnings,
      applyToDb: async (tx: Prisma.TransactionClient) => {
        let written = 0
        // (1) forward-forecast → Organization.settings (multi-year outlook).
        if (parsed.forecast.length > 0) {
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
          written += parsed.forecast.length
        }

        // (2) İcmal year-column → kind="budget" plan as monthly BudgetLines
        // (idempotent REPLACE). Makes the 2026 budget reproducible on
        // re-import — previously a one-off script. Skips when not İcmal-shaped.
        if (budgetMonthly.length > 0) {
          const budgetCtx = await resolveOrgContext(
            tx as unknown as PrismaClient,
            ctx.organizationId,
            input.year,
            "budget",
          )
          const coaCache = createCoACache()
          preWarmCoACache(
            coaCache,
            ctx.organizationId,
            Array.from(budgetCtx.coaByCode.entries()).map(([code, id]) => ({ code, id })),
          )
          const specs = new Map<string, { name: string; accountType: string }>()
          for (const r of budgetMonthly) {
            if (!specs.has(r.coaCode)) specs.set(r.coaCode, { name: r.name, accountType: r.lineType })
          }
          const accountIdByCode = new Map<string, string>()
          for (const [code, spec] of specs) {
            accountIdByCode.set(
              code,
              await resolveOrCreateAccountId(tx, coaCache, {
                organizationId: ctx.organizationId,
                code,
                defaultName: spec.name,
                defaultAccountType: spec.accountType,
              }),
            )
          }
          // REPLACE only İcmal-origin lines — NOT user-entered budget lines.
          // The Workspace defaults to + persists manual edits on this
          // kind="budget" plan, so a blanket deleteMany({planId}) would
          // silently wipe those edits on re-import. Scope to our sourceDocument.
          //
          // 2026-06-16 derive-delete-from-write — additionally scope the
          // delete to the COMPANIES this İcmal import actually writes
          // (`footprintCompanyIds`). Without it, a partial İcmal re-import
          // (subset of companies) hard-deleted EVERY company's İcmal-budget
          // lines on the shared plan and only re-inserted the covered ones —
          // a silent cross-company wipe. Company is the right clean-slate
          // granularity (account/month changes within a company are fully
          // replaced); scoping finer would leave dropped accounts/months
          // stale. The guard below then holds by construction.
          const footprintCompanyIds = [
            ...new Set(
              budgetMonthly
                .map((r) => budgetCtx.codeToId.get(r.companyCode))
                .filter((x): x is string => !!x),
            ),
          ]
          // Footprint count — derived from the rows' companies, written
          // SEPARATELY from the delete WHERE below so a future edit that
          // broadens the delete (e.g. drops the companyId scope) diverges
          // from this count and trips the guard.
          const icmalFootprintCount =
            footprintCompanyIds.length === 0
              ? 0
              : await tx.budgetLine.count({
                  where: {
                    planId: budgetCtx.planId,
                    sourceDocument: { startsWith: "multi-import:İcmal-budget" },
                    companyId: { in: footprintCompanyIds },
                  },
                })
          const icmalDeleted = await tx.budgetLine.deleteMany({
            where: {
              planId: budgetCtx.planId,
              sourceDocument: { startsWith: "multi-import:İcmal-budget" },
              companyId: { in: footprintCompanyIds },
            },
          })
          assertNoCollateralDeletion({
            table: "BudgetLine(İcmal-budget)",
            archivedCount: icmalDeleted.count,
            footprintLiveCount: icmalFootprintCount,
            footprint: `plan=${budgetCtx.planId} companies=[${footprintCompanyIds.join(",")}]`,
          })
          let dropped = 0
          const data = budgetMonthly
            .map((r) => {
              const companyId = budgetCtx.codeToId.get(r.companyCode)
              const accountId = accountIdByCode.get(r.coaCode)
              if (!companyId || !accountId) {
                dropped++
                return null
              }
              return {
                organizationId: ctx.organizationId,
                planId: budgetCtx.planId,
                companyId,
                accountId,
                lineType: r.lineType,
                plannedAmount: r.plannedAmount,
                monthIndex: r.monthIndex,
                currencyCode: "AZN",
                isAutoPlanned: false,
                isAutoActual: false,
                sourceDocument: `multi-import:İcmal-budget#${input.sheetName}`,
              }
            })
            .filter((x): x is NonNullable<typeof x> => x !== null)
          if (dropped > 0) {
            // Surfaced, not silent — dropped budget value would otherwise vanish.
            logger.warn("İcmal budget: dropped unresolvable lines", {
              sheet: input.sheetName,
              dropped,
              unresolvedCompanies: [
                ...new Set(budgetMonthly.filter((r) => !budgetCtx.codeToId.get(r.companyCode)).map((r) => r.companyCode)),
              ],
            })
          }
          await tx.budgetLine.createMany({ data })
          written += data.length
        }
        return { rowsInserted: written }
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
    // Y5b: resolve via ensureCtx() (per-(org,year,kind) cache) — do NOT
    // short-circuit on the shared ctxRef, which holds only the
    // first-resolved kind and would mis-route later sheets of the other
    // kind (budget rows → actuals plan, or vice-versa).
    const ctx = await ensureCtx()
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
    // Y5b: resolve via ensureCtx() (per-(org,year,kind) cache) — do NOT
    // short-circuit on the shared ctxRef, which holds only the
    // first-resolved kind and would mis-route later sheets of the other
    // kind (budget rows → actuals plan, or vice-versa).
    const ctx = await ensureCtx()
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
    // Y5b: resolve via ensureCtx() (per-(org,year,kind) cache) — do NOT
    // short-circuit on the shared ctxRef, which holds only the
    // first-resolved kind and would mis-route later sheets of the other
    // kind (budget rows → actuals plan, or vice-versa).
    const ctx = await ensureCtx()
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

// ──────────────────────────────────────────────────────────────────────
// COUNTERPARTY — top customers / suppliers by turnover → `Counterparty` table.
// Feeds CUSTOMER_HHI / SUPPLIER_HHI via counterpartyHhiResolver. 2026-06-21.
// ──────────────────────────────────────────────────────────────────────

export function makeCounterpartyHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  void prisma
  void ctxRef
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    const ctx = await ensureCtx()
    const role = counterpartyRoleFromSheet(input.sheetName)
    if (!role) {
      return {
        summary: `Sheet "${input.sheetName}" — counterparty role (customer/supplier) not recognized; skipped`,
        itemCount: 0,
        warnings: [
          `Cannot derive customer/supplier role from sheet name "${input.sheetName}"`,
        ],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    const knownCodes = Array.from(ctx.codeToId.keys())
    const parsed = parseCounterpartyRegister(
      input.workbook,
      input.sheetName,
      input.XLSX,
      role,
      knownCodes,
    )
    const period = String(input.year)
    const warnings = [...parsed.warnings]
    const rows: Array<{ companyId: string; name: string; sharePct: number; annualAmount: number }> = []
    const companyIds = new Set<string>()
    for (const b of parsed.blocks) {
      if (!b.entityCode) continue
      const companyId = ctx.codeToId.get(b.entityCode)
      if (!companyId) {
        warnings.push(`Company "${b.entityCode}" not in org — block "${b.entityHeader}" skipped`)
        continue
      }
      companyIds.add(companyId)
      for (const cp of b.counterparties) {
        rows.push({ companyId, name: cp.name, sharePct: cp.sharePct, annualAmount: cp.turnover })
      }
    }

    return {
      summary: `${rows.length} ${role}(s) across ${companyIds.size} entit${companyIds.size === 1 ? "y" : "ies"} (${period})`,
      itemCount: rows.length,
      warnings,
      applyToDb: async (tx: Prisma.TransactionClient) => {
        if (rows.length === 0) return { rowsInserted: 0 }
        // Clean-slate this (role, period) snapshot for the touched companies — a
        // re-import fully replaces the top-N list so a counterparty that dropped
        // out doesn't linger and skew the HHI. Scoped to exactly the companies
        // we write + this role + this period: no sibling/other-period/other-role
        // data is touched. HARD delete (not soft) because
        // @@unique(companyId, role, name, period) would collide with a
        // re-inserted same-named row if the prior were only archived.
        await tx.counterparty.deleteMany({
          where: {
            organizationId: ctx.organizationId,
            companyId: { in: Array.from(companyIds) },
            role,
            period,
          },
        })
        await tx.counterparty.createMany({
          data: rows.map((r) => ({
            organizationId: ctx.organizationId,
            companyId: r.companyId,
            role,
            name: r.name,
            sharePct: r.sharePct,
            annualAmount: r.annualAmount,
            period,
          })),
        })
        return { rowsInserted: rows.length }
      },
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// LEGAL_CASES — court-disputes register → 5 court_disputes_* OperationalFacts
// (court_disputes_open → LEGAL_CASES_ACTIVE) + Company.settings.courtDisputes.
// Ports scripts/import-court-disputes-detailed.mjs. 2026-06-21.
// ──────────────────────────────────────────────────────────────────────

export function makeLegalCasesHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  void prisma
  void ctxRef
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    const ctx = await ensureCtx()
    const parsed = parseCourtDisputes(input.workbook, input.sheetName, input.XLSX)
    const period = String(input.year)
    const recordDate = new Date(`${period}-12-31T00:00:00.000Z`)
    const warnings = [...parsed.warnings]
    const entries = Object.entries(parsed.byCompany)
      .map(([code, agg]) => ({ code, companyId: ctx.codeToId.get(code), agg }))
      .filter((e): e is { code: string; companyId: string; agg: (typeof parsed.byCompany)[string] } => {
        if (!e.companyId) warnings.push(`Company "${e.code}" not in org — court cases skipped`)
        return Boolean(e.companyId)
      })
    const totalCases = entries.reduce((s, e) => s + e.agg.total, 0)

    return {
      summary: `${totalCases} court case(s) across ${entries.length} entit${entries.length === 1 ? "y" : "ies"} (${period})`,
      itemCount: totalCases,
      warnings,
      applyToDb: async (tx: Prisma.TransactionClient) => {
        let rows = 0
        for (const { companyId, agg } of entries) {
          // Re-import-safe: replace this year-end snapshot's facts for the metric
          // set + date (scoped to one company), then re-create.
          await tx.operationalFact.deleteMany({
            where: { companyId, metric: { in: [...COURT_DISPUTE_METRICS] }, date: recordDate },
          })
          await tx.operationalFact.createMany({
            data: [
              { metric: "court_disputes_total", value: agg.total },
              { metric: "court_disputes_open", value: agg.open },
              { metric: "court_disputes_as_defendant", value: agg.as_defendant },
              { metric: "court_disputes_as_plaintiff", value: agg.as_plaintiff },
              { metric: "court_disputes_money_claims", value: agg.money_claims },
            ].map((m) => ({
              organizationId: ctx.organizationId,
              companyId,
              metric: m.metric,
              date: recordDate,
              value: m.value,
              unit: "count",
              source: `multi-import:${input.sheetName}`,
            })),
          })
          const company = await tx.company.findUnique({ where: { id: companyId }, select: { settings: true } })
          const prev = (company?.settings ?? {}) as Record<string, unknown>
          await tx.company.update({
            where: { id: companyId },
            data: {
              settings: {
                ...prev,
                courtDisputes: {
                  source: input.sheetName,
                  importedAt: new Date().toISOString(),
                  summary: {
                    total: agg.total,
                    open: agg.open,
                    as_defendant: agg.as_defendant,
                    as_plaintiff: agg.as_plaintiff,
                    money_claims: agg.money_claims,
                  },
                  cases: agg.cases,
                },
              } as unknown as Prisma.InputJsonValue,
            },
          })
          rows += COURT_DISPUTE_METRICS.length
        }
        return { rowsInserted: rows }
      },
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// AUDIT_FINDINGS — internal-audit register → 6 audit_findings_* OperationalFacts
// (completed_pct → AUDIT_CLOSED_PCT, major_open → AUDIT_MAJOR_OPEN) +
// Company.settings.auditFindings. Ports scripts/import-audit-findings.mjs.
// ──────────────────────────────────────────────────────────────────────

export function makeAuditFindingsHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  void prisma
  void ctxRef
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    const ctx = await ensureCtx()
    const parsed = parseAuditFindings(input.workbook, input.sheetName, input.XLSX)
    const period = String(input.year)
    const recordDate = new Date(`${period}-12-31T00:00:00.000Z`)
    const warnings = [...parsed.warnings]
    const entries = Object.entries(parsed.byCompany)
      .map(([code, agg]) => ({ code, companyId: ctx.codeToId.get(code), agg }))
      .filter((e): e is { code: string; companyId: string; agg: (typeof parsed.byCompany)[string] } => {
        if (!e.companyId) warnings.push(`Company "${e.code}" not in org — audit findings skipped`)
        return Boolean(e.companyId)
      })
    const totalFindings = entries.reduce((s, e) => s + e.agg.total, 0)

    return {
      summary: `${totalFindings} audit finding(s) across ${entries.length} entit${entries.length === 1 ? "y" : "ies"} (${period})`,
      itemCount: totalFindings,
      warnings,
      applyToDb: async (tx: Prisma.TransactionClient) => {
        let rows = 0
        for (const { companyId, agg } of entries) {
          const pct = auditCompletedPct(agg)
          await tx.operationalFact.deleteMany({
            where: { companyId, metric: { in: [...AUDIT_FINDING_METRICS] }, date: recordDate },
          })
          await tx.operationalFact.createMany({
            data: [
              { metric: "audit_findings_total", value: agg.total },
              { metric: "audit_findings_completed", value: agg.completed },
              { metric: "audit_findings_major_open", value: agg.major_open },
              { metric: "audit_findings_minor_open", value: agg.minor_open },
              { metric: "audit_findings_observation_open", value: agg.observation_open },
              { metric: "audit_findings_completed_pct", value: pct },
            ].map((m) => ({
              organizationId: ctx.organizationId,
              companyId,
              metric: m.metric,
              date: recordDate,
              value: m.value,
              unit: m.metric.endsWith("_pct") ? "%" : "count",
              source: `multi-import:${input.sheetName}`,
            })),
          })
          const company = await tx.company.findUnique({ where: { id: companyId }, select: { settings: true } })
          const prev = (company?.settings ?? {}) as Record<string, unknown>
          await tx.company.update({
            where: { id: companyId },
            data: {
              settings: {
                ...prev,
                auditFindings: {
                  source: input.sheetName,
                  importedAt: new Date().toISOString(),
                  summary: {
                    total: agg.total,
                    completed: agg.completed,
                    completedPct: pct,
                    major_open: agg.major_open,
                    minor_open: agg.minor_open,
                    observation_open: agg.observation_open,
                  },
                  items: agg.findings,
                },
              } as unknown as Prisma.InputJsonValue,
            },
          })
          rows += AUDIT_FINDING_METRICS.length
        }
        return { rowsInserted: rows }
      },
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// RISK_REGISTER — enterprise KRI taxonomy → Company.settings.riskRegister.
// Greenfield: no indicator consumes it yet, so it lands the register as a
// drill-down surface (like courtDisputes/auditFindings) and writes NO facts.
// ──────────────────────────────────────────────────────────────────────

export function makeRiskRegisterHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  void prisma
  void ctxRef
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    const ctx = await ensureCtx()
    const parsed = parseRiskRegister(input.workbook, input.sheetName, input.XLSX)
    // The risk register is per-entity; the classifier resolves the entity from
    // the filename/sheet (e.g. "Top risk - EDEN AGRO" → AZSEKER-EDEN).
    const target = input.entityCode ?? "AZSEKER-EDEN"
    const companyId = ctx.codeToId.get(target)
    const warnings = [...parsed.warnings]
    if (!companyId) warnings.push(`Company "${target}" not in org — risk register skipped`)

    return {
      summary: `${parsed.risks.length} KRI risk(s) for ${target} — stored for a future KRI indicator (no consumer yet)`,
      itemCount: parsed.risks.length,
      warnings,
      applyToDb: async (tx: Prisma.TransactionClient) => {
        if (!companyId || parsed.risks.length === 0) return { rowsInserted: 0 }
        const company = await tx.company.findUnique({ where: { id: companyId }, select: { settings: true } })
        const prev = (company?.settings ?? {}) as Record<string, unknown>
        await tx.company.update({
          where: { id: companyId },
          data: {
            settings: {
              ...prev,
              riskRegister: {
                source: input.sheetName,
                importedAt: new Date().toISOString(),
                summary: { total: parsed.risks.length, byCriticality: parsed.byCriticality },
                risks: parsed.risks,
              },
            } as unknown as Prisma.InputJsonValue,
          },
        })
        return { rowsInserted: parsed.risks.length }
      },
    }
  }
}
