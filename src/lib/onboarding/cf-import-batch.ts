/**
 * Phase 7.M Step 6 (2026-05-19) — atomic CashFlowEntry import-batch
 * orchestrator. Fourth sister of `runImportBatch` (P&L),
 * `runBalanceSheetBatch` (BS), and `runKpiBatch` (KPI).
 *
 * Schema differences vs P&L / BS / KPI
 * ────────────────────────────────────
 *  • Target table: `cash_flow_entries`. Org-scoped, NO `companyId` —
 *    a single org's CF is reported at the consolidated level.
 *    Per-entity drill-down has to flow through `category` /
 *    `accountId`, which is intentional in the existing schema.
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
  /** Human-readable category (typically `${entityCode}-${cfCode}`). */
  category: string
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
  prisma: PrismaClient,
  plan: CfImportPlan,
  opts: {
    readActualSums?: (
      prismaClient: PrismaClient,
      input: {
        organizationId: string
        sourceTag: string
        periodScope: ReadonlyArray<string>
      },
    ) => Promise<Map<ReconciliationKey, number>>
    batchIdFactory?: () => string
  } = {},
): Promise<CfImportResult> {
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

  const { resetArchived, resetPurged, rowsInserted } =
    await prisma.$transaction(async (tx) => {
      const yearFilter =
        yearScope.length > 0 ? { year: { in: yearScope } } : {}

      let archived = 0
      let purged = 0
      if (plan.purgeArchivedFirst) {
        const purgeResult = await tx.cashFlowEntry.deleteMany({
          where: {
            organizationId: plan.organizationId,
            source: plan.sourceTag,
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
          source: plan.sourceTag,
          deletedAt: null,
          ...yearFilter,
        },
        data: stamp as unknown as Prisma.CashFlowEntryUpdateManyMutationInput,
      })
      archived = archiveResult.count

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
        category: r.category,
      }))
      let inserted = 0
      if (payload.length > 0) {
        const result = await tx.cashFlowEntry.createMany({ data: payload })
        inserted = result.count
      }
      return { resetArchived: archived, resetPurged: purged, rowsInserted: inserted }
    })

  const actualSums = opts.readActualSums
    ? await opts.readActualSums(prisma, {
        organizationId: plan.organizationId,
        sourceTag: plan.sourceTag,
        periodScope: plan.periodScope,
      })
    : await defaultReadActualCfSums(prisma, plan)

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
  prisma: PrismaClient,
  plan: CfImportPlan,
): Promise<Map<ReconciliationKey, number>> {
  const yearScope = Array.from(
    new Set(
      plan.periodScope
        .map((p) => Number(p.slice(0, 4)))
        .filter((n) => Number.isFinite(n)),
    ),
  )
  const rows = await prisma.cashFlowEntry.findMany({
    where: {
      organizationId: plan.organizationId,
      source: plan.sourceTag,
      deletedAt: null,
      ...(yearScope.length > 0 ? { year: { in: yearScope } } : {}),
    },
    select: {
      sourceId: true,
      category: true,
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
