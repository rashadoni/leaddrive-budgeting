/**
 * Phase 7.M Tier 7 (Phase 3, 2026-05-21) — atomic BudgetActual import-batch
 * orchestrator. Fourth sister of `runImportBatch` (PLF/BudgetLine),
 * `runBalanceSheetBatch` (BS), `runCashFlowBatch` (CF), `runKpiBatch`
 * (operational_facts).
 *
 * Schema differences vs P&L / BS / KPI
 * ────────────────────────────────────
 *  • Target table: `budget_actuals` (planId-scoped, optional companyId).
 *  • Row identity: NOT enforced by unique index — actuals are append-style
 *    transactions, multiple per (planId, category, date) are valid.
 *  • Re-import semantics: REPLACE within scope, not append. Caller passes
 *    `dateScope` (ISO YYYY-MM-DD or year prefix like "2026"); existing
 *    BudgetActual rows for (planId, dateScope) are hard-deleted before
 *    inserting the new batch. This matches Phase 7.M's "bit-perfect
 *    re-import" pattern so users don't end up with doubled actuals after
 *    a second upload of the same file.
 *  • No soft-delete column on this table. Resets are HARD deletes,
 *    acceptable because actuals are reproducible from source xlsx.
 *
 * 4-phase contract (same wording as siblings):
 *
 *   1. RESET     — hard-delete prior actuals in (planId, dateScope).
 *   2. WRITE     — insert new rows in one prisma.$transaction.
 *   3. RECOMPUTE — no-op for this table (P&L recompute reads aggregated
 *                  actuals at query time; no precomputed indicators).
 *   4. RECONCILE — file vs DB sums per `${planId}::${category}::${monthIndex}`.
 */
import type { PrismaClient, Prisma } from "@prisma/client"
import {
  reconcile,
  buildReconKey,
  type ReconciliationKey,
  type ReconciliationReport,
  type ReconciliationOptions,
} from "./reconciliation"

export interface ActualsImportRow {
  category: string
  /** Always positive (caller has already taken Math.abs()). */
  amount: number
  /** ISO `YYYY-MM-DD`. */
  date: string
  /** 0-indexed month (0=Jan..11=Dec). Derived from date by caller. */
  monthIndex: number
  department: string | null
  description: string | null
  /** "expense" | "revenue" | "other". */
  lineType: string
  /** Resolved companyId (or null for org-wide actuals). */
  companyId: string | null
}

export interface ActualsImportPlan {
  organizationId: string
  planId: string
  label: string
  actorUserId: string
  sourceDocument: string
  /** ISO date strings or year prefixes to reset. Empty = no reset
   *  (append-only — caller's responsibility to avoid duplicates). */
  dateScope: ReadonlyArray<string>
  rows: ReadonlyArray<ActualsImportRow>
  expectedSums: ReadonlyMap<ReconciliationKey, number>
  reconciliationOptions?: ReconciliationOptions
}

export interface ActualsImportPhaseMetrics {
  resetDeleted: number
  rowsInserted: number
}

export interface ActualsImportResult {
  batchId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  plan: {
    label: string
    sourceDocument: string
    planId: string
    dateScope: ReadonlyArray<string>
  }
  metrics: ActualsImportPhaseMetrics
  reconciliation: ReconciliationReport
}

export async function runActualsBatch(
  /**
   * Accepts PrismaClient (legacy single-file path: opens own tx) OR
   * Prisma.TransactionClient (multi-file orchestrator path:
   * caller-managed outer tx). Detected at runtime via `$transaction`
   * method presence — same convention as runKpiBatch/runImportBatch.
   */
  prismaOrTx: PrismaClient | Prisma.TransactionClient,
  plan: ActualsImportPlan,
  opts: {
    readActualSums?: (
      prismaClient: PrismaClient | Prisma.TransactionClient,
      input: {
        organizationId: string
        planId: string
        dateScope: ReadonlyArray<string>
      },
    ) => Promise<Map<ReconciliationKey, number>>
    batchIdFactory?: () => string
  } = {},
): Promise<ActualsImportResult> {
  const isOuterTx =
    typeof (prismaOrTx as PrismaClient).$transaction !== "function"
  const dbHandle = prismaOrTx as PrismaClient & Prisma.TransactionClient
  const startedAt = new Date()
  const batchId =
    opts.batchIdFactory?.() ??
    `actuals_batch_${startedAt.toISOString().replace(/[:.]/g, "-")}_${Math.random()
      .toString(36)
      .slice(2, 10)}`

  // Resolve date scope (year prefix OR explicit ISO date) into a filter
  // used by both RESET and the default reconciliation read.
  const yearScope = Array.from(
    new Set(
      plan.dateScope
        .filter((d) => /^\d{4}$/.test(d))
        .map((d) => Number(d))
        .filter((n) => Number.isFinite(n)),
    ),
  )
  const explicitDates = plan.dateScope.filter((d) =>
    /^\d{4}-\d{2}-\d{2}$/.test(d),
  )

  const writePhase = async (tx: Prisma.TransactionClient) => {
    // 1. RESET — purge prior actuals in scope (planId + dateScope).
    // expenseDate is a STRING column ("YYYY-MM-DD") so we use `startsWith`
    // matching to filter by year/explicit date.
    const filter: Record<string, unknown> = {
      organizationId: plan.organizationId,
      planId: plan.planId,
    }
    let del = { count: 0 }
    if (yearScope.length > 0) {
      // Multiple years → OR by startsWith on each year prefix
      del = await tx.budgetActual.deleteMany({
        where: {
          ...filter,
          OR: yearScope.map((y) => ({
            expenseDate: { startsWith: String(y) },
          })),
        },
      })
    } else if (explicitDates.length > 0) {
      del = await tx.budgetActual.deleteMany({
        where: { ...filter, expenseDate: { in: explicitDates } },
      })
    }
    // No dateScope → no reset (append semantics for caller-controlled flows)

    // 2. WRITE — bulk insert new rows
    const payload = plan.rows.map((r) => ({
      organizationId: plan.organizationId,
      planId: plan.planId,
      category: r.category,
      department: r.department,
      lineType: r.lineType,
      actualAmount: r.amount,
      expenseDate: r.date,
      monthIndex: r.monthIndex,
      description: r.description,
      companyId: r.companyId,
    }))
    let inserted = 0
    if (payload.length > 0) {
      const result = await tx.budgetActual.createMany({ data: payload })
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
        planId: plan.planId,
        dateScope: plan.dateScope,
      })
    : await defaultReadActualSums(dbHandle, plan)

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
      planId: plan.planId,
      dateScope: plan.dateScope,
    },
    metrics: {
      resetDeleted,
      rowsInserted,
    },
    reconciliation,
  }
}

async function defaultReadActualSums(
  prisma: PrismaClient | Prisma.TransactionClient,
  plan: ActualsImportPlan,
): Promise<Map<ReconciliationKey, number>> {
  const yearScope = Array.from(
    new Set(
      plan.dateScope
        .filter((d) => /^\d{4}$/.test(d))
        .map((d) => Number(d))
        .filter((n) => Number.isFinite(n)),
    ),
  )
  const filter: Record<string, unknown> = {
    organizationId: plan.organizationId,
    planId: plan.planId,
  }
  if (yearScope.length > 0) {
    Object.assign(filter, {
      OR: yearScope.map((y) => ({
        expenseDate: { startsWith: String(y) },
      })),
    })
  }
  const rows = await prisma.budgetActual.findMany({
    where: filter,
    select: {
      category: true,
      monthIndex: true,
      actualAmount: true,
    },
  })
  const out = new Map<ReconciliationKey, number>()
  for (const r of rows) {
    if (r.monthIndex == null) continue
    const key = buildReconKey(plan.planId, r.category, String(r.monthIndex))
    out.set(key, (out.get(key) ?? 0) + r.actualAmount)
  }
  return out
}
