/**
 * Phase 7.M Step 6 (2026-05-19) — atomic OperationalFact import-batch
 * orchestrator. Third sister of `runImportBatch` + `runBalanceSheetBatch`.
 *
 * Schema differences vs P&L / BS
 * ──────────────────────────────
 *  • Target table: `operational_facts` (companyId-scoped, no plan).
 *  • Row identity: (companyId, date, metric). The unique index is on
 *    (companyId, date, metric) — re-import without a reset would
 *    succeed on `createMany` only if every row is brand-new.
 *  • No soft-delete column on this table. Resets are HARD deletes,
 *    which is acceptable because operational facts are reproducible
 *    from xlsx + manual entry; no IFRS retention applies.
 *  • Period semantic differs: facts are timestamped at the day grain,
 *    not month. The recon key uses ISO date (`YYYY-MM-DD`).
 *
 * 4-phase contract (same wording as siblings):
 *
 *   1. RESET     — hard-delete prior rows in scope (the operational
 *                  facts table has no `deletedAt`; soft-delete is not
 *                  defined for KPIs).
 *   2. WRITE     — insert new rows in one prisma.$transaction.
 *   3. RECOMPUTE — optional hook (KPIs feed industry-specific
 *                  indicators via the `operationalFact` resolver).
 *   4. RECONCILE — file vs DB sums per `${companyId}::${metric}::${date}`.
 */
import type { PrismaClient, Prisma } from "@prisma/client"
import { assertNoCollateralDeletion } from "./collateral-guard"
import {
  reconcile,
  buildReconKey,
  type ReconciliationKey,
  type ReconciliationReport,
  type ReconciliationOptions,
} from "./reconciliation"

export interface KpiImportRow {
  companyId: string
  metric: string
  /** ISO `YYYY-MM-DD`. */
  date: string
  value: number
  unit: string | null
  source: string
}

export interface KpiImportPlan {
  organizationId: string
  label: string
  actorUserId: string
  sourceDocument: string
  companyIds: ReadonlyArray<string>
  /** ISO date strings or year prefixes to reset. Empty = reset ALL
   *  for the given companies. */
  dateScope: ReadonlyArray<string>
  rows: ReadonlyArray<KpiImportRow>
  expectedSums: ReadonlyMap<ReconciliationKey, number>
  reconciliationOptions?: ReconciliationOptions
}

export interface KpiImportPhaseMetrics {
  resetDeleted: number
  rowsInserted: number
}

export interface KpiImportResult {
  batchId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  plan: {
    label: string
    sourceDocument: string
    companyIds: ReadonlyArray<string>
    dateScope: ReadonlyArray<string>
  }
  metrics: KpiImportPhaseMetrics
  reconciliation: ReconciliationReport
}

export async function runKpiBatch(
  /**
   * Phase 7.M Tier 5 — accepts PrismaClient (legacy single-file path:
   * opens own tx) OR Prisma.TransactionClient (multi-file orchestrator
   * path: caller-managed outer tx). Detected at runtime via
   * `$transaction` method presence.
   */
  prismaOrTx: PrismaClient | Prisma.TransactionClient,
  plan: KpiImportPlan,
  opts: {
    readActualSums?: (
      prismaClient: PrismaClient | Prisma.TransactionClient,
      input: {
        organizationId: string
        companyIds: ReadonlyArray<string>
        dateScope: ReadonlyArray<string>
      },
    ) => Promise<Map<ReconciliationKey, number>>
    batchIdFactory?: () => string
  } = {},
): Promise<KpiImportResult> {
  const isOuterTx =
    typeof (prismaOrTx as PrismaClient).$transaction !== "function"
  const dbHandle = prismaOrTx as PrismaClient & Prisma.TransactionClient
  const startedAt = new Date()
  const batchId =
    opts.batchIdFactory?.() ??
    `kpi_batch_${startedAt.toISOString().replace(/[:.]/g, "-")}_${Math.random().toString(36).slice(2, 10)}`

  // Resolve date scope to a {gte, lte} window when callers pass year
  // prefixes (e.g. ["2026"]) so the reset only touches the right year.
  const yearScope = Array.from(
    new Set(
      plan.dateScope
        .filter((d) => /^\d{4}$/.test(d))
        .map((d) => Number(d))
        .filter((n) => Number.isFinite(n)),
    ),
  )
  const explicitDates = plan.dateScope.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))

  // Date sub-filter, shared by the reset delete, the collateral-guard
  // footprint count, and the reconciliation read so all three agree.
  const dateFilter: Record<string, unknown> = {}
  if (yearScope.length > 0) {
    const min = new Date(Date.UTC(Math.min(...yearScope), 0, 1))
    const max = new Date(Date.UTC(Math.max(...yearScope) + 1, 0, 1) - 1)
    dateFilter.date = { gte: min, lte: max }
  } else if (explicitDates.length > 0) {
    dateFilter.date = { in: explicitDates.map((d) => new Date(d)) }
  }

  // 2026-06-16 fix — scope the HARD delete to the metrics this import
  // actually writes. Previously the reset deleted EVERY metric for the
  // company in the date window, so re-importing one KPI (e.g. sugar
  // output) silently wiped the company's OTHER metrics in that window —
  // and OperationalFact has NO soft-delete, so the loss is irreversible.
  // Deriving the metric scope from the rows also makes a zero-row parse a
  // no-op (`metric: { in: [] }` matches nothing) instead of wiping the
  // whole window with no reinsert. The company dimension is ALSO derived
  // from the rows (see the delete WHERE below) so a sibling company is
  // never touched; only the date window stays caller-controlled.
  const footprintMetrics = [...new Set(plan.rows.map((r) => r.metric))]
  const footprintCompanyIds = [...new Set(plan.rows.map((r) => r.companyId))]

  const writePhase = async (tx: Prisma.TransactionClient) => {
      // derive-delete-from-write: company + metric scopes come from the
      // INSERTED rows (footprintCompanyIds / footprintMetrics), NOT caller
      // `plan.companyIds` — so re-importing one company's KPIs can't wipe a
      // sibling company's facts. The DATE window stays caller-controlled via
      // `dateFilter`: a KPI re-import may intentionally do a FULL-YEAR reset
      // even from partial rows (incomplete-year data), so deriving the date
      // from rows would silently break that semantic. Do NOT "complete the
      // refactor" by deriving date here.
      const filter: Record<string, unknown> = {
        organizationId: plan.organizationId,
        companyId: { in: footprintCompanyIds },
        metric: { in: footprintMetrics },
        ...dateFilter,
      }
      // Collateral-deletion guard: count facts within THIS import's own
      // footprint (rows' own companies × metrics × dates) before deleting.
      const footprintLiveCount =
        footprintMetrics.length === 0 || footprintCompanyIds.length === 0
          ? 0
          : await tx.operationalFact.count({
              where: {
                organizationId: plan.organizationId,
                companyId: { in: footprintCompanyIds },
                metric: { in: footprintMetrics },
                ...dateFilter,
              },
            })
      const del = await tx.operationalFact.deleteMany({ where: filter })
      assertNoCollateralDeletion({
        table: "OperationalFact",
        archivedCount: del.count,
        footprintLiveCount,
        footprint: `companies=[${footprintCompanyIds.join(",")}] metrics=[${footprintMetrics.join(",")}]`,
      })

      const payload = plan.rows.map((r) => ({
        organizationId: plan.organizationId,
        companyId: r.companyId,
        metric: r.metric,
        date: new Date(r.date),
        value: r.value,
        unit: r.unit,
        source: r.source,
      }))
      let inserted = 0
      if (payload.length > 0) {
        const result = await tx.operationalFact.createMany({ data: payload })
        inserted = result.count
      }
      return { resetDeleted: del.count, rowsInserted: inserted }
  }
  const { resetDeleted, rowsInserted } = isOuterTx
    ? await writePhase(dbHandle as Prisma.TransactionClient)
    : await (prismaOrTx as PrismaClient).$transaction(writePhase)

  const actualSums = opts.readActualSums
    ? await opts.readActualSums(dbHandle, {
        organizationId: plan.organizationId,
        companyIds: plan.companyIds,
        dateScope: plan.dateScope,
      })
    : await defaultReadActualKpiSums(dbHandle, plan)

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
      companyIds: plan.companyIds,
      dateScope: plan.dateScope,
    },
    metrics: {
      resetDeleted,
      rowsInserted,
    },
    reconciliation,
  }
}

async function defaultReadActualKpiSums(
  prisma: PrismaClient | Prisma.TransactionClient,
  plan: KpiImportPlan,
): Promise<Map<ReconciliationKey, number>> {
  const yearScope = Array.from(
    new Set(
      plan.dateScope
        .filter((d) => /^\d{4}$/.test(d))
        .map((d) => Number(d))
        .filter((n) => Number.isFinite(n)),
    ),
  )
  // Scope the read to the companies AND metrics this import wrote (rows'
  // footprint), matching the derive-delete-from-write delete scope —
  // otherwise a sibling company/metric in the same date window reads back
  // as "extra" and falsely fails reconciliation (it is not part of this
  // import).
  const footprintMetrics = [...new Set(plan.rows.map((r) => r.metric))]
  const footprintCompanyIds = [...new Set(plan.rows.map((r) => r.companyId))]
  const filter: Record<string, unknown> = {
    organizationId: plan.organizationId,
    companyId: { in: footprintCompanyIds },
    metric: { in: footprintMetrics },
  }
  if (yearScope.length > 0) {
    const min = new Date(Date.UTC(Math.min(...yearScope), 0, 1))
    const max = new Date(Date.UTC(Math.max(...yearScope) + 1, 0, 1) - 1)
    filter.date = { gte: min, lte: max }
  }
  const rows = await prisma.operationalFact.findMany({
    where: filter,
    select: { companyId: true, metric: true, date: true, value: true },
  })
  const out = new Map<ReconciliationKey, number>()
  for (const r of rows) {
    const dateIso = r.date.toISOString().slice(0, 10)
    const key = buildReconKey(r.companyId, r.metric, dateIso)
    out.set(key, (out.get(key) ?? 0) + r.value)
  }
  return out
}
