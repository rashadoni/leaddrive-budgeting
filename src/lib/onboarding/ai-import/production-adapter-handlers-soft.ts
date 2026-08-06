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
import { parseAssumptions } from "./assumptions-parse"
import { buildCompanyMatcher } from "./soft-entity-match"
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
    // Phase 11.26 — legacy AZSEKER default kept only when this org has it.
    // Per Phase 7.M Azik confirm 2026-05-19: all farming under Eden Agro.
    const resolved = resolveSoftSheetEntity(ctx, input.entityCode, "land registry")
    if ("blocked" in resolved) {
      return {
        summary: `Land registry: ${resolved.blocked}`,
        itemCount: 0,
        warnings: [...parsed.warnings, resolved.blocked],
        blocked: { reason: resolved.blocked },
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    const { companyId } = resolved
    return {
      summary: `${parsed.parcels.length} land parcels · ${parsed.totalHectares.toFixed(1)} ha`,
      itemCount: parsed.parcels.length,
      warnings: parsed.warnings,
      applyToDb: async (tx: Prisma.TransactionClient) => {
        if (parsed.parcels.length === 0) {
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
    // Phase 11.33 (2026-07-29) — resolve companies BEFORE reporting, and never
    // skip one silently.
    //
    // `applyToDb` did `if (!companyId) continue` with no warning, while the
    // summary above still announced "N initiatives across M companies". The
    // codes come from `resolveEntityFromCostCenter(...) ?? "AZSEKER-EDEN"`, so
    // for any org without those companies EVERY code resolves to nothing:
    // zero rows written, green summary, no signal. Same class as 11.26, in the
    // handler 11.26 did not cover.
    const unresolvedCodes = [...byCompany.keys()].filter(
      (code) => !ctx.codeToId.get(code),
    )
    const resolvedCount = byCompany.size - unresolvedCodes.length
    const capexWarnings = [...parsed.warnings]
    for (const code of unresolvedCodes) {
      capexWarnings.push(
        `CAPEX: company "${code}" is not in this organization — ` +
          `${byCompany.get(code)?.length ?? 0} initiative(s) skipped`,
      )
    }

    return {
      summary:
        `${parsed.initiatives.length} CAPEX initiatives across ${resolvedCount} ` +
        `resolvable compan${resolvedCount === 1 ? "y" : "ies"}` +
        (unresolvedCodes.length > 0
          ? ` (${unresolvedCodes.length} unresolved: ${unresolvedCodes.join(", ")})`
          : ""),
      itemCount: parsed.initiatives.length,
      warnings: capexWarnings,
      // Nothing resolvable means the whole sheet would vanish under a green
      // report — block instead.
      ...(byCompany.size > 0 && resolvedCount === 0
        ? {
            blocked: {
              reason:
                `CAPEX: none of the companies in this sheet exist in this ` +
                `organization (${unresolvedCodes.join(", ")}). Importing would ` +
                `write nothing and report success.`,
            },
          }
        : {}),
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
    const icmalBudget = parseIcmalBudgetLines(aoaForBudget, input.year)
    const budgetMonthly = buildIcmalMonthlyRows(
      allocateIcmalBudget(icmalBudget.lines),
    )

    // Phase 11.35 — the cost-sign verdict must reach the field the apply gate
    // reads. 11.9b produced the same verdict and left it in a local, so an
    // ambiguous statement imported silently with a guessed sign.
    // Phase 11.33 — the İcmal product→company routing table is AzerSheker's
    // own business configuration (which entity sells beet vs wheat), so it
    // cannot be derived. What it must not do is fail quietly: for an org
    // without those companies EVERY line drops, `rowsInserted` is 0 and the
    // only trace was a `logger.warn` the importing user never sees. Check the
    // codes BEFORE apply so the verdict reaches the report.
    const unresolvedBudgetCompanies = [
      ...new Set(
        budgetMonthly
          .map((r) => r.companyCode)
          .filter((code) => !ctx.codeToId.get(code)),
      ),
    ]
    if (budgetMonthly.length > 0 && unresolvedBudgetCompanies.length > 0) {
      const resolvable = budgetMonthly.filter((r) => ctx.codeToId.get(r.companyCode)).length
      if (resolvable === 0) {
        const reason =
          `İcmal budget: none of the ${budgetMonthly.length} budget lines resolve to a company ` +
          `in this organization (needs ${unresolvedBudgetCompanies.join(", ")}). The product→company ` +
          `routing in icmal-budget.ts is AzerSheker-specific; writing nothing and reporting success ` +
          `would hide the entire budget.`
        return {
          summary: reason,
          itemCount: 0,
          warnings: [...parsed.warnings, ...icmalBudget.signNotes],
          blocked: { reason },
          applyToDb: async () => ({ rowsInserted: 0 }),
        }
      }
      icmalBudget.signNotes.push(
        `İcmal budget: ${budgetMonthly.length - resolvable} of ${budgetMonthly.length} lines ` +
          `route to companies this organization does not have (${unresolvedBudgetCompanies.join(", ")}) ` +
          `and will be dropped.`,
      )
    }

    if (icmalBudget.signBlockedReason && budgetMonthly.length > 0) {
      return {
        summary: `İcmal budget: ${icmalBudget.signBlockedReason}`,
        itemCount: 0,
        warnings: [...parsed.warnings, ...icmalBudget.signNotes],
        blocked: { reason: icmalBudget.signBlockedReason },
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }

    return {
      summary:
        `${parsed.forecast.length} forecast years` +
        (budgetMonthly.length ? ` + İcmal budget (${budgetMonthly.length} monthly lines)` : ""),
      itemCount: parsed.forecast.length,
      warnings: [
        ...parsed.warnings,
        ...(budgetMonthly.length > 0 ? icmalBudget.signNotes : []),
      ],
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
              // 2026-07-29 — was `industryCode`, which exists NOWHERE in the
              // schema (`Company`'s scalar is `industry`, an FK on
              // Industry.code). Prisma rejects unknown arguments, so this
              // threw on the first level-1 upsert and failed the whole
              // company-setup group — which APPLY_ORDER runs FIRST, so every
              // financial file then landed against an entity tree that was
              // never created. `tsc` could not catch it: the
              // XOR<Create, UncheckedCreate> union suppresses excess-property
              // checks, and the unit test asserted only level/parentCompanyId
              // on a vi.fn() stub that accepts anything.
              industry: r.industry,
              level: 1,
              isActive: true,
            },
            update: {
              name: r.name,
              industry: r.industry,
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
                industry: r.industry,
                level: 2,
                isActive: true,
              },
              update: {
                parentCompanyId: parentId,
                name: r.name,
                industry: r.industry,
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
        return {
          rowsInserted: result.metrics.rowsInserted,
          // Phase 11.2 — surface the batch layer's post-write DB re-read.
          reconciliation: result.reconciliation,
        }
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
        return {
          rowsInserted: result.metrics.rowsInserted,
          // Phase 11.2 — surface the batch layer's post-write DB re-read.
          reconciliation: result.reconciliation,
        }
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
        return {
          rowsInserted: result.metrics.rowsUpserted,
          // Phase 11.2 — surface the batch layer's post-write DB re-read.
          reconciliation: result.reconciliation,
        }
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
        // Report the companies resolved per block so the orchestrator
        // recomputes them — a cross-entity register has no sheet entityCode.
        return {
          rowsInserted: rows.length,
          touchedCompanyCodes: [
            ...new Set(
              parsed.blocks
                .map((b) => b.entityCode)
                .filter((c): c is string => !!c),
            ),
          ],
        }
      },
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// LEGAL_CASES — court-disputes register → 5 court_disputes_* OperationalFacts
// (total/open → LEGAL_CASES_TOTAL/ACTIVE) + Company.settings.courtDisputes.
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
    // Phase 11.33 — attribute against THIS org's companies, not a literal
    // list of AzerSheker's five. A cross-entity register names the company in
    // a cell, so for any other org the hardcoded patterns matched nothing and
    // every case was dropped by a bare `continue`.
    const parsed = parseCourtDisputes(
      input.workbook,
      input.sheetName,
      input.XLSX,
      buildCompanyMatcher(ctx.orgCompanies),
    )
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
            where: {
              organizationId: ctx.organizationId,
              companyId,
              metric: {
                in: [
                  ...COURT_DISPUTE_METRICS,
                  "LEGAL_CASES_TOTAL",
                  "LEGAL_CASES_ACTIVE",
                ],
              },
              date: recordDate,
            },
          })
          await tx.operationalFact.createMany({
            data: [
              { metric: "court_disputes_total", value: agg.total },
              { metric: "court_disputes_open", value: agg.open },
              { metric: "court_disputes_as_defendant", value: agg.as_defendant },
              { metric: "court_disputes_as_plaintiff", value: agg.as_plaintiff },
              { metric: "court_disputes_money_claims", value: agg.money_claims },
              // Canonical metrics the LEGAL_CASES_TOTAL / ACTIVE indicators
              // read directly, so the import lights up both indicators with no
              // separate alias step.
              { metric: "LEGAL_CASES_TOTAL", value: agg.total },
              { metric: "LEGAL_CASES_ACTIVE", value: agg.open },
            ].map((m) => ({
              organizationId: ctx.organizationId,
              companyId,
              metric: m.metric,
              date: recordDate,
              value: m.value,
              unit: m.metric.startsWith("LEGAL_CASES_") ? "cases" : "count",
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
          rows += COURT_DISPUTE_METRICS.length + 2 // +2 canonical LEGAL_CASES_TOTAL / ACTIVE
        }
        // Report the companies resolved per row so the orchestrator
        // recomputes them — a cross-entity register has no sheet entityCode.
        return {
          rowsInserted: rows,
          touchedCompanyCodes: entries.map((e) => e.code),
        }
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
    // Phase 11.33 — see the court-disputes handler: the "Şirkət" cell is
    // resolved against this org's companies.
    const parsed = parseAuditFindings(
      input.workbook,
      input.sheetName,
      input.XLSX,
      buildCompanyMatcher(ctx.orgCompanies),
    )
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
            where: {
              organizationId: ctx.organizationId,
              companyId,
              metric: { in: [...AUDIT_FINDING_METRICS, "AUDIT_CLOSED_PCT", "AUDIT_MAJOR_OPEN"] },
              date: recordDate,
            },
          })
          await tx.operationalFact.createMany({
            data: [
              { metric: "audit_findings_total", value: agg.total },
              { metric: "audit_findings_completed", value: agg.completed },
              { metric: "audit_findings_major_open", value: agg.major_open },
              { metric: "audit_findings_minor_open", value: agg.minor_open },
              { metric: "audit_findings_observation_open", value: agg.observation_open },
              { metric: "audit_findings_completed_pct", value: pct },
              // Canonical metrics the AUDIT_CLOSED_PCT / AUDIT_MAJOR_OPEN indicators
              // read directly — so the import lights them up with no alias step.
              { metric: "AUDIT_CLOSED_PCT", value: pct },
              { metric: "AUDIT_MAJOR_OPEN", value: agg.major_open },
            ].map((m) => ({
              organizationId: ctx.organizationId,
              companyId,
              metric: m.metric,
              date: recordDate,
              value: m.value,
              unit: m.metric.endsWith("_pct") || m.metric === "AUDIT_CLOSED_PCT" ? "%" : "count",
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
          rows += AUDIT_FINDING_METRICS.length + 2 // +2 canonical AUDIT_CLOSED_PCT / AUDIT_MAJOR_OPEN
        }
        // Report the companies resolved per row so the orchestrator
        // recomputes them — a cross-entity register has no sheet entityCode.
        return {
          rowsInserted: rows,
          touchedCompanyCodes: entries.map((e) => e.code),
        }
      },
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// RISK_REGISTER — enterprise KRI taxonomy → Company.settings.riskRegister.
// Greenfield: no indicator consumes it yet, so it lands the register as a
// drill-down surface (like courtDisputes/auditFindings) and writes NO facts.
// ──────────────────────────────────────────────────────────────────────

/**
 * Phase 11.26 (2026-07-29) — resolve the entity for a per-entity SOFT sheet
 * (land registry, risk register) WITHOUT hardcoding one client's company.
 *
 * Both handlers did `input.entityCode ?? "AZSEKER-EDEN"` and then, when the
 * code resolved to nothing, silently returned `rowsInserted: 0`. For any other
 * organization that is a guaranteed no-op with a green report — the silent-drop
 * class 11.3 was opened to close, still live on these two handlers after 11.11
 * removed the same hardcode from the financial path.
 *
 * The legacy default is kept, but only when this org ACTUALLY has that company,
 * so AZSEKER's existing imports behave exactly as before. Anything else that
 * cannot be resolved BLOCKS rather than writing nothing quietly.
 */
function resolveSoftSheetEntity(
  ctx: OrgContext,
  entityCode: string | null | undefined,
  sheetKind: string,
): { companyId: string; target: string } | { blocked: string } {
  const explicit = entityCode ?? null
  if (explicit) {
    const id = ctx.codeToId.get(explicit)
    if (id) return { companyId: id, target: explicit }
    return {
      blocked:
        `${sheetKind}: entity "${explicit}" does not exist in this organization. ` +
        `Writing nothing and reporting success would hide the whole sheet.`,
    }
  }
  // No entity on the classification. Fall back to the historical AZSEKER
  // default ONLY if this org has it — never invent another tenant's company.
  const legacy = ctx.codeToId.get("AZSEKER-EDEN")
  if (legacy) return { companyId: legacy, target: "AZSEKER-EDEN" }
  return {
    blocked:
      `${sheetKind}: the classifier resolved no entity for this sheet and this ` +
      `organization has no AZSEKER-EDEN to fall back to. Name the entity in the ` +
      `sheet map, or split the register per company.`,
  }
}

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
    // Phase 11.26 — see resolveSoftSheetEntity: an unresolvable entity BLOCKS
    // instead of quietly writing nothing under a green report.
    const resolved = resolveSoftSheetEntity(ctx, input.entityCode, "risk register")
    if ("blocked" in resolved) {
      return {
        summary: `Risk register: ${resolved.blocked}`,
        itemCount: 0,
        warnings: [...parsed.warnings, resolved.blocked],
        blocked: { reason: resolved.blocked },
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    const { companyId, target } = resolved
    const warnings = [...parsed.warnings]

    return {
      summary: `${parsed.risks.length} KRI risk(s) for ${target} — stored for a future KRI indicator (no consumer yet)`,
      itemCount: parsed.risks.length,
      warnings,
      applyToDb: async (tx: Prisma.TransactionClient) => {
        if (parsed.risks.length === 0) return { rowsInserted: 0 }
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
        return {
          rowsInserted: parsed.risks.length,
          touchedCompanyCodes: [target],
        }
      },
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// ASSUMPTIONS — budget drivers → `BudgetAssumption` (Phase 16.5, 2026-08-06).
//
// Cross-entity by nature: one sheet states the holding's drivers, and any row
// naming a company becomes that company's override. So it does NOT go through
// `resolveSoftSheetEntity` — a sheet-level entity is not required and, when the
// classifier guesses one, it is used only as the default owner for rows that do
// not name a company themselves.
// ──────────────────────────────────────────────────────────────────────

export function makeAssumptionsHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  void prisma
  void ctxRef
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    const ctx = await ensureCtx()
    const parsed = parseAssumptions(
      input.workbook,
      input.sheetName,
      input.XLSX,
      buildCompanyMatcher(ctx.orgCompanies),
    )
    const warnings = [...parsed.warnings]

    // A sheet-level entity is a DEFAULT, not an override: a row that names its
    // own company always wins. When the classifier resolved no entity the rows
    // stay plan-level, which is the correct reading of a holding-wide sheet.
    const sheetCompanyId = input.entityCode ? ctx.codeToId.get(input.entityCode) : undefined
    if (input.entityCode && !sheetCompanyId) {
      warnings.push(
        `assumptions: sheet entity "${input.entityCode}" is not in this organization — ` +
          "rows that do not name their own company were imported as plan-level defaults.",
      )
    }

    const resolved = parsed.rows.map((r) => {
      const companyId = r.companyCode ? ctx.codeToId.get(r.companyCode) : sheetCompanyId
      return { row: r, companyId: companyId ?? null }
    })
    // A row whose company resolved in the parser but not in this org context is
    // dropped rather than silently promoted to a holding-wide default.
    const writable = resolved.filter((e) => {
      if (e.row.companyCode && !e.companyId) {
        warnings.push(
          `assumptions: company "${e.row.companyCode}" not resolvable in this org — "${e.row.label}" skipped.`,
        )
        return false
      }
      return true
    })

    const overrides = writable.filter((e) => e.companyId).length
    const defaults = writable.length - overrides

    return {
      summary:
        `${writable.length} assumption(s) — ${defaults} plan-level, ${overrides} company override(s)` +
        ` (plan ${ctx.planId.slice(0, 8)}…)`,
      itemCount: writable.length,
      warnings,
      applyToDb: async (tx: Prisma.TransactionClient) => {
        if (writable.length === 0) return { rowsInserted: 0 }

        // UPSERT by (planId, key, companyId) — NOT the clean-slate
        // archive-then-insert every financial adapter uses.
        //
        // Clean-slate is right for budget lines because the workbook is the
        // whole truth for its scope. It is wrong here: a driver may equally
        // have been typed on the Fərziyyələr tab by a controller, and wiping
        // every assumption in the plan because one sheet mentions three of them
        // would delete work no workbook can restore — the 2026-06-11 collateral
        // pattern, in a table with no soft-delete to recover from.
        //
        // So: this sheet owns the rows it names and nothing else.
        const existing = await tx.budgetAssumption.findMany({
          where: { organizationId: ctx.organizationId, planId: ctx.planId },
          select: { id: true, key: true, companyId: true },
        })
        const byTuple = new Map(existing.map((e) => [`${e.key}::${e.companyId ?? ""}`, e.id]))

        let inserted = 0
        let updated = 0
        for (const { row, companyId } of writable) {
          const tuple = `${row.key}::${companyId ?? ""}`
          const id = byTuple.get(tuple)
          const data = {
            category: row.category,
            key: row.key,
            label: row.label,
            value: row.value,
            unit: row.unit,
            period: row.period,
            notes: row.notes,
            companyId,
          }
          if (id) {
            await tx.budgetAssumption.update({ where: { id }, data })
            updated++
          } else {
            const created = await tx.budgetAssumption.create({
              data: { ...data, organizationId: ctx.organizationId, planId: ctx.planId },
              select: { id: true },
            })
            // Claim the tuple so a duplicate later on the SAME sheet updates
            // this row instead of inserting a second one the resolver would
            // then have to break a tie between.
            byTuple.set(tuple, created.id)
            inserted++
          }
        }

        const touched = [...new Set(writable.map((e) => e.row.companyCode).filter((c): c is string => Boolean(c)))]
        return {
          rowsInserted: inserted + updated,
          touchedCompanyCodes: touched,
        }
      },
    }
  }
}
