/**
 * Phase 7.M Step 4 (2026-05-18) — archive & restore helpers.
 *
 * Single chokepoint for self-service archive operations. Every archive
 * action goes through `archiveRows()` so the soft-delete stamp and the
 * audit_event row are written in the same Prisma transaction — partial
 * application is impossible.
 *
 * Why a transaction
 * ─────────────────
 * If the `updateMany` succeeds but the audit `create` throws, the data
 * is archived but the IFRS-required trail is missing. If the audit
 * write succeeds but the `updateMany` is rolled back, the audit lies.
 * Both halves are wrapped in `prisma.$transaction` so the database
 * enforces all-or-nothing.
 *
 * What's intentionally NOT here
 * ─────────────────────────────
 *  • The UI / API route lives in `src/app/api/admin/archive/route.ts`
 *    (Phase 7.M Step 4d). This module is the pure execution layer.
 *  • Permissions checks belong to the route (it has the session); this
 *    helper just trusts the userId it's given.
 *  • Hard delete (physical row removal) is the cleanup job's concern
 *    — not exposed here so a finance user can't accidentally bypass
 *    the 90-day retention.
 */

import type { PrismaClient } from "@prisma/client"
import { logAuditEvent } from "@/lib/audit/log"
import { archiveStamp, restoreStamp } from "./soft-delete"
import { slugifyProductLabel } from "@/lib/onboarding/ai-import/product-identity"

export type ArchiveEntityKind =
  | "BudgetLine"
  | "BalanceSheetLine"
  | "CashFlowEntry"
  | "Counterparty"

/**
 * Company.settings keys an import writes (and a full reset must clear — they are
 * the "tails" no per-table archive touches). ORG-level `forwardForecast` is NOT
 * here: it lives on Organization.settings, so a per-company reset leaves it.
 */
/**
 * Phase 11.6 (2026-07-29) — per-company scope for `SalesBudgetLine`.
 *
 * That table carries neither `companyId` nor `deletedAt`, so a company-scoped
 * WHERE cannot reach it directly and it survived every "delete all import
 * data" — the Sales tab kept rendering the pre-reset dataset while the reset
 * preview showed six confident numbers that did not include it.
 *
 * `ProductLine.code` IS entity-namespaced (`product-identity.ts` builds
 * `${slugify(entityCode)}__${slug}`, e.g. `AZSEKER_EDEN__WHEAT`), so the
 * company dimension is recoverable from the relation without a migration —
 * the same trick `cashFlowEntry` uses with its `"<code>::"` sourceId prefix.
 */
function salesLineCompanyScope(companyCode: string) {
  return {
    productLine: { code: { startsWith: `${slugifyProductLabel(companyCode)}__` } },
  }
}

export const IMPORT_SETTINGS_KEYS = [
  "courtDisputes", // LEGAL_CASES
  "auditFindings", // AUDIT_FINDINGS
  "riskRegister", // RISK_REGISTER
  "landParcels", // LAND_REGISTRY
  "landTotalHectares",
  "landTotalAnnualRentAzn",
  "landRegistrySource",
  "capexInitiatives", // CAPEX
  "capexLastImportSource",
  "strategicDescription", // DESCRIPTIONS (Təsvir) — the handler writes these 4,
  "competitiveAdvantage", //   not a bare `description` (Codex 2026-06-21).
  "strategicFullText",
  "strategicSource",
  "dataPendingBanner", // pre-load placeholder banner
] as const

/**
 * Exact `OperationalFact.source` values written by an import path. The reset
 * deletes facts whose source is one of these OR starts with `import:` /
 * `multi-import:` OR ends with `.xlsx` (legacy .mjs file-name sources). MANUAL
 * provenance — `manual`, `manual-bulk`, `inline:*`, and any custom sourceNote —
 * is NOT here, so user-entered facts survive the reset. A NEW import adapter
 * MUST use one of these source shapes (add its exact value here) to stay
 * reset-clean. (Codex 2026-06-21: enumerated from the import code + DB.)
 */
export const IMPORT_FACT_SOURCES = [
  "xlsx_multi_import",
  "xlsx_import",
  "ai_import_ops_facts",
  "import",
] as const

export interface ArchiveScope {
  /** Tenant — required, defense-in-depth at the SQL level. */
  organizationId: string
  /** Which table to operate on. */
  entityKind: ArchiveEntityKind
  /** Limit to a single company. Required for BudgetLine and
   *  Counterparty (they have companyId). OPTIONAL but honoured for
   *  BalanceSheetLine (scopes by its `companyId` column) and
   *  CashFlowEntry (scopes by the `<companyCode>::…` sourceId prefix).
   *  Omit it on BS/CF for a deliberate org-wide-per-year archive. */
  companyCode?: string
  /** Limit to a specific calendar year. Required for BudgetLine via
   *  plan.year filter, and for BalanceSheetLine / CashFlowEntry which
   *  have a `year` column. Ignored for Counterparty (uses `period`). */
  year?: number
  /** Limit to a specific period label (e.g. "2026" or "2026-Q1").
   *  Only meaningful for Counterparty rows where the year doesn't apply. */
  period?: string
}

export interface ArchiveActionArgs {
  prisma: PrismaClient
  /** The Session.userId of the operator. Pass "system" for cron / CLI. */
  actorUserId: string
  /** Free-text reason — surfaced in the audit log for the 7-year trail. */
  reason?: string
  /** What to archive. */
  scope: ArchiveScope
}

export interface ArchiveResult {
  rowsAffected: number
  auditEventId: string | null
}

/**
 * Build a Prisma `where` filter for the requested scope. Returns
 * `null` when the scope is too narrow / structurally impossible (e.g.
 * BudgetLine without a companyCode AND year — we refuse to archive
 * the whole tenant in a single transaction).
 */
async function buildScopeWhere(
  prisma: PrismaClient,
  scope: ArchiveScope,
): Promise<Record<string, unknown> | null> {
  const base: Record<string, unknown> = {
    organizationId: scope.organizationId,
    deletedAt: null,
  }

  if (scope.entityKind === "BudgetLine") {
    if (!scope.companyCode || !scope.year) return null
    const company = await prisma.company.findFirst({
      where: { organizationId: scope.organizationId, code: scope.companyCode },
      select: { id: true },
    })
    if (!company) return null
    base.companyId = company.id
    base.plan = { year: scope.year }
    return base
  }

  if (scope.entityKind === "BalanceSheetLine") {
    if (!scope.year) return null
    base.year = scope.year
    // Phase 3 fix (2026-06-20): balance_sheet_lines HAS a `companyId`
    // column, so scope to the single company when one is given.
    // Previously this returned org+year only — archiving one company's
    // BS would silently wipe EVERY company's BS for that year. With no
    // companyCode the scope stays org-wide-per-year (the "ALL" path the
    // confirmCode="ALL" gate guards).
    if (scope.companyCode) {
      const company = await prisma.company.findFirst({
        where: { organizationId: scope.organizationId, code: scope.companyCode },
        select: { id: true },
      })
      if (!company) return null
      base.companyId = company.id
    }
    return base
  }

  if (scope.entityKind === "CashFlowEntry") {
    if (!scope.year) return null
    base.year = scope.year
    // Phase 3 (2026-06-20) + companyId (2026-06-23): CashFlowEntry now has a
    // companyId column (mirrors BalanceSheetLine). Prefer companyId, keeping the
    // sourceId-prefix fallback for legacy rows not yet backfilled (companyId
    // null) — every imported row's sourceId is `<companyCode>::…`. The "::"
    // delimiter prevents prefix collisions ("AZSEKER::" never matches
    // "AZSEKER-AZSF::"). No companyCode → org-wide-per-year ("ALL" path).
    if (scope.companyCode) {
      const company = await prisma.company.findFirst({
        where: { organizationId: scope.organizationId, code: scope.companyCode },
        select: { id: true },
      })
      if (!company) return null
      base.OR = [
        { companyId: company.id },
        { sourceId: { startsWith: `${scope.companyCode}::` } },
      ]
    }
    return base
  }

  if (scope.entityKind === "Counterparty") {
    if (!scope.companyCode) return null
    const company = await prisma.company.findFirst({
      where: { organizationId: scope.organizationId, code: scope.companyCode },
      select: { id: true },
    })
    if (!company) return null
    base.companyId = company.id
    if (scope.period) base.period = scope.period
    return base
  }

  return null
}

/**
 * Soft-archive every row matching the scope. Writes one audit event
 * with `metadata.rowsAffected`. Idempotent in the sense that running
 * twice has no effect on the second call (where clause excludes
 * already-archived rows).
 */
export async function archiveRows(
  args: ArchiveActionArgs,
): Promise<ArchiveResult> {
  const { prisma, actorUserId, reason, scope } = args
  const where = await buildScopeWhere(prisma, scope)
  if (!where) {
    throw new Error(
      `archiveRows: invalid scope for ${scope.entityKind} (need companyCode + year for BudgetLine; year for BalanceSheetLine/CashFlowEntry; companyCode for Counterparty)`,
    )
  }
  const stamp = archiveStamp(actorUserId)
  const entityId = `${scope.companyCode ?? "ALL"}:${scope.year ?? scope.period ?? "ALL"}`

  return prisma.$transaction(async (tx) => {
    let rowsAffected = 0
    switch (scope.entityKind) {
      case "BudgetLine": {
        const r = await tx.budgetLine.updateMany({
          where: where as never,
          data: stamp,
        })
        rowsAffected = r.count
        break
      }
      case "BalanceSheetLine": {
        const r = await tx.balanceSheetLine.updateMany({
          where: where as never,
          data: stamp,
        })
        rowsAffected = r.count
        break
      }
      case "CashFlowEntry": {
        const r = await tx.cashFlowEntry.updateMany({
          where: where as never,
          data: stamp,
        })
        rowsAffected = r.count
        break
      }
      case "Counterparty": {
        const r = await tx.counterparty.updateMany({
          where: where as never,
          data: stamp,
        })
        rowsAffected = r.count
        break
      }
    }

    const audit = await logAuditEvent(tx as PrismaClient, {
      organizationId: scope.organizationId,
      actorUserId,
      event: {
        action: "data_archive",
        entityType: scope.entityKind,
        entityId,
        metadata: {
          entityKind: scope.entityKind,
          companyCode: scope.companyCode,
          year: scope.year,
          period: scope.period,
          rowsAffected,
          reason,
        },
      },
    })

    return {
      rowsAffected,
      auditEventId: audit.ok ? audit.id : null,
    }
  })
}

/**
 * Reverse of `archiveRows` — clears deletedAt/deletedBy on rows
 * matching the scope AND the original `deletedBy` (so a finance user
 * can only restore what THEY archived, unless an admin uses the
 * org-wide restore in the admin UI).
 */
export async function restoreRows(
  args: ArchiveActionArgs & { matchDeletedBy?: string },
): Promise<ArchiveResult> {
  const { prisma, actorUserId, reason, scope } = args
  // Build the same scope but invert the soft-delete filter — we want
  // rows that ARE archived to be restored.
  const where = await buildScopeWhere(prisma, scope)
  if (!where) {
    throw new Error(`restoreRows: invalid scope for ${scope.entityKind}`)
  }
  // Override the deletedAt: null filter — we want only archived rows.
  delete (where as Record<string, unknown>).deletedAt
  ;(where as Record<string, unknown>).deletedAt = { not: null }
  if (args.matchDeletedBy) {
    ;(where as Record<string, unknown>).deletedBy = args.matchDeletedBy
  }
  const stamp = restoreStamp()
  const entityId = `${scope.companyCode ?? "ALL"}:${scope.year ?? scope.period ?? "ALL"}`

  return prisma.$transaction(async (tx) => {
    let rowsAffected = 0
    switch (scope.entityKind) {
      case "BudgetLine": {
        const r = await tx.budgetLine.updateMany({
          where: where as never,
          data: stamp,
        })
        rowsAffected = r.count
        break
      }
      case "BalanceSheetLine": {
        const r = await tx.balanceSheetLine.updateMany({
          where: where as never,
          data: stamp,
        })
        rowsAffected = r.count
        break
      }
      case "CashFlowEntry": {
        const r = await tx.cashFlowEntry.updateMany({
          where: where as never,
          data: stamp,
        })
        rowsAffected = r.count
        break
      }
      case "Counterparty": {
        const r = await tx.counterparty.updateMany({
          where: where as never,
          data: stamp,
        })
        rowsAffected = r.count
        break
      }
    }

    const audit = await logAuditEvent(tx as PrismaClient, {
      organizationId: scope.organizationId,
      actorUserId,
      event: {
        action: "data_restore",
        entityType: scope.entityKind,
        entityId,
        metadata: {
          entityKind: scope.entityKind,
          companyCode: scope.companyCode,
          year: scope.year,
          period: scope.period,
          rowsAffected,
          reason,
        },
      },
    })

    return {
      rowsAffected,
      auditEventId: audit.ok ? audit.id : null,
    }
  })
}

export interface ResetResult {
  rowsAffected: number
  /** Per-source counts so the operator sees nothing was missed. */
  breakdown: Record<string, number>
  auditEventId: string | null
}

export interface ResetPreviewCompany {
  companyCode: string
  companyId: string
  breakdown: Record<string, number>
  rowsAffected: number
}

export interface ResetPreviewResult {
  year?: number
  companies: ResetPreviewCompany[]
  breakdown: Record<string, number>
  rowsAffected: number
  orphanBudgetLine: number
  isWholeHolding: boolean
}

function importOperationalFactWhere(args: {
  organizationId: string
  companyId: string
  year?: number
}): Record<string, unknown> {
  const where: Record<string, unknown> = {
    organizationId: args.organizationId,
    companyId: args.companyId,
    OR: [
      { source: { in: IMPORT_FACT_SOURCES } },
      { source: { startsWith: "import:" } },
      { source: { startsWith: "multi-import:" } },
      { source: { endsWith: ".xlsx" } },
    ],
  }
  if (args.year) {
    where.date = {
      gte: new Date(`${args.year}-01-01T00:00:00.000Z`),
      lt: new Date(`${args.year + 1}-01-01T00:00:00.000Z`),
    }
  }
  return where
}

async function countOrgOrphanBudgetLines(args: {
  prisma: PrismaClient
  organizationId: string
  year?: number
}): Promise<number> {
  const attrWhere: Record<string, unknown> = {
    organizationId: args.organizationId,
    companyId: { not: null },
  }
  if (args.year) attrWhere.plan = { year: args.year }
  const mixedPlanIds = (
    await args.prisma.budgetLine.findMany({
      where: attrWhere as never,
      select: { planId: true },
      distinct: ["planId"],
    })
  ).map((r) => r.planId)

  // 2026-07-30 — the PREVIEW must promise what the ACTION will do.
  //
  // This counter kept the pre-fix rule (mixed plans only) after
  // `archiveOrgOrphanBudgetLines` learned to also sweep orphans whose PLAN is
  // soft-deleted. Observed live: the panel reported "Orphan P&L: 0" for a year
  // where the reset was about to archive 1,356 rows. A preview that understates
  // is worse than no preview — the operator confirms a number that is not the
  // one being executed. Same two-source rule as the sweep, kept in lockstep.
  const deletedPlanOrphanIds = (
    await args.prisma.budgetLine.findMany({
      where: {
        organizationId: args.organizationId,
        companyId: null,
        deletedAt: null,
        plan: {
          deletedAt: { not: null },
          ...(args.year ? { year: args.year } : {}),
        },
      } as never,
      select: { planId: true },
      distinct: ["planId"],
    })
  ).map((r) => r.planId)

  const countPlanIds = [...new Set([...mixedPlanIds, ...deletedPlanOrphanIds])]
  if (countPlanIds.length === 0) return 0
  const orphanWhere: Record<string, unknown> = {
    organizationId: args.organizationId,
    companyId: null,
    planId: { in: countPlanIds },
    deletedAt: null,
  }
  if (args.year) orphanWhere.plan = { year: args.year }
  return args.prisma.budgetLine.count({ where: orphanWhere as never })
}

/**
 * Read-only companion to `resetCompanyImportData()`. It mirrors the reset
 * scopes exactly so the UI can show a concrete blast radius before a write.
 */
export async function previewCompanyImportReset(args: {
  prisma: PrismaClient
  organizationId: string
  companyCodes: string[]
  year?: number
}): Promise<ResetPreviewResult> {
  const codes = [...new Set(args.companyCodes.filter(Boolean))]
  if (codes.length === 0) {
    return {
      year: args.year,
      companies: [],
      breakdown: {},
      rowsAffected: 0,
      orphanBudgetLine: 0,
      isWholeHolding: false,
    }
  }

  const targets = await args.prisma.company.findMany({
    where: { organizationId: args.organizationId, code: { in: codes } },
    select: { id: true, code: true, settings: true },
    orderBy: { code: "asc" },
  })
  const found = new Set(targets.map((c) => c.code))
  const missing = codes.filter((c) => !found.has(c))
  if (missing.length > 0) {
    throw new Error(`Unknown companies for this org: ${missing.join(", ")}`)
  }

  const operationalCompanies = await args.prisma.company.findMany({
    where: { organizationId: args.organizationId, isActive: true, level: { gt: 1 } },
    select: { code: true },
  })
  const isWholeHolding =
    operationalCompanies.length > 0 && operationalCompanies.every((c) => found.has(c.code))

  const companies: ResetPreviewCompany[] = []
  const aggregate: Record<string, number> = {}

  for (const company of targets) {
    const breakdown: Record<string, number> = {}
    const base = { organizationId: args.organizationId, companyId: company.id, deletedAt: null }

    const blWhere: Record<string, unknown> = { ...base }
    if (args.year) blWhere.plan = { year: args.year }
    breakdown.budgetLine = await args.prisma.budgetLine.count({ where: blWhere as never })

    const bsWhere: Record<string, unknown> = { ...base }
    if (args.year) bsWhere.year = args.year
    breakdown.balanceSheetLine = await args.prisma.balanceSheetLine.count({ where: bsWhere as never })

    const cfWhere: Record<string, unknown> = {
      organizationId: args.organizationId,
      sourceId: { startsWith: `${company.code}::` },
      deletedAt: null,
    }
    if (args.year) cfWhere.year = args.year
    breakdown.cashFlowEntry = await args.prisma.cashFlowEntry.count({ where: cfWhere as never })

    // Must mirror the reset's scope exactly, or the blast-radius preview
    // under-reports what a "clear <year>" will actually archive.
    const cpWhere: Record<string, unknown> = { ...base }
    if (args.year) cpWhere.period = { startsWith: String(args.year) }
    breakdown.counterparty = await args.prisma.counterparty.count({ where: cpWhere as never })

    breakdown.operationalFact = await args.prisma.operationalFact.count({
      where: importOperationalFactWhere({
        organizationId: args.organizationId,
        companyId: company.id,
        year: args.year,
      }) as never,
    })

    const baWhere: Record<string, unknown> = {
      organizationId: args.organizationId,
      companyId: company.id,
    }
    if (args.year) baWhere.plan = { year: args.year }
    breakdown.budgetActual = await args.prisma.budgetActual.count({ where: baWhere as never })

    // Phase 11.6 — the preview MUST count exactly what the reset deletes.
    // It previously reported six tables while the reset also had a settings
    // tail and, after this phase, sales lines and indicator values: a user
    // reading "6 numbers" concluded the entity would be empty, then watched
    // the Sales tab keep rendering the pre-reset dataset.
    const sblWhere: Record<string, unknown> = {
      organizationId: args.organizationId,
      ...salesLineCompanyScope(company.code),
    }
    if (args.year) sblWhere.year = args.year
    breakdown.salesBudgetLine = await args.prisma.salesBudgetLine.count({
      where: sblWhere as never,
    })

    const ivWhere: Record<string, unknown> = {
      organizationId: args.organizationId,
      companyId: company.id,
    }
    if (args.year) ivWhere.period = { startsWith: String(args.year) }
    breakdown.indicatorValue = await args.prisma.indicatorValue.count({
      where: ivWhere as never,
    })

    const settings = (company.settings as Record<string, unknown> | null) ?? {}
    breakdown.settingsKeys = IMPORT_SETTINGS_KEYS.filter((k) => k in settings).length

    const rowsAffected = Object.values(breakdown).reduce((sum, n) => sum + n, 0)
    for (const [key, count] of Object.entries(breakdown)) {
      aggregate[key] = (aggregate[key] ?? 0) + count
    }
    companies.push({
      companyCode: company.code,
      companyId: company.id,
      breakdown,
      rowsAffected,
    })
  }

  const orphanBudgetLine = isWholeHolding
    ? await countOrgOrphanBudgetLines({
        prisma: args.prisma,
        organizationId: args.organizationId,
        year: args.year,
      })
    : 0
  if (orphanBudgetLine > 0) aggregate.orphanBudgetLine = orphanBudgetLine

  return {
    year: args.year,
    companies,
    breakdown: aggregate,
    rowsAffected: Object.values(aggregate).reduce((sum, n) => sum + n, 0),
    orphanBudgetLine,
    isWholeHolding,
  }
}

/**
 * Full "reset a company's imported data" — the no-tails cleanup. Clears EVERY
 * surface an import writes for one company, atomically:
 *   • soft-archives BudgetLine / BalanceSheetLine / CashFlowEntry / Counterparty
 *     (reversible — the IFRS trail is kept; reads exclude them);
 *   • HARD-deletes import-sourced OperationalFact (KPI / legal / audit /
 *     counterparty-derived — no soft-delete column; the classic tail that kept
 *     indicators lit after a re-import) — manually-entered facts (manual /
 *     inline / custom provenance) survive;
 *   • HARD-deletes BudgetActual (BUDGET_ACTUALS import; no soft-delete column);
 *   • removes the import-derived Company.settings keys (IMPORT_SETTINGS_KEYS).
 *
 * OUT OF SCOPE — company-less rows (companyId = NULL) a per-company WHERE can't
 * reach: org-level ORPHAN BudgetLines (the "reset everything but 1.3M survived"
 * tail), Organization.settings.forwardForecast, and `sales_forecasts`. The
 * whole-holding reset path sweeps orphan BudgetLines separately via
 * `archiveOrgOrphanBudgetLines` (once, after every per-company reset succeeds).
 *
 * `year` is optional — omit for an all-years reset (the deepest clean), pass it
 * to scope BudgetLine (plan.year) / BS / CF (year) and OperationalFact (date in
 * that year). Counterparty is keyed by `period`, scoped when `scope.period` set.
 *
 * Irreversible parts (OperationalFact, settings) are re-derivable by re-importing
 * the file — which is the point. The caller (route) must trigger a recompute
 * afterwards so stale IndicatorValues fall back to `unknown`.
 */
/**
 * Phase 11.6b (2026-07-29) — org-level SalesForecast sweep, whole-holding only.
 *
 * `SalesForecast` is keyed `(organizationId, departmentId, year, month)` and
 * carries NO company dimension — `BudgetDepartment` has none either, so the
 * company simply does not exist anywhere in that chain. A per-company reset
 * therefore cannot scope it, and deleting it during one would wipe the whole
 * organization's forecast on behalf of a single entity.
 *
 * The consequence, before this: a stale forecast survived every reset and
 * every re-import, because the import path only ever upserts the departments
 * present in the NEW file — a department dropped from the source keeps its old
 * numbers forever.
 *
 * The one case where the scope IS unambiguous is a WHOLE-HOLDING reset: when
 * every operational company is being cleared, the org's forecast is genuinely
 * in scope. That is the case this handles, and only that one. Giving forecasts
 * a real per-company scope needs a schema decision about whether a department
 * belongs to a company — an owner call, not something to invent here.
 *
 * Mirrors `archiveOrgOrphanBudgetLines`: called ONCE after the per-company
 * loop, and only when every company succeeded, so a partial reset never leaves
 * org-level rows gone while an entity still holds its data.
 */
export async function resetOrgSalesForecast(args: {
  prisma: PrismaClient
  actorUserId: string
  reason?: string
  organizationId: string
  year?: number
}): Promise<{ rowsAffected: number; auditEventId: string | null }> {
  const { prisma, actorUserId, reason, organizationId, year } = args
  const where: Record<string, unknown> = { organizationId }
  if (year) where.year = year

  // Hard delete: SalesForecast has no soft-delete column, same as
  // OperationalFact and BudgetActual.
  const del = await prisma.salesForecast.deleteMany({ where: where as never })
  if (del.count === 0) return { rowsAffected: 0, auditEventId: null }

  const audit = await logAuditEvent(prisma, {
    organizationId,
    actorUserId,
    event: {
      action: "data_reset",
      entityType: "Company",
      entityId: `org-sales-forecast:${year ?? "ALL"}`,
      metadata: {
        // Sentinel, matching archiveOrgOrphanBudgetLines: this is an
        // ORG-level sweep, so there is no company code to record.
        companyCode: "__ORG_SALES_FORECAST__",
        year,
        breakdown: { salesForecast: del.count },
        rowsAffected: del.count,
        reason,
      },
    },
  })
  return { rowsAffected: del.count, auditEventId: audit.ok ? audit.id : null }
}

export async function resetCompanyImportData(
  args: Omit<ArchiveActionArgs, "scope"> & {
    scope: Omit<ArchiveScope, "entityKind">
  },
): Promise<ResetResult> {
  const { prisma, actorUserId, reason, scope } = args
  if (!scope.companyCode) {
    throw new Error("resetCompanyImportData: companyCode is required (per-company reset)")
  }
  const company = await prisma.company.findFirst({
    where: { organizationId: scope.organizationId, code: scope.companyCode },
    select: { id: true, settings: true },
  })
  if (!company) {
    throw new Error(`resetCompanyImportData: company "${scope.companyCode}" not found`)
  }
  const companyId = company.id
  const orgId = scope.organizationId
  const companyCode = scope.companyCode // narrowed to string by the guard above
  const stamp = archiveStamp(actorUserId)

  return prisma.$transaction(async (tx) => {
    const breakdown: Record<string, number> = {}

    // 1. Soft-archive financial + counterparty (reversible; reads exclude them).
    const blWhere: Record<string, unknown> = { organizationId: orgId, companyId, deletedAt: null }
    if (scope.year) blWhere.plan = { year: scope.year }
    breakdown.budgetLine = (await tx.budgetLine.updateMany({ where: blWhere as never, data: stamp })).count

    const bsWhere: Record<string, unknown> = { organizationId: orgId, companyId, deletedAt: null }
    if (scope.year) bsWhere.year = scope.year
    breakdown.balanceSheetLine = (await tx.balanceSheetLine.updateMany({ where: bsWhere as never, data: stamp })).count

    // cash_flow_entries has no companyId — scope by the "<code>::" sourceId prefix.
    const cfWhere: Record<string, unknown> = {
      organizationId: orgId,
      sourceId: { startsWith: `${companyCode}::` },
      deletedAt: null,
    }
    if (scope.year) cfWhere.year = scope.year
    breakdown.cashFlowEntry = (await tx.cashFlowEntry.updateMany({ where: cfWhere as never, data: stamp })).count

    // 2026-07-29 — scope by YEAR, like every sibling table above.
    //
    // This filtered on `scope.period`, which the reset UI never sends: the
    // panel posts `year` (ImportDataResetPanel.tsx). So the condition was
    // always absent and a "clear 2026" archived EVERY year's customer and
    // supplier snapshot, while the re-import restores only the year it
    // covers (`period = String(input.year)` in the writers). Combined with
    // the 30-day physical purge of soft-deleted rows, prior-year
    // concentration history became permanently unrecoverable rather than
    // merely hidden.
    //
    // `Counterparty.period` is a "YYYY" or "YYYY-MM" string, so a year scope
    // is a prefix match. An explicit `scope.period` still wins when a caller
    // genuinely wants one month.
    const cpWhere: Record<string, unknown> = { organizationId: orgId, companyId, deletedAt: null }
    if (scope.period) cpWhere.period = scope.period
    else if (scope.year) cpWhere.period = { startsWith: String(scope.year) }
    breakdown.counterparty = (await tx.counterparty.updateMany({ where: cpWhere as never, data: stamp })).count

    // 2. HARD-delete import-sourced OperationalFact only (no soft-delete column —
    //    the classic tail that kept indicators lit after a re-import). Matches by
    //    KNOWN IMPORT source prefixes rather than excluding "manual", because the
    //    inline UI writes source "inline:indicator-health" and bulk writes
    //    "manual-bulk" — an exclude-"manual" filter would wrongly delete those.
    //    Inverting (delete only import provenance) STRUCTURALLY preserves every
    //    manually-entered fact (Codex 2026-06-21). New import adapters must use
    //    one of these source prefixes (`multi-import:` / `import:` / `import` /
    //    `xlsx_multi_import` / a `*.xlsx` legacy file name) to be reset-clean.
    const ofWhere = importOperationalFactWhere({
      organizationId: orgId,
      companyId,
      year: scope.year,
    })
    breakdown.operationalFact = (await tx.operationalFact.deleteMany({ where: ofWhere as never })).count

    // 2b. HARD-delete BudgetActual (no soft-delete column) — the BUDGET_ACTUALS
    //     import writes here. Scoped to this company; companyId-null rows are
    //     unattributable and intentionally left (Codex 2026-06-21).
    const baWhere: Record<string, unknown> = { organizationId: orgId, companyId }
    if (scope.year) baWhere.plan = { year: scope.year }
    breakdown.budgetActual = (await tx.budgetActual.deleteMany({ where: baWhere as never })).count

    // 2c. HARD-delete SalesBudgetLine (no soft-delete column) for THIS
    //     company's products. See salesLineCompanyScope() for why the scope
    //     goes through the entity-namespaced ProductLine.code.
    //
    //     `ProductLine` itself is deliberately NOT deleted: it is master data
    //     like ChartOfAccount (which no path deletes either), a re-import
    //     upserts it back, and it is referenced by CostComponent / COGS* /
    //     TradeSku whose rows would cascade away with it. After this reset it
    //     simply carries no sales lines, so it renders nothing.
    const sblWhere: Record<string, unknown> = {
      organizationId: orgId,
      ...salesLineCompanyScope(companyCode),
    }
    if (scope.year) sblWhere.year = scope.year
    breakdown.salesBudgetLine = (
      await tx.salesBudgetLine.deleteMany({ where: sblWhere as never })
    ).count

    // 2d. HARD-delete IndicatorValue for this company (all granularities).
    //     Without this, month- and quarter-granular rows survive the reset
    //     carrying their pre-reset value AND their pre-reset status colour:
    //     the terminal keeps painting numbers derived from data that no
    //     longer exists. Post-reset recompute only fans out over YEAR
    //     periods, so it cannot clean these up either — deleting them here,
    //     inside the same transaction, is both cheaper and more honest.
    //     `period` is a string: "2026" | "2026-Q2" | "2026-04", so a single
    //     `startsWith` covers all three shapes for a year.
    const ivWhere: Record<string, unknown> = {
      organizationId: orgId,
      companyId,
    }
    if (scope.year) ivWhere.period = { startsWith: String(scope.year) }
    breakdown.indicatorValue = (
      await tx.indicatorValue.deleteMany({ where: ivWhere as never })
    ).count

    // NOTE (Phase 11.6): `SalesForecast` is intentionally NOT reset here. It
    // is keyed by (organizationId, departmentId, year, month) and carries no
    // company dimension at all, so there is no correct way to scope it to one
    // company — deleting it would wipe the whole organization's forecast.
    // Giving it a company scope needs a schema change; tracked as 11.6b.

    // 3. Clear import-derived Company.settings keys (the settings tail).
    const settings = { ...((company.settings as Record<string, unknown>) ?? {}) }
    let settingsKeysCleared = 0
    for (const k of IMPORT_SETTINGS_KEYS) {
      if (k in settings) {
        delete settings[k]
        settingsKeysCleared++
      }
    }
    if (settingsKeysCleared > 0) {
      await tx.company.update({ where: { id: companyId }, data: { settings: settings as never } })
    }
    breakdown.settingsKeys = settingsKeysCleared

    const rowsAffected = Object.values(breakdown).reduce((s, n) => s + n, 0)
    const audit = await logAuditEvent(tx as PrismaClient, {
      organizationId: orgId,
      actorUserId,
      event: {
        action: "data_reset",
        entityType: "Company",
        entityId: `${companyCode}:${scope.year ?? "ALL"}`,
        metadata: {
          companyCode,
          year: scope.year,
          breakdown,
          rowsAffected,
          reason,
        },
      },
    })

    return { rowsAffected, breakdown, auditEventId: audit.ok ? audit.id : null }
  })
}

export interface OrphanSweepResult {
  rowsAffected: number
  auditEventId: string | null
}

/**
 * Sweep ORG-LEVEL ORPHAN BudgetLines — company-less (companyId = NULL) rows a
 * per-company reset WHERE can't reach. Legacy imports that pre-date per-company
 * attribution leave them in an org-level plan (the "I reset everything but 1.3M
 * survived" tail).
 *
 * SAFETY (destructive, scope-broadening — see project_import_clean_slate_guard):
 *   • MIXED PLANS ONLY — a plan is swept only if it ALSO holds ≥1 company-
 *     attributed line (live OR archived). A NULL line in a per-company plan is
 *     un-attributed residue; a plan that is WHOLLY company-less is a deliberate
 *     org-level plan and is LEFT ALONE. (Closes Codex 2026-06-22 HIGH Q1 — the
 *     guard is "the plan has real per-company owners", not merely "shared plan".)
 *   • Soft-archive (deletedAt stamp), never a hard delete; reads exclude it. NOTE
 *     the generic UI restore is per-company, so it cannot reach companyId=NULL
 *     rows — recovery is a manual DB un-stamp (Codex HIGH Q4: not UI-reversible).
 *   • Caller MUST gate to a WHOLE-HOLDING reset that fully SUCCEEDED — never a
 *     partial/surgical reset (an orphan can't be attributed to a subset), and
 *     run this ONCE after the per-company loop (Codex MED Q3: no partial state).
 *
 * `year` optional — scope to BudgetPlan.year, else all years.
 */
export async function archiveOrgOrphanBudgetLines(args: {
  prisma: PrismaClient
  actorUserId: string
  reason?: string
  organizationId: string
  year?: number
}): Promise<OrphanSweepResult> {
  const { prisma, actorUserId, reason, organizationId, year } = args
  const stamp = archiveStamp(actorUserId)
  return prisma.$transaction(async (tx) => {
    // Plans that hold ANY company-attributed line (live OR archived — by the
    // time the per-company resets have run those lines are already soft-archived,
    // so a deletedAt:null filter here would wrongly exclude the residue plan).
    const attrWhere: Record<string, unknown> = {
      organizationId,
      companyId: { not: null },
    }
    if (year) attrWhere.plan = { year }
    const mixedPlanIds = (
      await tx.budgetLine.findMany({
        where: attrWhere as never,
        select: { planId: true },
        distinct: ["planId"],
      })
    ).map((r) => r.planId)

    // 2026-07-30 — orphan lines in a SOFT-DELETED plan were unreachable.
    //
    // The `mixedPlanIds` rule above only sweeps plans holding at least one
    // company-attributed line. Measured on production: plans "Q1" (1017 rows)
    // and "June 2026" (339) consist ENTIRELY of `companyId: null` lines, so
    // they matched nothing — and the per-company resets cannot reach them
    // either, because those filter on a companyId these rows do not have.
    // 1,356 live rows that no reset offered by the UI could remove.
    //
    // They are inert today (their plans are soft-deleted, and 11.4 taught the
    // risk readers to filter on `plan.deletedAt: null`), which is why nobody
    // noticed — but residue that harms nothing still makes "the year is
    // cleared" a false statement, with no way for the operator to find out.
    //
    // Restricted to plans that are THEMSELVES soft-deleted. A live plan whose
    // lines carry no company is deliberately left alone — that is a
    // hand-built org-level plan, not import residue, and the existing test
    // pins that protection. A deleted plan's surviving lines are residue by
    // definition: the plan is gone, the rows should have gone with it.
    const deletedPlanOrphans = await tx.budgetLine.findMany({
      where: {
        organizationId,
        companyId: null,
        deletedAt: null,
        plan: { deletedAt: { not: null }, ...(year ? { year } : {}) },
      } as never,
      select: { planId: true },
      distinct: ["planId"],
    })
    const sweepPlanIds = [
      ...new Set([...mixedPlanIds, ...deletedPlanOrphans.map((r) => r.planId)]),
    ]

    let rowsAffected = 0
    if (sweepPlanIds.length > 0) {
      const orphanWhere: Record<string, unknown> = {
        organizationId,
        companyId: null,
        planId: { in: sweepPlanIds },
        deletedAt: null,
      }
      if (year) orphanWhere.plan = { year }
      rowsAffected = (await tx.budgetLine.updateMany({ where: orphanWhere as never, data: stamp }))
        .count
    }

    // Reuse the `data_reset` action (already in the Prisma AuditAction enum — no
    // migration, no runtime "Invalid value for argument action" trap). Its
    // contract requires a Company entityType + companyCode, so we tag this
    // org-level sweep with a marker code that can't collide with a real one.
    const audit = await logAuditEvent(tx as PrismaClient, {
      organizationId,
      actorUserId,
      event: {
        action: "data_reset",
        entityType: "Company",
        entityId: `org-orphan-budgetlines:${year ?? "ALL"}`,
        metadata: {
          companyCode: "__ORG_ORPHANS__",
          year,
          breakdown: { orphanBudgetLine: rowsAffected },
          rowsAffected,
          reason,
        },
      },
    })
    return { rowsAffected, auditEventId: audit.ok ? audit.id : null }
  })
}
