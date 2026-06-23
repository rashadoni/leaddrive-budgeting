/**
 * Phase 7.M Step 6 (2026-05-19) — atomic CashFlowEntry import-batch
 * orchestrator. Fourth sister of `runImportBatch` (P&L),
 * `runBalanceSheetBatch` (BS), and `runKpiBatch` (KPI).
 *
 * Schema differences vs P&L / BS / KPI
 * ────────────────────────────────────
 *  • Target table: `cash_flow_entries`. Org-scoped. A `companyId` column
 *    was added 2026-06-23 (mirrors BalanceSheetLine) so CF is per-company;
 *    the reset/import paths prefer it, with the `sourceId = '<entity>::…'`
 *    prefix as the fallback for legacy un-backfilled rows. No `planId` yet.
 *  • Key fields: (organizationId, year, month, source, sourceId,
 *    category, activityType, entryType). To get bit-perfect re-import
 *    we use `source = 'workbook-cf'` + `sourceId = '<entity>::<code>'`.
 *  • Soft-delete IS available on this table (Phase 7.M Step 4 added
 *    `deletedAt` / `deletedBy`), so the reset semantics mirror BS.
 *
 * Reconciliation key shape: `${source}::${entity}::${code}::${year}-${MM}`.
 */
import type { PrismaClient, Prisma } from "@prisma/client"
import { archiveStamp } from "@/lib/server/soft-delete"
import { assertNoCollateralDeletion } from "./collateral-guard"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger for the
// cash-flow batch import phase narrator. 4 console.* → logger calls.
const log = getLogger("onboarding:cf-batch")
import {
  reconcile,
  buildReconKey,
  type ReconciliationKey,
  type ReconciliationReport,
  type ReconciliationOptions,
} from "./reconciliation"

export interface CfImportRow {
  /** Entity code embedded for drill-down (e.g. "AZSEKER-AZSF"). */
  entityCode: string
  /** CF.XX.XX.XX leaf code. */
  cfCode: string
  /**
   * Phase 2.1 session 3 (2026-05-26) — `category` String dropped from
   * CashFlowEntry schema. Kept on the row interface ONLY for
   * orchestrator reconciliation keys; never written to DB.
   */
  category: string
  /**
   * Phase 2.1 session 3 — FK to ChartOfAccount. Required NOT NULL.
   * Resolved via `resolveOrCreateAccountId` inside the CF handler's
   * applyToDb before passing rows in.
   */
  accountId: string
  /** operating | investing | financing */
  activityType: string
  /** inflow | outflow */
  entryType: string
  year: number
  month: number // 1-12
  amount: number
  currencyCode: string
  description: string
  /** Identifier source/ID columns used to detect re-imports. */
  source: string
  sourceId: string
}

export interface CfImportPlan {
  organizationId: string
  label: string
  actorUserId: string
  sourceDocument: string
  /** Free-form source tag identifying this batch. Used in reset filter. */
  sourceTag: string
  /** Year-month strings in scope, e.g. `["2026-01",...,"2026-12"]`. */
  periodScope: ReadonlyArray<string>
  rows: ReadonlyArray<CfImportRow>
  expectedSums: ReadonlyMap<ReconciliationKey, number>
  purgeArchivedFirst?: boolean
  reconciliationOptions?: ReconciliationOptions
}

export interface CfImportPhaseMetrics {
  resetArchived: number
  resetPurged: number
  rowsInserted: number
}

export interface CfImportResult {
  batchId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  plan: {
    label: string
    sourceDocument: string
    sourceTag: string
    periodScope: ReadonlyArray<string>
  }
  metrics: CfImportPhaseMetrics
  reconciliation: ReconciliationReport
}

export async function runCashFlowBatch(
  /**
   * Phase 7.M Tier 5 — accepts PrismaClient (legacy single-file path:
   * opens own tx) OR Prisma.TransactionClient (multi-file orchestrator
   * path: caller-managed outer tx). Detected at runtime via
   * `$transaction` method presence.
   */
  prismaOrTx: PrismaClient | Prisma.TransactionClient,
  plan: CfImportPlan,
  opts: {
    readActualSums?: (
      prismaClient: PrismaClient | Prisma.TransactionClient,
      input: {
        organizationId: string
        sourceTag: string
        periodScope: ReadonlyArray<string>
      },
    ) => Promise<Map<ReconciliationKey, number>>
    batchIdFactory?: () => string
  } = {},
): Promise<CfImportResult> {
  const isOuterTx =
    typeof (prismaOrTx as PrismaClient).$transaction !== "function"
  const dbHandle = prismaOrTx as PrismaClient & Prisma.TransactionClient
  const startedAt = new Date()
  const batchId =
    opts.batchIdFactory?.() ??
    `cf_batch_${startedAt.toISOString().replace(/[:.]/g, "-")}_${Math.random().toString(36).slice(2, 10)}`

  const yearScope = Array.from(
    new Set(
      plan.periodScope
        .map((p) => Number(p.slice(0, 4)))
        .filter((n) => Number.isFinite(n)),
    ),
  )

  const writePhase = async (tx: Prisma.TransactionClient) => {
      const yearFilter =
        yearScope.length > 0 ? { year: { in: yearScope } } : {}

      // ── Entity breakdown from incoming rows ───────────────────────
      const incomingByEntity = new Map<string, number>()
      for (const r of plan.rows) {
        incomingByEntity.set(r.entityCode, (incomingByEntity.get(r.entityCode) ?? 0) + 1)
      }
      const incomingBreakdown = [...incomingByEntity.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([e, n]) => `${e}(${n})`)
        .join(", ")
      log.info("plan scope", {
        label: plan.label,
        sourceTag: plan.sourceTag,
        years: yearScope,
        incomingRows: plan.rows.length,
        incomingBreakdown: incomingBreakdown || "(none)",
      })

      let archived = 0
      let purged = 0
      // BUGFIX 2026-05-31: the reset scoped by `source` (sourceTag) only, so the
      // AzerSheker multi-import (ONE shared sourceTag for every entity) archived
      // siblings' live CF (only the last survived: 37 of 309). Scope the reset to
      // THIS batch's entities. 2026-06-23: CashFlowEntry now has a companyId
      // column — prefer it, with the sourceId `<entityCode>::` prefix as the
      // fallback for legacy un-backfilled rows. Fall back to sourceTag-only when
      // no incoming row carries an entityCode (legacy / single-entity batches).
      const entityPrefixes = [...new Set(plan.rows.map((r) => r.entityCode).filter(Boolean))]
      const hasEntityScope = entityPrefixes.length > 0
      const companyByCode = new Map<string, string>()
      if (entityPrefixes.length > 0) {
        const cos = await tx.company.findMany({
          where: { organizationId: plan.organizationId, code: { in: entityPrefixes } },
          select: { id: true, code: true },
        })
        for (const c of cos) companyByCode.set(c.code, c.id)
      }
      const companyIds = [...companyByCode.values()]
      const entityScope =
        hasEntityScope
          ? {
              OR: [
                ...(companyIds.length > 0 ? [{ companyId: { in: companyIds } }] : []),
                ...entityPrefixes.map((e) => ({ sourceId: { startsWith: `${e}::` } })),
              ],
            }
          : {}
      // BUGFIX 2026-06-21: when we CAN scope by entity (sourceId prefix), the
      // reset footprint is (organization + entity + year) — the `source` tag must
      // NOT constrain it. The SAME entity's CF for a year can have been loaded
      // under a DIFFERENT source tag (historical loader uses
      // 'workbook-cf-historical', the reporting-pack re-import uses 'workbook-cf').
      // Constraining the archive by the current `sourceTag` left the other-tag
      // rows live, so the re-import's insert DOUBLED the entity's CF. Drop the
      // source constraint when entity-scoped; keep it ONLY for the legacy
      // single-entity fallback (no entityCode), where it is the only safe scope.
      const resetSourceScope = hasEntityScope ? {} : { source: plan.sourceTag }
      // Collateral-deletion guard: count live rows within THIS import's own
      // footprint (the source + entity prefixes the INSERTED rows carry)
      // before archiving. The footprint IS source + entityScope (companyId OR
      // sourceId prefix, 2026-06-23) + year — the SAME scope the archive uses.
      // If a future edit drops entityScope from the archive WHERE, archived
      // would exceed this count and the guard trips (the 2026-05-31 sibling-
      // entity wipe regressing).
      const footprintLiveCount = await tx.cashFlowEntry.count({
        where: {
          organizationId: plan.organizationId,
          ...resetSourceScope,
          ...entityScope,
          deletedAt: null,
          ...yearFilter,
        },
      })
      if (plan.purgeArchivedFirst) {
        const purgeResult = await tx.cashFlowEntry.deleteMany({
          where: {
            organizationId: plan.organizationId,
            ...resetSourceScope,
            ...entityScope,
            deletedAt: { not: null },
            ...yearFilter,
          },
        })
        purged = purgeResult.count
      }
      const stamp = archiveStamp(plan.actorUserId)
      const archiveResult = await tx.cashFlowEntry.updateMany({
        where: {
          organizationId: plan.organizationId,
          ...resetSourceScope,
          ...entityScope,
          deletedAt: null,
          ...yearFilter,
        },
        data: stamp as unknown as Prisma.CashFlowEntryUpdateManyMutationInput,
      })
      archived = archiveResult.count
      assertNoCollateralDeletion({
        table: "CashFlowEntry",
        archivedCount: archived,
        footprintLiveCount,
        footprint: hasEntityScope
          ? `entities=[${entityPrefixes.join(",")}] (any source)`
          : `source=${plan.sourceTag}`,
      })
      log.info("archive phase", { archived, purged })
      if (archived > 0 && plan.rows.length > 0 && archived > plan.rows.length * 1.2) {
        log.warn("archive/insert mismatch — check sourceTag is entity-specific", {
          archived,
          inserting: plan.rows.length,
          ratio: Number((archived / plan.rows.length).toFixed(1)),
          sourceTag: plan.sourceTag,
        })
      }

      // companyId resolved above (reused from the reset scope) — populate it so
      // CF is per-company-scoped like BalanceSheetLine; unresolved → null.
      const payload = plan.rows.map((r) => ({
        organizationId: plan.organizationId,
        year: r.year,
        month: r.month,
        entryType: r.entryType,
        source: r.source,
        sourceId: r.sourceId,
        amount: r.amount,
        currencyCode: r.currencyCode,
        description: r.description,
        isProjected: false,
        activityType: r.activityType,
        // Phase 2.1 session 3: `category` String dropped from
        // CashFlowEntry; `accountId` is required NOT NULL.
        accountId: r.accountId,
        companyId: companyByCode.get(r.entityCode) ?? null,
      }))
      let inserted = 0
      if (payload.length > 0) {
        const result = await tx.cashFlowEntry.createMany({ data: payload })
        inserted = result.count
      }
      log.info("insert phase", { inserted })
      return { resetArchived: archived, resetPurged: purged, rowsInserted: inserted }
  }
  const { resetArchived, resetPurged, rowsInserted } = isOuterTx
    ? await writePhase(dbHandle as Prisma.TransactionClient)
    : await (prismaOrTx as PrismaClient).$transaction(writePhase)

  const actualSums = opts.readActualSums
    ? await opts.readActualSums(dbHandle, {
        organizationId: plan.organizationId,
        sourceTag: plan.sourceTag,
        periodScope: plan.periodScope,
      })
    : await defaultReadActualCfSums(dbHandle, plan)

  const reconciliation = reconcile(
    plan.expectedSums,
    actualSums,
    plan.reconciliationOptions,
  )

  const finishedAt = new Date()
  return {
    batchId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    plan: {
      label: plan.label,
      sourceDocument: plan.sourceDocument,
      sourceTag: plan.sourceTag,
      periodScope: plan.periodScope,
    },
    metrics: {
      resetArchived,
      resetPurged,
      rowsInserted,
    },
    reconciliation,
  }
}

async function defaultReadActualCfSums(
  prisma: PrismaClient | Prisma.TransactionClient,
  plan: CfImportPlan,
): Promise<Map<ReconciliationKey, number>> {
  const yearScope = Array.from(
    new Set(
      plan.periodScope
        .map((p) => Number(p.slice(0, 4)))
        .filter((n) => Number.isFinite(n)),
    ),
  )
  // Match the reset scope (entity-aware, 2026-05-31 bugfix): read only THIS
  // batch's entities, else siblings on the same shared sourceTag inflate the
  // actual sums with extra recon keys once the reset no longer cross-deletes.
  const entityPrefixes = [
    ...new Set(plan.rows.map((r) => r.entityCode).filter(Boolean)),
  ]
  const entityScope =
    entityPrefixes.length > 0
      ? { OR: entityPrefixes.map((e) => ({ sourceId: { startsWith: `${e}::` } })) }
      : {}
  const rows = await prisma.cashFlowEntry.findMany({
    where: {
      organizationId: plan.organizationId,
      source: plan.sourceTag,
      ...entityScope,
      deletedAt: null,
      ...(yearScope.length > 0 ? { year: { in: yearScope } } : {}),
    },
    select: {
      // Phase 2.1 session 3 dropped `CashFlowEntry.category`; this recon
      // read selected it but never used it (the key below is built from
      // `sourceId`). Selecting a non-existent column threw a Prisma
      // runtime error on every real CF apply — only reached on --apply,
      // so dry-run + mocked unit tests never caught it (2026-05-30).
      sourceId: true,
      year: true,
      month: true,
      amount: true,
    },
  })

  const out = new Map<ReconciliationKey, number>()
  for (const r of rows) {
    const period = `${r.year}-${String(r.month).padStart(2, "0")}`
    if (
      plan.periodScope.length > 0 &&
      !plan.periodScope.includes(period)
    ) {
      continue
    }
    // Recon key mirrors the parser: source::entity::cfCode::period.
    // sourceId is "<entity>::<cfCode>", so reuse it directly.
    const key = buildReconKey(plan.sourceTag, r.sourceId ?? "", period)
    out.set(key, (out.get(key) ?? 0) + r.amount)
  }
  return out
}
