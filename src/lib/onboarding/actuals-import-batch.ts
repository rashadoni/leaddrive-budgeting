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
 *    BudgetActual rows for (planId, dateScope, **companies this batch
 *    writes**) are hard-deleted before inserting the new batch. This matches
 *    Phase 7.M's "bit-perfect re-import" pattern so users don't end up with
 *    doubled actuals after a second upload of the same file.
 *  • No soft-delete column on this table. Resets are HARD deletes — which is
 *    exactly why the company dimension of the reset scope is DERIVED FROM THE
 *    INSERTED ROWS (Phase 11.1, 2026-07-29). Until then the reset was
 *    (organizationId, planId)-only and one company's sheet irreversibly wiped
 *    every sibling company's actuals for the year. See the long note at the
 *    RESET phase below before touching the WHERE clauses.
 *
 * KNOWN GAP (Phase 11.1b, tracked in docs/ROADMAP.md): two BUDGET_ACTUALS
 * sheets for the SAME company and year inside one workbook still clobber each
 * other — they run sequentially in one transaction and the second sheet's
 * reset removes the first sheet's inserts. Company scoping cannot fix that;
 * it needs a per-sheet ownership key (a `source` column on BudgetActual) or
 * an orchestrator-level once-per-scope purge.
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
import { assertNoCollateralDeletion } from "./collateral-guard"
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

  // 2026-07-29 (Phase 11.1) derive-delete-from-write — the RESET scope's
  // COMPANY dimension is derived from the identity the INSERTED rows actually
  // carry, not from the caller's plan. Before this, the reset filtered on
  // (organizationId, planId) ONLY: since the plan is one row per
  // (org, year, kind) for the WHOLE organization, importing one company's
  // actuals sheet hard-deleted every OTHER company's actuals for that year —
  // plus rows entered by hand, by auto-sync and by snapshot. `BudgetActual`
  // has no `deletedAt`, so that loss is IRREVERSIBLE (unlike the BudgetLine /
  // BalanceSheetLine / CashFlowEntry siblings, which soft-archive).
  //
  // The DATE window stays caller-controlled via `dateScope` — an actuals
  // re-import may intentionally do a FULL-YEAR reset from partial rows
  // (incomplete-year data), so deriving the date from rows would silently
  // break that semantic. Same reasoning as kpi-import-batch.ts:146-154 — do
  // NOT "complete the refactor" by deriving the date here.
  //
  // `companyId: null` is a LEGITIMATE footprint member, not an accident: the
  // row type allows org-wide actuals. A batch that writes null rows therefore
  // owns — and may reset — the null bucket. Caveat worth knowing: the AI
  // handler also falls back to null when a sheet's companyCode fails to
  // resolve (production-adapter-handlers-soft.ts:718-728), so an unresolved
  // code lands in the org-wide bucket rather than failing loudly. That gap is
  // entity resolution's to close (Phase 11.11), not the reset's.
  const footprintCompanyIds = [...new Set(plan.rows.map((r) => r.companyId))]
  const footprintNamedCompanyIds = footprintCompanyIds.filter(
    (c): c is string => c !== null,
  )
  const footprintHasOrgWide = footprintCompanyIds.includes(null)

  /**
   * WHERE fragment matching exactly the companies this batch writes.
   * Empty footprint → `{ in: [] }` matches nothing, so a zero-row parse is a
   * no-op instead of a delete-without-reinsert.
   */
  const companyScope = (): Prisma.BudgetActualWhereInput => {
    if (footprintCompanyIds.length === 0) return { companyId: { in: [] } }
    if (!footprintHasOrgWide) {
      return { companyId: { in: footprintNamedCompanyIds } }
    }
    if (footprintNamedCompanyIds.length === 0) return { companyId: null }
    return {
      OR: [
        { companyId: { in: footprintNamedCompanyIds } },
        { companyId: null },
      ],
    }
  }

  /**
   * WHERE fragment for the caller-controlled date window, or null when
   * `dateScope` is empty (append semantics — no reset at all).
   * `expenseDate` is a STRING column ("YYYY-MM-DD"), hence `startsWith`.
   */
  const dateScopeCondition = (): Prisma.BudgetActualWhereInput | null => {
    if (yearScope.length > 0) {
      return {
        OR: yearScope.map((y) => ({
          expenseDate: { startsWith: String(y) },
        })),
      }
    }
    if (explicitDates.length > 0) {
      return { expenseDate: { in: explicitDates } }
    }
    return null
  }

  const writePhase = async (tx: Prisma.TransactionClient) => {
    // 1. RESET — purge prior actuals within THIS batch's own footprint
    // (planId + derived company scope + caller-controlled date window).
    const dateCondition = dateScopeCondition()
    let del = { count: 0 }
    if (dateCondition !== null) {
      // Composed under AND, not spread: both the date window and the company
      // scope can each be an `OR`, and two `OR` keys cannot coexist in one
      // Prisma WHERE object.
      const resetWhere: Prisma.BudgetActualWhereInput = {
        organizationId: plan.organizationId,
        planId: plan.planId,
        AND: [dateCondition, companyScope()],
      }

      // Collateral-deletion guard. The count's WHERE is written out
      // independently (NOT the same object as `resetWhere`) so that a future
      // edit to one and not the other makes the drift LOUD instead of silent.
      const footprintLiveCount =
        footprintCompanyIds.length === 0
          ? 0
          : await tx.budgetActual.count({
              where: {
                organizationId: plan.organizationId,
                planId: plan.planId,
                AND: [dateScopeCondition() ?? {}, companyScope()],
              },
            })

      del = await tx.budgetActual.deleteMany({ where: resetWhere })

      assertNoCollateralDeletion({
        table: "BudgetActual",
        archivedCount: del.count,
        footprintLiveCount,
        footprint:
          `plan=${plan.planId} companies=[${footprintNamedCompanyIds.join(",")}` +
          `${footprintHasOrgWide ? (footprintNamedCompanyIds.length ? ",<org-wide>" : "<org-wide>") : ""}] ` +
          `dates=[${plan.dateScope.join(",")}]`,
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
  // 2026-07-29 (Phase 11.1) — the read-back MUST use the same company
  // footprint as the RESET. The reconciliation key is
  // (planId, category, monthIndex) with NO company dimension, so a
  // plan-wide read would fold sibling companies' surviving rows into the
  // comparison and report a false mismatch. Before the reset was
  // company-scoped this could not happen: the plan-wide purge left only this
  // batch's rows behind.
  const namedCompanyIds = [
    ...new Set(
      plan.rows
        .map((r) => r.companyId)
        .filter((c): c is string => c !== null),
    ),
  ]
  const hasOrgWide = plan.rows.some((r) => r.companyId === null)
  const companyScope: Prisma.BudgetActualWhereInput =
    plan.rows.length === 0
      ? { companyId: { in: [] } }
      : !hasOrgWide
        ? { companyId: { in: namedCompanyIds } }
        : namedCompanyIds.length === 0
          ? { companyId: null }
          : {
              OR: [
                { companyId: { in: namedCompanyIds } },
                { companyId: null },
              ],
            }

  const filter: Prisma.BudgetActualWhereInput = {
    organizationId: plan.organizationId,
    planId: plan.planId,
    AND: [
      yearScope.length > 0
        ? {
            OR: yearScope.map((y) => ({
              expenseDate: { startsWith: String(y) },
            })),
          }
        : {},
      companyScope,
    ],
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
