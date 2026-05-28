/**
 * Phase 7.M Step 6 (Option B-lean, 2026-05-19) — atomic import-batch
 * orchestrator.
 *
 * Why this file exists
 * ────────────────────
 * Finance trust requires a single, observable, all-or-nothing import
 * operation. `runImportBatch` is that operation:
 *
 *   1. RESET   — archive existing rows in scope (soft-delete with
 *                deletedBy = the user that initiated the import).
 *   2. WRITE   — insert the new parsed rows in one Prisma transaction.
 *                Either all rows land or none do; a mid-write failure
 *                rolls back to the pre-reset state via the same TX.
 *   3. RECOMPUTE — fire forced recompute for every (entity × period)
 *                  touched by the new rows. Skipping this would leave
 *                  IndicatorValue rows stale, and the HeatMap would
 *                  show pre-import values while the underlying lines
 *                  reflected the new file. ALWAYS run after a write.
 *   4. RECONCILE — compare the parser's expected sums against actual
 *                  DB sums (the same rows we just wrote, joined back
 *                  through the read-side `EXCLUDE_DELETED` filter so
 *                  any soft-delete leak is observable). Produce a
 *                  green/yellow/red verdict.
 *
 * The function returns a single `ImportBatchResult` with per-phase
 * metrics so the caller (CLI tool, admin page, etc.) can render a
 * receipt. Nothing here is UI — the receipt is plain data, formatters
 * live in the consumer.
 *
 * Design choices
 * ──────────────
 * • Stateless. Caller provides a typed `ImportBatchPlan` (entity scope
 *   + parsed rows + expected sums); we do not parse xlsx in this
 *   module. Adapters (`azseker-workbook-bs.ts`, etc.) own parsing.
 *
 * • All-or-nothing semantics. The RESET + WRITE happen in one
 *   `prisma.$transaction` so a parse-error mid-import doesn't leave
 *   half-archived state. RECOMPUTE + RECONCILE happen AFTER the TX
 *   commits — they are observations, not mutations.
 *
 * • Provenance. Each written row carries `sourceDocument` (filename +
 *   sheet + cell range) and `importBatchId` (CUID). The schema fields
 *   already exist for IV and BudgetLine; the wrapper just populates
 *   them.
 *
 * • Reconciliation is mandatory. There is no `skipReconcile` opt.
 *   Finance trust depends on this layer running every time.
 *
 * • Hard-delete option for true re-import. By default rows are soft-
 *   deleted (deletedAt set) so the user can restore. Set
 *   `purgeArchivedFirst=true` to physically remove any previously-
 *   archived rows in scope BEFORE the new write — this prevents an
 *   accumulating tail of archived versions and is required for the
 *   "bit-perfect reset & re-upload" workflow finance asked for.
 */
import type { PrismaClient, Prisma } from "@prisma/client"
import { archiveStamp } from "@/lib/server/soft-delete"
import { getLogger } from "@/lib/log"
import {
  reconcile,
  buildReconKey,
  type ReconciliationKey,
  type ReconciliationReport,
  type ReconciliationOptions,
} from "./reconciliation"

const logger = getLogger("lib:import-batch")

/**
 * The minimal shape of a budget-line row we expect from the parsing
 * layer. Adapter writers can extend this if they need extra columns,
 * but the wrapper only requires these four for the reset/write/
 * reconcile round-trip. Currency / exchangeRate flow through verbatim
 * to preserve the "no in-place math" guarantee.
 */
export interface ImportBatchRow {
  companyId: string
  /**
   * Phase 2.1 session 3 (2026-05-26) — `category` String field on the
   * row carries a free-form display label used by orchestrator's
   * reconciliation keys. NOT written to BudgetLine.category (column
   * dropped); kept here only because adapters group expectedSums by
   * this composite string.
   */
  category: string
  lineType: string
  period: string
  monthIndex: number | null
  plannedAmount: number
  currencyCode: string | null
  exchangeRate: number | null
  planId: string
  /**
   * Phase 2.1 session 3 — accountId is REQUIRED. AI Auto Import
   * handlers resolve it via `resolveOrCreateAccountId` inside applyToDb
   * before passing rows to runImportBatch. Legacy NULL path removed
   * (column is NOT NULL since 20260526100000 migration).
   */
  accountId: string
  /** Free-form provenance — typically `Filename.xlsx#Sheet!A1:F123`. */
  sourceCell: string
}

export interface ImportBatchPlan {
  organizationId: string
  /** Display label for audit. Free-form, e.g. "Workbook Fin AZSEKER reset". */
  label: string
  /** Triggering user. Recorded as `deletedBy` on archived rows AND on
   *  the audit-event entry written by `auditEvent` (caller's job). */
  actorUserId: string
  /** What was uploaded. Filename + size, NOT the bytes. */
  sourceDocument: string
  /** Companies in scope for the reset. Rows on these company IDs and
   *  matching `periodScope` will be soft-archived. */
  companyIds: ReadonlyArray<string>
  /** Period strings in scope, e.g. `["2026-01","2026-02",...,"2026"]`.
   *  Empty array = archive ALL periods for the given companies (use
   *  with caution; intended for a clean full re-import). */
  periodScope: ReadonlyArray<string>
  /** Parsed rows ready to insert. */
  rows: ReadonlyArray<ImportBatchRow>
  /** Map<key, expectedSum> built by the parser as it walks the file. */
  expectedSums: ReadonlyMap<ReconciliationKey, number>
  /** When true, hard-DELETE archived rows in scope BEFORE writing
   *  (true reset). When false (default), keep them soft-deleted so
   *  restore is possible. */
  purgeArchivedFirst?: boolean
  /** Pass-through tolerance / yellow threshold for `reconcile`. */
  reconciliationOptions?: ReconciliationOptions
}

export interface ImportBatchPhaseMetrics {
  resetArchived: number
  resetPurged: number
  rowsInserted: number
  recomputedIvCount: number
}

export interface ImportBatchResult {
  batchId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  plan: {
    label: string
    sourceDocument: string
    companyIds: ReadonlyArray<string>
    periodScope: ReadonlyArray<string>
  }
  metrics: ImportBatchPhaseMetrics
  reconciliation: ReconciliationReport
}

/**
 * Run the four-phase import batch. The function never throws on a
 * recompute or reconcile failure — it captures the failure in the
 * result so the audit trail is intact. ONLY a write-phase exception
 * propagates (because the transaction has already rolled back; the
 * caller needs to know the import did not happen).
 */
export async function runImportBatch(
  /**
   * Either a full PrismaClient (legacy single-file path — opens own
   * transaction) OR a Prisma.TransactionClient (Phase 7.M Tier 5
   * multi-file orchestrator path — caller already owns the outer
   * transaction). Detected at runtime via `$transaction` method
   * presence (TransactionClient cannot nest, lacks the method).
   */
  prismaOrTx: PrismaClient | Prisma.TransactionClient,
  plan: ImportBatchPlan,
  opts: {
    /** Forced-recompute hook — caller provides the function so this
     *  module stays decoupled from the recompute pipeline. Receives
     *  affected (orgId, companyId, period) triples; returns count of
     *  IV rows recomputed. */
    recompute?: (input: {
      organizationId: string
      affected: ReadonlyArray<{ companyId: string; period: string }>
    }) => Promise<number>
    /** Reconciliation hook — caller provides the DB read for the
     *  `actualSums` side. Default reads via `prisma.budgetLine.groupBy`
     *  with `EXCLUDE_DELETED`. Tests pass a synthetic implementation.
     *  The signature accepts a tx-or-client so it can read uncommitted
     *  writes when called inside an outer transaction. */
    readActualSums?: (
      prismaClient: PrismaClient | Prisma.TransactionClient,
      input: {
        organizationId: string
        companyIds: ReadonlyArray<string>
        periodScope: ReadonlyArray<string>
      },
    ) => Promise<Map<ReconciliationKey, number>>
    /** Override the batch id (test seam). */
    batchIdFactory?: () => string
  } = {},
): Promise<ImportBatchResult> {
  // Detect mode: PrismaClient has $transaction; TransactionClient doesn't.
  const isOuterTx =
    typeof (prismaOrTx as PrismaClient).$transaction !== "function"
  // For reconciliation reads + default-read fallback, use the
  // tx-or-client directly. When inside an outer tx, this gives us
  // snapshot-isolation visibility into our own uncommitted writes.
  const dbHandle = prismaOrTx as PrismaClient & Prisma.TransactionClient
  const startedAt = new Date()
  const batchId =
    opts.batchIdFactory?.() ??
    `batch_${startedAt.toISOString().replace(/[:.]/g, "-")}_${Math.random().toString(36).slice(2, 10)}`

  // ── Phase 1+2: reset & write inside a single transaction ───────
  // The TX scope guarantees that a write-side failure rolls the
  // archive back too — finance never sees a half-state.
  // Phase 7.M Tier 5: when invoked with an outer tx, we DO NOT open
  // a new one — we use the caller's. This lets multi-file orchestrator
  // wrap multiple batch calls in ONE atomic group commit.
  const planIds = Array.from(new Set(plan.rows.map((r) => r.planId)))
  const writePhase = async (tx: Prisma.TransactionClient) => {
      const periodFilter =
        plan.periodScope.length > 0
          ? {
              plan: {
                year: {
                  in: Array.from(
                    new Set(
                      plan.periodScope
                        .map((p) => Number(p.slice(0, 4)))
                        .filter((n) => Number.isFinite(n)),
                    ),
                  ),
                },
              },
            }
          : {}

      let archived = 0
      let purged = 0
      if (plan.purgeArchivedFirst) {
        // Hard-delete previously soft-archived rows in scope.
        const purgeResult = await tx.budgetLine.deleteMany({
          where: {
            organizationId: plan.organizationId,
            companyId: { in: [...plan.companyIds] },
            deletedAt: { not: null },
            ...periodFilter,
          },
        })
        purged = purgeResult.count
      }
      // Soft-archive currently-live rows in scope.
      const stamp = archiveStamp(plan.actorUserId)
      const archiveResult = await tx.budgetLine.updateMany({
        where: {
          organizationId: plan.organizationId,
          companyId: { in: [...plan.companyIds] },
          deletedAt: null,
          ...periodFilter,
        },
        data: stamp as unknown as Prisma.BudgetLineUpdateManyMutationInput,
      })
      archived = archiveResult.count

      // Insert new rows. `createMany` is one round-trip per chunk; a
      // failure mid-chunk rolls back via the surrounding TX.
      // Phase 2.1 session 3: `category` String dropped from BudgetLine
      // schema; `accountId` is required NOT NULL.
      const payload = plan.rows.map((r) => ({
        organizationId: plan.organizationId,
        planId: r.planId,
        companyId: r.companyId,
        lineType: r.lineType,
        plannedAmount: r.plannedAmount,
        currencyCode: r.currencyCode,
        exchangeRate: r.exchangeRate,
        monthIndex: r.monthIndex,
        accountId: r.accountId,
        sourceDocument: r.sourceCell,
      }))
      let inserted = 0
      if (payload.length > 0) {
        const result = await tx.budgetLine.createMany({ data: payload })
        inserted = result.count
      }
      // Touch plans to ensure updatedAt bumps — useful for cache busts.
      if (planIds.length > 0) {
        await tx.budgetPlan.updateMany({
          where: { id: { in: planIds } },
          data: { updatedAt: new Date() },
        })
      }

      return { resetArchived: archived, resetPurged: purged, rowsInserted: inserted }
  }
  // Execute write phase either via existing outer tx or new one.
  const { resetArchived, resetPurged, rowsInserted } = isOuterTx
    ? await writePhase(dbHandle as Prisma.TransactionClient)
    : await (prismaOrTx as PrismaClient).$transaction(writePhase)

  // ── Phase 3: recompute IVs touched by the new rows ─────────────
  let recomputedIvCount = 0
  if (opts.recompute) {
    const affected: Array<{ companyId: string; period: string }> = []
    const seen = new Set<string>()
    for (const r of plan.rows) {
      const k = `${r.companyId}::${r.period}`
      if (seen.has(k)) continue
      seen.add(k)
      affected.push({ companyId: r.companyId, period: r.period })
    }
    try {
      recomputedIvCount = await opts.recompute({
        organizationId: plan.organizationId,
        affected,
      })
    } catch (err) {
      // Recompute failure is observable, not fatal. The write already
      // landed; finance can re-trigger recompute manually if needed.
      logger.error("recompute failed (non-fatal)", {
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // ── Phase 4: reconcile expected vs actual sums ─────────────────
  // Use dbHandle so reconciliation observes uncommitted writes when
  // running inside an outer transaction (Phase 7.M Tier 5 multi-file
  // path); otherwise it reads committed data via the PrismaClient.
  const actualSums = opts.readActualSums
    ? await opts.readActualSums(dbHandle, {
        organizationId: plan.organizationId,
        companyIds: plan.companyIds,
        periodScope: plan.periodScope,
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
      companyIds: plan.companyIds,
      periodScope: plan.periodScope,
    },
    metrics: {
      resetArchived,
      resetPurged,
      rowsInserted,
      recomputedIvCount,
    },
    reconciliation,
  }
}

/**
 * Default `readActualSums` implementation: queries budget_lines with
 * the standard soft-delete filter, groups by (companyId, category,
 * period via planId→budgetPlan.year/month) and rolls plannedAmount
 * into the reconciliation key. Callers in tests typically supply a
 * synthetic map instead.
 */
async function defaultReadActualSums(
  prisma: PrismaClient | Prisma.TransactionClient,
  plan: ImportBatchPlan,
): Promise<Map<ReconciliationKey, number>> {
  const rows = await prisma.budgetLine.findMany({
    where: {
      organizationId: plan.organizationId,
      companyId: { in: [...plan.companyIds] },
      deletedAt: null,
    },
    select: {
      companyId: true,
      plannedAmount: true,
      monthIndex: true,
      plan: { select: { year: true } },
      account: { select: { code: true } },
    },
  })
  // We need entity CODE for the key but the rows carry companyId. Pull
  // the code map once.
  const companies = await prisma.company.findMany({
    where: {
      organizationId: plan.organizationId,
      id: { in: [...plan.companyIds] },
    },
    select: { id: true, code: true },
  })
  const codeById = new Map(companies.map((c) => [c.id, c.code]))

  const out = new Map<ReconciliationKey, number>()
  for (const r of rows) {
    if (!r.companyId) continue
    const code = codeById.get(r.companyId)
    if (!code) continue
    const period =
      r.monthIndex !== null && r.monthIndex !== undefined
        ? `${r.plan.year}-${String(r.monthIndex + 1).padStart(2, "0")}`
        : String(r.plan.year)
    if (
      plan.periodScope.length > 0 &&
      !plan.periodScope.includes(period)
    ) {
      continue
    }
    // Phase 2.1 session 3: `category` column dropped; the recon key
    // middle component is the raw account.code (PLF handler now writes
    // the same value into ImportBatchRow.category — see Phase 2.1
    // session 3 handler updates).
    const key = buildReconKey(code, r.account.code, period)
    out.set(key, (out.get(key) ?? 0) + r.plannedAmount)
  }
  return out
}
