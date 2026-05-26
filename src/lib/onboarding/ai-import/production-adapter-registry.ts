/**
 * Phase 7.M Tier 5 (2026-05-20) — Production adapter registry.
 *
 * Wires the existing per-sheet parsers (`parsePlfPlSheet`,
 * `parseWorkbookBsSheet`, `parsePlfCfSheet`, `parseWorkbookFarmingKpiSheet`,
 * `parseWorkbookProcessingKpiSheet`, `parseFarmingSalesSheet`, etc.)
 * + the soft-data adapters (`parseLandRegistrySheet`, `parseCapexSheets`,
 * `parseTesvirSheet`, `parseIcmalSheet`) into the `AdapterRegistry` shape
 * the multi-file orchestrator iterates.
 *
 * Design
 * ──────
 * Each handler:
 *   1. Parses ONE sheet (via existing pure parser) — no DB writes
 *   2. Builds `expectedSums: Map<ReconciliationKey, number>` for
 *      cross-file conflict detection
 *   3. Returns `applyToDb(tx)` that uses the outer tx (Phase 3 Tier 5)
 *      to:
 *        • call the matching batch function (`runImportBatch` / `runBalanceSheetBatch`
 *          / `runCashFlowBatch` / `runKpiBatch`) for tabular financial data
 *        • write to `Company.settings` / `Organization.settings` for the
 *          soft-data sheets (CAPEX / Land / Descriptions / ForwardForecast)
 *
 * Context resolution (plan + companies) is cached per-org in a closure,
 * so the first handler hit performs the lookup and the rest reuse it
 * within the same multi-file orchestrator invocation.
 *
 * NOTE: Sales sheets use the KPI handler internally — sales rows go
 * into `operational_facts` per existing /api/admin/import-workbook
 * pattern (companyId+metric+date+value), not into a separate "sales"
 * table.
 */
import type { PrismaClient, Prisma } from "@prisma/client"
import {
  buildRegistryWith,
  type AdapterHandler,
  type AdapterRegistry,
  type AdapterRunInput,
  type AdapterRunResult,
} from "./adapter-registry"
import { runDynamicPlfAdapter } from "./dynamic-plf-adapter"
import { runDynamicBsAdapter } from "./dynamic-bs-adapter"
import { runDynamicCfAdapter } from "./dynamic-cf-adapter"
import {
  parsePlfPlSheet,
  parsePlfCfSheet,
} from "../adapters/azseker-plf"
import { parseWorkbookBsSheet } from "../adapters/azseker-workbook-bs"
import {
  parseWorkbookFarmingKpiSheet,
  parseWorkbookProcessingKpiSheet,
} from "../adapters/azseker-workbook-kpi"
import {
  parseFarmingSalesSheet,
  parseProductionSalesSheet,
  parseProMaltSalesSheet,
} from "../adapters/azseker-workbook-sales"
import { parseLandRegistrySheet } from "../adapters/azseker-land-registry"
import {
  parseCapexFarmSheetFromAoa,
  parseCapexCpcSheetFromAoa,
} from "../adapters/azseker-workbook-capex"
import { parseTesvirSheet } from "../adapters/azseker-workbook-descriptions"
import {
  parseIcmalSheet,
  parseSalesPlanSheet,
} from "../adapters/azseker-farming-strategy"
import {
  canonicalizeHeaders,
  normalizeRow,
  findWorkbookDuplicates,
  type NormalizedRow,
} from "../companies-import"
import {
  runImportBatch,
  type ImportBatchRow,
} from "../import-batch"
import {
  runBalanceSheetBatch,
  type BsImportRow,
} from "../bs-import-batch"
import {
  runCashFlowBatch,
  type CfImportRow,
} from "../cf-import-batch"
import {
  runKpiBatch,
  type KpiImportRow,
} from "../kpi-import-batch"
import { parseOperationalFactsWorkbook } from "../operational-facts-import"
import { parseBudgetActualsWorkbook } from "../budget-actuals-import"
import {
  runActualsBatch,
  type ActualsImportRow,
} from "../actuals-import-batch"
import { parseSalesForecastWorkbook } from "../sales-forecast-import"
import {
  runSalesForecastBatch,
  type SalesForecastRow,
} from "../sales-forecast-batch"
import {
  buildReconKey,
  type ReconciliationKey,
} from "../reconciliation"
import {
  createCoACache,
  preWarmCoACache,
  resolveOrCreateAccountId,
} from "../upsert-chart-of-account"

const CF_SOURCE_TAG = "azseker-workbook-cf"
const DEFAULT_PLAN_NAME = "Azərşəkər 2026 Budget"

/** Per-orchestrator-call context — resolved lazily on first use. */
interface OrgContext {
  organizationId: string
  year: number
  /** Map: AZSEKER-* code → companyId. */
  codeToId: Map<string, string>
  /** Resolved BudgetPlan id for this org+year. */
  planId: string
  /** Cached AZSEKER-* company id list for sales-target resolution. */
  azsekerCompanies: Array<{ id: string; code: string }>
  // Phase 7.M Tier 7 (Phase 4) — revenue-generating BudgetDepartments for
  // SALES_FORECAST handler. Lower-cased label → id map matches the
  // /api/budgeting/sales-forecast/import resolution shape.
  deptLabelToId: Map<string, string>
  /** Map: ChartOfAccount.code → ChartOfAccount.id. Used by PLF/BS/CF
   *  handlers to populate accountId on every imported row so P&L
   *  classification is exact (no regex heuristics needed). */
  coaByCode: Map<string, string>
}

/**
 * Build (and cache via closure) the per-org context. Re-uses the
 * existing BudgetPlan or creates a new "Azərşəkər YYYY Budget" one.
 *
 * Note: this writes (BudgetPlan upsert) — but it's idempotent and
 * happens OUTSIDE the per-group tx. If the orchestrator later rolls
 * back the group, the plan row still exists (just empty), which is
 * harmless: the next run reuses it.
 */
async function resolveOrgContext(
  prisma: PrismaClient,
  organizationId: string,
  year: number,
): Promise<OrgContext> {
  const azsekerCompanies = await prisma.company.findMany({
    where: { organizationId, code: { startsWith: "AZSEKER" } },
    select: { id: true, code: true },
  })
  const codeToId = new Map<string, string>(
    azsekerCompanies.map((c: { id: string; code: string }) => [c.code, c.id]),
  )
  let plan = await prisma.budgetPlan.findFirst({
    where: {
      organizationId,
      year,
      name: DEFAULT_PLAN_NAME,
      deletedAt: null,
    },
    select: { id: true },
  })
  if (!plan) {
    plan = await prisma.budgetPlan.create({
      data: {
        organizationId,
        year,
        name: DEFAULT_PLAN_NAME,
        periodType: "annual",
        status: "draft",
      },
      select: { id: true },
    })
  }
  // Phase 7.M Tier 7 (Phase 4) — load revenue-generating departments for
  // SALES_FORECAST handler. Same filter as /api/budgeting/sales-forecast/import.
  const departments = await prisma.budgetDepartment.findMany({
    where: { organizationId, hasRevenue: true, isActive: true },
    select: { id: true, label: true },
    orderBy: { sortOrder: "asc" },
  })
  const deptLabelToId = new Map<string, string>(
    departments.map((d: { id: string; label: string }) => [
      d.label.trim().toLowerCase(),
      d.id,
    ]),
  )

  const coaEntries = await prisma.chartOfAccount.findMany({
    where: { organizationId },
    select: { id: true, code: true },
  })
  const coaByCode = new Map<string, string>(
    coaEntries.map((a: { id: string; code: string }) => [a.code, a.id]),
  )

  return {
    organizationId,
    year,
    codeToId,
    planId: plan.id,
    azsekerCompanies,
    deptLabelToId,
    coaByCode,
  }
}

/** Convenience: month-period scope for batch functions. */
function buildPeriodScope(year: number): string[] {
  return Array.from(
    { length: 12 },
    (_, m) => `${year}-${String(m + 1).padStart(2, "0")}`,
  )
}

// ──────────────────────────────────────────────────────────────────────
// PLF (P&L) handler
// ──────────────────────────────────────────────────────────────────────

function makePlfHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    if (!input.entityCode) {
      // Multi-file mode: forward-forecast / strategic files often have
      // PLF-shaped sheets without an entity (e.g. cross-entity İcmal,
      // GDX summaries). Skip gracefully — orchestrator records this in
      // perFile warnings without killing the sheet pipeline.
      return {
        summary: `PLF sheet "${input.sheetName}" has no entityCode — skipped (cross-entity forecast / summary)`,
        itemCount: 0,
        warnings: [
          `Sheet "${input.sheetName}" classified PLF but has no entityCode — likely cross-entity / forecast sheet`,
        ],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    const ctx = ctxRef.value ?? (await ensureCtx())
    const parsed = parsePlfPlSheet(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input.workbook as any,
      input.sheetName,
      input.XLSX,
      { preferYear: input.year },
    )
    const companyId = ctx.codeToId.get(input.entityCode)
    if (!companyId) {
      // Missing company is recoverable too — log + skip.
      return {
        summary: `PLF sheet "${input.sheetName}": company ${input.entityCode} not in DB — skipped`,
        itemCount: 0,
        warnings: [
          `Company "${input.entityCode}" not found in DB for sheet "${input.sheetName}"`,
        ],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    const rows: ImportBatchRow[] = []
    const expectedSums = new Map<ReconciliationKey, number>()
    // Phase 2.1 session 1 (2026-05-26) — per-(line.code) metadata so the
    // applyToDb pass can auto-upsert the ChartOfAccount row before
    // attaching accountId to each BudgetLine. Account codes are org-
    // wide, not entity-scoped: same `PLF.10.10.1` from AZSF and CPC
    // resolves to the same CoA row.
    const accountSpecs = new Map<
      string,
      { code: string; name: string; accountType: string }
    >()
    for (const line of parsed.lines) {
      if (!accountSpecs.has(line.code)) {
        accountSpecs.set(line.code, {
          code: line.code,
          name: line.label ?? line.code,
          accountType: line.accountType,
        })
      }
      for (let m = 0; m < 12; m++) {
        const amount = line.perMonth[m]
        if (amount === 0) continue
        const period = `${input.year}-${String(m + 1).padStart(2, "0")}`
        rows.push({
          companyId,
          // Phase 2.1 session 3: recon key middle is the raw line.code
          // (CoA codes are org-wide; entity is the key's first arg).
          category: line.code,
          lineType: line.accountType,
          period,
          monthIndex: m,
          plannedAmount: amount,
          currencyCode: "AZN",
          exchangeRate: null,
          planId: ctx.planId,
          // Placeholder — overwritten in applyToDb via resolveOrCreateAccountId.
          accountId: "",
          sourceCell: `multi-import#${input.sheetName}!${line.code}@${period}`,
        })
        const key = buildReconKey(input.entityCode, line.code, period)
        expectedSums.set(key, (expectedSums.get(key) ?? 0) + amount)
      }
    }
    // ── Dynamic fallback: hard-coded parser returned 0 rows on a non-empty sheet ──
    // Triggers when the sheet uses a layout the AZSEKER adapter doesn't recognise
    // (different column positions, different year placement, non-serial date headers).
    // One Claude call detects the structure; result cached 24h in AIMapperProposalCache.
    if (rows.length === 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sheet = (input.workbook as any).Sheets[input.sheetName]
      const hasData = sheet != null && Object.keys(sheet).length > 1 // >1: !ref alone = empty
      if (hasData) {
        console.log(
          `[prod-adapter] PLF "${input.sheetName}" (${input.entityCode}): format unknown — delegating to dynamic structure detection`,
        )
        return runDynamicPlfAdapter(input, ctx.planId, companyId, prisma)
      }
    }

    return {
      summary: `${parsed.lines.length} PLF lines for ${input.entityCode}`,
      itemCount: rows.length,
      warnings: parsed.warnings.map((w) => `row ${w.row}: ${w.reason}`),
      // Phase 7.M Tier 5 — `expectedSums` is read by orchestrator for
      // cross-file conflict detection (not declared on the public
      // AdapterRunResult shape, but the orchestrator looks for it).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(rows.length > 0 ? { expectedSums } : ({} as any)),
      applyToDb: async (tx: Prisma.TransactionClient) => {
        if (rows.length === 0) return { rowsInserted: 0 }
        // Resolve (or create) one CoA row per unique line.code, then
        // stamp the resolved id on every BudgetLine. Cache is pre-warmed
        // from ctx.coaByCode so existing rows hit O(1).
        const coaCache = createCoACache()
        preWarmCoACache(
          coaCache,
          ctx.organizationId,
          Array.from(ctx.coaByCode.entries()).map(([code, id]) => ({
            code,
            id,
          })),
        )
        const accountIdByLineCode = new Map<string, string>()
        for (const spec of accountSpecs.values()) {
          const id = await resolveOrCreateAccountId(tx, coaCache, {
            organizationId: ctx.organizationId,
            code: spec.code,
            defaultName: spec.name,
            defaultAccountType: spec.accountType,
          })
          accountIdByLineCode.set(spec.code, id)
        }
        // `input.entityCode` is narrowed to non-null above (line 222
        // early-returns when null). Pin to a local for the closure so
        // TS doesn't lose the narrowing across the awaited upsert.
        const entityCode = input.entityCode ?? ""
        const resolvedRows: ImportBatchRow[] = rows.map((r) => {
          // Phase 2.1 session 3: row.category IS the raw line.code (no
          // entity prefix anymore — see row.push above).
          const accountId = accountIdByLineCode.get(r.category)
          if (!accountId) {
            throw new Error(
              `[PLF] accountId not resolved for lineCode="${r.category}" — upsert pass missed it`,
            )
          }
          return { ...r, accountId }
        })
        const result = await runImportBatch(tx, {
          organizationId: ctx.organizationId,
          label: `WB P&L ${input.entityCode} ${input.year}`,
          actorUserId: "ai-multi-import",
          sourceDocument: `multi-import:${input.sheetName}`,
          companyIds: [companyId],
          periodScope: buildPeriodScope(input.year),
          rows: resolvedRows,
          expectedSums,
        })
        return { rowsInserted: result.metrics.rowsInserted }
      },
    } as AdapterRunResult & { expectedSums?: Map<ReconciliationKey, number> }
  }
}

// ──────────────────────────────────────────────────────────────────────
// BS (Balance Sheet) handler
// ──────────────────────────────────────────────────────────────────────

function makeBsHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    if (!input.entityCode) {
      return {
        summary: `BS sheet "${input.sheetName}" has no entityCode — skipped`,
        itemCount: 0,
        warnings: [
          `Sheet "${input.sheetName}" classified BS but has no entityCode — likely cross-entity sheet`,
        ],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    const ctx = ctxRef.value ?? (await ensureCtx())
    const parsed = parseWorkbookBsSheet(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input.workbook as any,
      input.sheetName,
      input.XLSX,
      { preferYear: input.year },
    )
    const companyId = ctx.codeToId.get(input.entityCode)
    const rows: BsImportRow[] = []
    const expectedSums = new Map<ReconciliationKey, number>()
    // Phase 2.1 session 1 — per-line metadata so applyToDb can upsert
    // CoA rows once per unique line.code (BS codes share across entities,
    // so use raw code as the CoA key — org-wide).
    const accountSpecs = new Map<
      string,
      { code: string; name: string; accountType: string }
    >()
    for (const line of parsed.lines) {
      if (!accountSpecs.has(line.code)) {
        accountSpecs.set(line.code, {
          code: line.code,
          name: line.label,
          // BS line types map to ChartOfAccount.accountType verbatim
          // (asset|liability|equity are all valid).
          accountType: line.lineType,
        })
      }
      for (const [period, amount] of Object.entries(line.monthlyAmounts)) {
        if (amount === 0) continue
        if (!period.startsWith(String(input.year))) continue
        const month = Number(period.split("-")[1])
        if (!Number.isFinite(month)) continue
        rows.push({
          planId: ctx.planId,
          companyId: companyId ?? null, // Phase 7.O — company scope for resolver queries
          accountCode: `${input.entityCode}-${line.code}`,
          // Placeholder — overwritten in applyToDb resolution map.
          accountId: "",
          lineType: line.lineType,
          subType: line.subType,
          year: input.year,
          month,
          amount,
          sourceCell: `multi-import#${input.sheetName}!${line.code}@${period}`,
        })
        const key = buildReconKey(
          ctx.planId,
          `${input.entityCode}-${line.code}`,
          period,
        )
        expectedSums.set(key, (expectedSums.get(key) ?? 0) + amount)
      }
    }
    // ── Dynamic fallback: AZSEKER BS parser returned 0 lines on non-empty sheet ──
    if (rows.length === 0) {
      const sheet = input.workbook.Sheets[input.sheetName]
      const hasData = sheet && Object.keys(sheet).length > 1
      if (hasData) {
        console.log(
          `[prod-adapter] BS "${input.sheetName}" (${input.entityCode}): format unknown — delegating to dynamic structure detection`,
        )
        return runDynamicBsAdapter(input, ctx.planId, prisma, companyId ?? null)
      }
    }

    return {
      summary: `${parsed.lines.length} BS lines for ${input.entityCode}`,
      itemCount: rows.length,
      warnings: parsed.warnings.map((w) => `row ${w.row}: ${w.reason}`),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(rows.length > 0 ? { expectedSums } : ({} as any)),
      applyToDb: async (tx: Prisma.TransactionClient) => {
        if (rows.length === 0) return { rowsInserted: 0 }
        // Resolve CoA FK for every unique BS line code.
        const coaCache = createCoACache()
        preWarmCoACache(
          coaCache,
          ctx.organizationId,
          Array.from(ctx.coaByCode.entries()).map(([code, id]) => ({
            code,
            id,
          })),
        )
        const accountIdByLineCode = new Map<string, string>()
        for (const spec of accountSpecs.values()) {
          const id = await resolveOrCreateAccountId(tx, coaCache, {
            organizationId: ctx.organizationId,
            code: spec.code,
            defaultName: spec.name,
            defaultAccountType: spec.accountType,
          })
          accountIdByLineCode.set(spec.code, id)
        }
        const entityCode = input.entityCode ?? ""
        const resolvedRows: BsImportRow[] = rows.map((r) => {
          // Recover line.code from the entity-prefixed accountCode
          // (BS rows use `${entity}-${code}` for accountCode display).
          const lineCode = r.accountCode.startsWith(`${entityCode}-`)
            ? r.accountCode.slice(entityCode.length + 1)
            : r.accountCode
          const accountId = accountIdByLineCode.get(lineCode)
          if (!accountId) {
            throw new Error(
              `[BS] accountId not resolved for lineCode="${lineCode}"`,
            )
          }
          return { ...r, accountId }
        })
        const result = await runBalanceSheetBatch(tx, {
          organizationId: ctx.organizationId,
          label: `WB BS ${input.entityCode} ${input.year}`,
          actorUserId: "ai-multi-import",
          sourceDocument: `multi-import:${input.sheetName}`,
          planIds: [ctx.planId],
          periodScope: buildPeriodScope(input.year),
          rows: resolvedRows,
          expectedSums,
        })
        return { rowsInserted: result.metrics.rowsInserted }
      },
    } as AdapterRunResult & { expectedSums?: Map<ReconciliationKey, number> }
  }
}

// ──────────────────────────────────────────────────────────────────────
// CF (Cash Flow) handler
// ──────────────────────────────────────────────────────────────────────

function makeCfHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    if (!input.entityCode) {
      return {
        summary: `CF sheet "${input.sheetName}" has no entityCode — skipped`,
        itemCount: 0,
        warnings: [
          `Sheet "${input.sheetName}" classified CF but has no entityCode — likely cross-entity sheet`,
        ],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    const ctx = ctxRef.value ?? (await ensureCtx())
    const parsed = parsePlfCfSheet(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input.workbook as any,
      input.sheetName,
      input.XLSX,
      { preferYear: input.year },
    )
    const rows: CfImportRow[] = []
    const expectedSums = new Map<ReconciliationKey, number>()
    // Phase 2.1 session 1 — per-entry metadata for CoA upsert in
    // applyToDb. CF codes (CF.XX.XX) are org-wide; CashFlowEntry rows
    // don't carry asset/liability semantics in the same way as BS, so
    // CoA accountType defaults to "expense" for outflows and "revenue"
    // for inflows (admin can reclassify later).
    const accountSpecs = new Map<
      string,
      { code: string; name: string; accountType: string }
    >()
    for (const entry of parsed.entries) {
      if (!accountSpecs.has(entry.code)) {
        accountSpecs.set(entry.code, {
          code: entry.code,
          name: entry.label,
          accountType: entry.entryType === "inflow" ? "revenue" : "expense",
        })
      }
      for (let m = 0; m < 12; m++) {
        const amount = entry.perMonth[m]
        if (amount === 0) continue
        const period = `${input.year}-${String(m + 1).padStart(2, "0")}`
        const sourceId = `${input.entityCode}::${entry.code}`
        rows.push({
          entityCode: input.entityCode,
          cfCode: entry.code,
          category: `${input.entityCode}-${entry.code}`,
          // Placeholder — overwritten in applyToDb resolution map.
          accountId: "",
          activityType: entry.activityType,
          entryType: entry.entryType,
          year: input.year,
          month: m + 1,
          amount,
          currencyCode: "AZN",
          description: entry.label,
          source: CF_SOURCE_TAG,
          sourceId,
        })
        const key = buildReconKey(CF_SOURCE_TAG, sourceId, period)
        expectedSums.set(key, (expectedSums.get(key) ?? 0) + amount)
      }
    }
    // ── Dynamic fallback: AZSEKER CF parser returned 0 entries on non-empty sheet ──
    if (rows.length === 0) {
      const sheet = input.workbook.Sheets[input.sheetName]
      const hasData = sheet && Object.keys(sheet).length > 1
      if (hasData) {
        console.log(
          `[prod-adapter] CF "${input.sheetName}" (${input.entityCode}): format unknown — delegating to dynamic structure detection`,
        )
        return runDynamicCfAdapter(input, prisma)
      }
    }

    return {
      summary: `${parsed.entries.length} CF entries for ${input.entityCode}`,
      itemCount: rows.length,
      warnings: parsed.warnings.map((w) => `row ${w.row}: ${w.reason}`),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(rows.length > 0 ? { expectedSums } : ({} as any)),
      applyToDb: async (tx: Prisma.TransactionClient) => {
        if (rows.length === 0) return { rowsInserted: 0 }
        const coaCache = createCoACache()
        preWarmCoACache(
          coaCache,
          ctx.organizationId,
          Array.from(ctx.coaByCode.entries()).map(([code, id]) => ({
            code,
            id,
          })),
        )
        const accountIdByCfCode = new Map<string, string>()
        for (const spec of accountSpecs.values()) {
          const id = await resolveOrCreateAccountId(tx, coaCache, {
            organizationId: ctx.organizationId,
            code: spec.code,
            defaultName: spec.name,
            defaultAccountType: spec.accountType,
          })
          accountIdByCfCode.set(spec.code, id)
        }
        const resolvedRows: CfImportRow[] = rows.map((r) => {
          const accountId = accountIdByCfCode.get(r.cfCode)
          if (!accountId) {
            throw new Error(
              `[CF] accountId not resolved for cfCode="${r.cfCode}"`,
            )
          }
          return { ...r, accountId }
        })
        const result = await runCashFlowBatch(tx, {
          organizationId: ctx.organizationId,
          label: `WB CF ${input.entityCode} ${input.year}`,
          actorUserId: "ai-multi-import",
          sourceDocument: `multi-import:${input.sheetName}`,
          sourceTag: CF_SOURCE_TAG,
          periodScope: buildPeriodScope(input.year),
          rows: resolvedRows,
          expectedSums,
        })
        return { rowsInserted: result.metrics.rowsInserted }
      },
    } as AdapterRunResult & { expectedSums?: Map<ReconciliationKey, number> }
  }
}

// ──────────────────────────────────────────────────────────────────────
// KPI handler — covers KPI_FARMING / KPI_PROCESSING / SALES
// ──────────────────────────────────────────────────────────────────────

function makeKpiHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
  kind: "farming" | "processing" | "sales",
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    const ctx = ctxRef.value ?? (await ensureCtx())
    const rows: KpiImportRow[] = []
    const expectedSums = new Map<ReconciliationKey, number>()
    const warnings: string[] = []

    if (kind === "farming") {
      const parsed = parseWorkbookFarmingKpiSheet(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input.workbook as any,
        input.sheetName,
        input.XLSX,
        { preferYear: input.year },
      )
      warnings.push(...parsed.warnings.map((w) => `row ${w.row}: ${w.reason}`))
      for (const fact of parsed.facts) {
        const companyId = ctx.codeToId.get(fact.companyCode)
        if (!companyId) continue
        if (!fact.date.startsWith(String(input.year))) continue
        rows.push({
          companyId,
          metric: fact.metric,
          date: fact.date,
          value: fact.value,
          unit: fact.unit || null,
          source: "xlsx_multi_import",
        })
        const key = buildReconKey(companyId, fact.metric, fact.date)
        expectedSums.set(key, (expectedSums.get(key) ?? 0) + fact.value)
      }
    } else if (kind === "processing") {
      const parsed = parseWorkbookProcessingKpiSheet(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input.workbook as any,
        input.sheetName,
        input.XLSX,
        { preferYear: input.year },
      )
      warnings.push(...parsed.warnings.map((w) => `row ${w.row}: ${w.reason}`))
      for (const fact of parsed.facts) {
        const companyId = ctx.codeToId.get(fact.companyCode)
        if (!companyId) continue
        if (!fact.date.startsWith(String(input.year))) continue
        rows.push({
          companyId,
          metric: fact.metric,
          date: fact.date,
          value: fact.value,
          unit: fact.unit || null,
          source: "xlsx_multi_import",
        })
        const key = buildReconKey(companyId, fact.metric, fact.date)
        expectedSums.set(key, (expectedSums.get(key) ?? 0) + fact.value)
      }
    } else if (kind === "sales") {
      // Sales sheet routing follows Azik's confirm 2026-05-19:
      //   Farming sales → AZSEKER-EDEN
      //   Production sales → AZSEKER-CPC
      //   ProMalt sales → AZSEKER-PROMALT
      //   "Sales plan" (forward-forecast per-product volumes 2027-2035)
      //                → AZSEKER-CPC, metric=sales_volume_<slug>,
      //                  date=`<year>-12-31` (Phase 7.M Tier 6)
      // We detect which sales parser to invoke based on sheet name.
      const sheetLower = input.sheetName.toLowerCase()
      const edenId = ctx.codeToId.get("AZSEKER-EDEN")
      const cpcId = ctx.codeToId.get("AZSEKER-CPC")
      const promaltId = ctx.codeToId.get("AZSEKER-PROMALT")

      // Phase 7.M Tier 6 — "Sales plan" sheet from Farming strategy.xlsx.
      // Branched FIRST so it doesn't fall through to the generic
      // production-sales parser (which would mis-parse the year-column
      // layout).
      if (sheetLower === "sales plan" || sheetLower.startsWith("sales plan")) {
        if (!cpcId) {
          warnings.push(
            `Sales plan sheet "${input.sheetName}": AZSEKER-CPC not in DB — skipped`,
          )
        } else {
          const salesPlan = parseSalesPlanSheet(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            input.workbook as any,
            input.sheetName,
            input.XLSX,
          )
          warnings.push(...salesPlan.warnings)
          for (const fact of salesPlan.facts) {
            const metric = `sales_volume_${fact.productSlug}${
              fact.location ? `_${fact.location.toLowerCase()}` : ""
            }`
            const date = `${fact.year}-12-31`
            rows.push({
              companyId: cpcId,
              metric,
              date,
              value: fact.volumeTons,
              unit: "tons",
              source: "xlsx_multi_import",
            })
            const key = buildReconKey(cpcId, metric, date)
            expectedSums.set(
              key,
              (expectedSums.get(key) ?? 0) + fact.volumeTons,
            )
          }
        }
        // Skip the rest of the sales routing — Sales plan is its own
        // shape; no other parser should run on the same sheet.
        return {
          summary: `${rows.length} sales-plan product-year facts`,
          itemCount: rows.length,
          warnings,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(rows.length > 0 ? { expectedSums } : ({} as any)),
          applyToDb: async (tx: Prisma.TransactionClient) => {
            if (rows.length === 0) return { rowsInserted: 0 }
            const touchedCompanyIds = Array.from(
              new Set(rows.map((r) => r.companyId)),
            )
            // dateScope spans every year present in the rows so the
            // reset filter doesn't accidentally clobber unrelated
            // sales_volume_* rows from prior imports.
            const years = Array.from(
              new Set(rows.map((r) => r.date.slice(0, 4))),
            )
            const result = await runKpiBatch(tx, {
              organizationId: ctx.organizationId,
              label: `WB Sales plan ${input.sheetName}`,
              actorUserId: "ai-multi-import",
              sourceDocument: `multi-import:${input.sheetName}`,
              companyIds: touchedCompanyIds,
              dateScope: years,
              rows,
              expectedSums,
            })
            return { rowsInserted: result.metrics.rowsInserted }
          },
        } as AdapterRunResult & {
          expectedSums?: Map<ReconciliationKey, number>
        }
      }
      let parsed:
        | ReturnType<typeof parseFarmingSalesSheet>
        | ReturnType<typeof parseProductionSalesSheet>
        | ReturnType<typeof parseProMaltSalesSheet>
        | null = null
      let salesCompanyId: string | undefined
      if (sheetLower.includes("farming") && edenId) {
        salesCompanyId = edenId
        parsed = parseFarmingSalesSheet(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          input.workbook as any,
          input.sheetName,
          input.XLSX,
          { preferYear: input.year, companyId: edenId },
        )
      } else if (sheetLower.includes("production") && cpcId) {
        salesCompanyId = cpcId
        parsed = parseProductionSalesSheet(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          input.workbook as any,
          input.sheetName,
          input.XLSX,
          { preferYear: input.year, companyId: cpcId },
        )
      } else if (
        (sheetLower.includes("promalt") || sheetLower.includes("satış promalt")) &&
        promaltId
      ) {
        salesCompanyId = promaltId
        parsed = parseProMaltSalesSheet(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          input.workbook as any,
          input.sheetName,
          input.XLSX,
          { preferYear: input.year, companyId: promaltId },
        )
      } else {
        warnings.push(
          `SALES sheet "${input.sheetName}" — could not infer target company from sheet name; skipped`,
        )
      }
      if (parsed && salesCompanyId) {
        warnings.push(...parsed.warnings.map((w) => `row ${w.row}: ${w.reason}`))
        for (const fact of parsed.facts) {
          rows.push({
            companyId: salesCompanyId,
            metric: fact.metric,
            date: fact.date,
            value: fact.value,
            unit: fact.unit,
            source: "xlsx_multi_import",
          })
        }
        for (const [k, v] of parsed.expectedSums) {
          expectedSums.set(k, (expectedSums.get(k) ?? 0) + v)
        }
      }
    }

    return {
      summary: `${rows.length} ${kind} KPI facts`,
      itemCount: rows.length,
      warnings,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(rows.length > 0 ? { expectedSums } : ({} as any)),
      applyToDb: async (tx: Prisma.TransactionClient) => {
        if (rows.length === 0) return { rowsInserted: 0 }
        // Per-sheet KPI batch — scoped to the touched companies only
        // (so dateScope cleanup doesn't clobber other sheets' facts).
        const touchedCompanyIds = Array.from(new Set(rows.map((r) => r.companyId)))
        const result = await runKpiBatch(tx, {
          organizationId: ctx.organizationId,
          label: `WB ${kind.toUpperCase()} ${input.sheetName} ${input.year}`,
          actorUserId: "ai-multi-import",
          sourceDocument: `multi-import:${input.sheetName}`,
          companyIds: touchedCompanyIds,
          dateScope: [String(input.year)],
          rows,
          expectedSums,
        })
        return { rowsInserted: result.metrics.rowsInserted }
      },
    } as AdapterRunResult & { expectedSums?: Map<ReconciliationKey, number> }
  }
}

// ──────────────────────────────────────────────────────────────────────
// LAND_REGISTRY handler — writes Company.settings via tx
// ──────────────────────────────────────────────────────────────────────

function makeLandRegistryHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    const ctx = ctxRef.value ?? (await ensureCtx())
    const parsed = parseLandRegistrySheet(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input.workbook as any,
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

function makeCapexHandler(
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

function makeDescriptionsHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    const ctx = ctxRef.value ?? (await ensureCtx())
    const parsed = parseTesvirSheet(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input.workbook as any,
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

function makeForwardForecastHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    const ctx = ctxRef.value ?? (await ensureCtx())
    const parsed = parseIcmalSheet(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input.workbook as any,
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

function makeCompaniesHandler(prisma: PrismaClient): AdapterHandler {
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

function makeOpsFactsHandler(
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
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

function makeBudgetActualsHandler(
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
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

function makeSalesForecastHandler(
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
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

const noopHandler: AdapterHandler = async (input) => ({
  summary: `Sheet "${input.sheetName}" classified as info/unknown — no action`,
  itemCount: 0,
  warnings: [],
  applyToDb: async () => ({ rowsInserted: 0 }),
})

// ──────────────────────────────────────────────────────────────────────
// Public entry — build the production registry
// ──────────────────────────────────────────────────────────────────────

/**
 * Build a registry that wires the AI Import classification → real
 * Phase 7.M parsers + batch functions. Uses an internal closure to
 * resolve+cache plan/companies per orchestrator invocation.
 *
 * Use ONE registry per multi-file orchestrator call so the context
 * stays scoped to (org, year). Calling `buildProductionAdapterRegistry`
 * again starts a fresh cache.
 */
export function buildProductionAdapterRegistry(
  prisma: PrismaClient,
): AdapterRegistry {
  // Shared context ref — populated lazily on first handler invocation.
  // Re-resolves on each org/year combination via the orgKey check.
  const ctxRef: { value: OrgContext | null; orgKey: string | null } = {
    value: null,
    orgKey: null,
  }
  // ensureCtx receives the org/year from the AdapterRunInput closure.
  // We can't bake them in at build time (registry is shared across
  // calls within one orchestrator invocation but the input arrives
  // per-handler). Solution: each handler resolves its own context if
  // the cached one doesn't match.
  function makeEnsure(input: AdapterRunInput): () => Promise<OrgContext> {
    return async () => {
      const key = `${input.organizationId}::${input.year}`
      if (ctxRef.orgKey === key && ctxRef.value) return ctxRef.value
      const next = await resolveOrgContext(
        prisma,
        input.organizationId,
        input.year,
      )
      ctxRef.value = next
      ctxRef.orgKey = key
      return next
    }
  }
  // Wrapper that injects ensureCtx into the per-input handler call.
  function wrap(make: (
    prisma: PrismaClient,
    ctxRef: { value: OrgContext | null },
    ensureCtx: () => Promise<OrgContext>,
  ) => AdapterHandler): AdapterHandler {
    return async (input) => {
      const handler = make(prisma, ctxRef, makeEnsure(input))
      return handler(input)
    }
  }
  return buildRegistryWith({
    PLF: wrap(makePlfHandler),
    BS: wrap(makeBsHandler),
    CF: wrap(makeCfHandler),
    KPI_FARMING: wrap((p, c, e) => makeKpiHandler(p, c, e, "farming")),
    KPI_PROCESSING: wrap((p, c, e) => makeKpiHandler(p, c, e, "processing")),
    SALES: wrap((p, c, e) => makeKpiHandler(p, c, e, "sales")),
    LAND_REGISTRY: wrap(makeLandRegistryHandler),
    CAPEX: wrap(makeCapexHandler),
    DESCRIPTIONS: wrap(makeDescriptionsHandler),
    // forward-forecast file-type uses INFO_SUMMARY classification on
    // its main sheet (İcmal). The file-type detector picks it up by
    // having ≥3 INFO_SUMMARY sheets without PLF/BS/CF. So we wire the
    // INFO_SUMMARY classification to the forward-forecast handler —
    // safer than nothing, and the handler is a noop for sheets that
    // aren't actually İcmal-shape.
    INFO_SUMMARY: wrap(makeForwardForecastHandler),
    // Phase 7.M Tier 6 — onboarding consolidation. COMPANIES doesn't
    // need org context (it's bootstrapping companies, not writing data
    // into existing ones), so we don't wrap it with the ensureCtx helper.
    COMPANIES: makeCompaniesHandler(prisma),
    // Phase 7.M Tier 7 — import consolidation. OPS_FACTS reuses the
    // shared org-context (companyCode → companyId map) like KPI handlers.
    OPS_FACTS: wrap(makeOpsFactsHandler),
    // Phase 7.M Tier 7 (Phase 3) — BUDGET_ACTUALS writes to budget_actuals
    // table via planId resolved from shared org-context.
    BUDGET_ACTUALS: wrap(makeBudgetActualsHandler),
    // Phase 7.M Tier 7 (Phase 4) — SALES_FORECAST writes to sales_forecasts
    // table via departmentLabel → departmentId resolved from shared
    // org-context (deptLabelToId map).
    SALES_FORECAST: wrap(makeSalesForecastHandler),
    UNKNOWN: noopHandler,
  })
}
