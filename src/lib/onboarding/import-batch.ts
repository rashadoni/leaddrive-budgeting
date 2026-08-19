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
import { diffImportRows, type ImportDiff } from "./import-diff"
import { assertNoCollateralDeletion } from "./collateral-guard"
import { MANUAL_CORRECTION_ORIGIN } from "@/lib/budgeting/manual-correction"
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
 * The entity slot in a reconciliation key for rows that belong to no company.
 *
 * An elimination has no entity code, and `buildReconKey` needs three
 * components. A literal that cannot collide with a real company code keeps the
 * expected and actual key spaces intersecting — which is the whole point of
 * the read-back — without inventing a pseudo-entity anywhere else.
 */
export const ELIMINATION_RECON_ENTITY = "__ELIMINATIONS__"

/**
 * The minimal shape of a budget-line row we expect from the parsing
 * layer. Adapter writers can extend this if they need extra columns,
 * but the wrapper only requires these four for the reset/write/
 * reconcile round-trip. Currency / exchangeRate flow through verbatim
 * to preserve the "no in-place math" guarantee.
 */
export interface ImportBatchRow {
  /**
   * 2026-08-18 — null ONLY on an intragroup-elimination row, which belongs to
   * no company by construction (see `isElimination`). Every other row must
   * carry one: a null company widens the clean-slate scope below to every
   * company on the plan, which is the 2026-06-11 collateral-wipe shape.
   */
  companyId: string | null
  /**
   * 2026-08-18 — an INTRAGROUP ELIMINATION row, from the `EJE` block the
   * client ships inside its own P&L sheets. It cancels revenue and cost
   * BETWEEN group members, so it is nobody's standalone result and carries no
   * `companyId`.
   *
   * Mirrors `BsImportRow.isElimination` (Phase 14.8) down to the scoping rule:
   * an elimination batch clean-slates on `isElimination: true`, which is
   * exactly as narrow as a company scope and provably disjoint from entity
   * rows. Mixing both in one batch is refused rather than resolved, because
   * the two scopes cannot be expressed at once — the splitter gives the EJE
   * block its own virtual sheet, so each gets its own batch.
   */
  isElimination?: boolean
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
  /**
   * What this run changed, measured against what was stored BEFORE the
   * clean-slate archived it.
   *
   * A row count alone cannot answer "did anything move" — it is identical
   * whether the numbers changed or not, which is how eight re-imports of the
   * same workbook in two days produced no signal at all, and how one run that
   * silently rolled back went unnoticed until someone read the Postgres
   * insert/delete counters.
   */
  diff: ImportDiff
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

      // 2026-06-16 fix — scope the clean-slate to the TARGET plan(s).
      // Previously the archive matched by org+company+year ONLY (via
      // periodFilter, which keys off the related plan's `year`), so it
      // crossed the budget/actual boundary: importing into the 2026
      // ACTUALS plan also soft-deleted the 2026 BUDGET plan's lines
      // (same company, same year). That was the root cause of the
      // 2026-06-11 budget wipe — 2700 budget lines archived as collateral
      // of an actuals import. `planIds` (line above) is the exact set of
      // plans the rows below write to; restricting the archive to it keeps
      // sibling same-year plans untouched. When planIds is empty (no rows
      // to insert) `{ in: [] }` archives nothing — which also closes the
      // delete-without-reinsert footgun.
      const planFilter = { planId: { in: planIds } }

      // Phase 13.6 (2026-08-02) — a manual correction is not this import's to
      // replace.
      //
      // The clean-slate exists so a re-import fully replaces what the PREVIOUS
      // import wrote. A row a person added — because the workbook disagreed
      // with the client's own statement and someone decided which way to fix
      // it — was never written by any import, and archiving it would silently
      // un-apply their correction on the next run of the same file. That is
      // worse than never having offered the feature: the number would quietly
      // revert to the one they already rejected.
      //
      // Applied to the purge as well as the archive. A correction that was
      // archived by an older build must not then be hard-deleted by a newer
      // one; `purgeArchivedFirst` would otherwise make the mistake permanent.
      //
      // The counterpart is in `flagCorrectionsForReview`: surviving is not the
      // same as still being right, so a correction whose (account × period)
      // this import just rewrote is FLAGGED for a human rather than kept in
      // silence.
      //
      // The OR with `null` is not defensive noise — without it this filter
      // matches NOTHING. `origin` is nullable and every imported row has it
      // NULL; in SQL `NULL <> 'manual_correction'` is UNKNOWN, not TRUE, so
      // the row is excluded. Measured on production 2026-08-03: of 5,125 live
      // rows, `origin <> 'manual_correction'` matched **0**, and
      // `origin IS NULL OR origin <> …` matched all 5,125.
      //
      // Shipped without it on 2026-08-02, which turned the clean-slate archive
      // into a no-op. The first import after that deploy failed on
      // `Unique constraint failed on (planId, sourceDocument)` — the old rows
      // were still live and the new ones collided with them. Nothing was
      // corrupted because the transaction rolled back, and because the 11.8b
      // unique index existed at all: without it every row would have been
      // inserted a SECOND time and the whole P&L would have silently doubled.
      // A control added for one reason caught a different bug.
      const notAManualCorrection = {
        OR: [{ origin: null }, { origin: { not: MANUAL_CORRECTION_ORIGIN } }],
      }

      // 2026-06-16 derive-delete-from-write — the clean-slate DELETE scope is
      // derived from the identity the INSERTED rows actually carry, NOT from
      // caller-supplied `plan.companyIds` (which can be broader and wipe
      // sibling companies). `footprintCompanyIds` = the DISTINCT companies in
      // this batch's rows; purge + archive scope to exactly that, so company-
      // dimension over-deletion is structurally impossible — the guard below
      // then holds by construction (kept as a tripwire). Empty rows →
      // `{ in: [] }` → no-op. Period/year granularity stays caller-controlled
      // via `periodFilter` (intentional full-year reset semantic); only the
      // company dimension — the over-deletion vector — is derived.
      const footprintCompanyIds = [
        ...new Set(
          plan.rows
            .map((r) => r.companyId)
            .filter((id): id is string => id !== null),
        ),
      ]

      // 2026-08-18 — the elimination batch is the one legitimate null-company
      // batch, and it gets a scope of its own rather than an exemption.
      //
      // `companyId: { in: [] }` (which is what a batch of null-company rows
      // would produce above) archives NOTHING, so an elimination re-import
      // would insert alongside the previous run's rows instead of replacing
      // them — a silently doubling group elimination, which is worse than the
      // un-eliminated total it replaced. `isElimination: true` is as narrow as
      // a company scope and disjoint from every entity row, so it replaces
      // exactly what the last elimination import wrote.
      //
      // A batch mixing both is refused, not resolved: one clean-slate cannot
      // express two disjoint scopes, and guessing which one to widen is how
      // collateral wipes happen.
      const eliminationRows = plan.rows.filter((r) => r.isElimination === true)
      const isEliminationBatch =
        eliminationRows.length > 0 && eliminationRows.length === plan.rows.length
      if (eliminationRows.length > 0 && !isEliminationBatch) {
        throw new Error(
          "[import-batch] refusing to reset: this batch mixes " +
            `${eliminationRows.length} elimination row(s) with ` +
            `${plan.rows.length - eliminationRows.length} entity row(s). An elimination ` +
            "belongs to no company, so the two cannot share one clean-slate scope. " +
            "Import the elimination block as its own sheet.",
        )
      }
      const nullCompanyRows = plan.rows.filter((r) => r.companyId === null).length
      if (nullCompanyRows > 0 && !isEliminationBatch) {
        throw new Error(
          `[import-batch] refusing to reset: ${nullCompanyRows} row(s) carry no companyId ` +
            "and are not flagged as eliminations, so the archive scope would widen to EVERY " +
            "company on this plan. Resolve the entity before importing.",
        )
      }
      /**
       * The company dimension of the clean-slate. `isElimination: false` is
       * stated beside the company filter even though it is redundant today —
       * elimination rows carry no company — so that an entity import can never
       * archive the group's eliminations if that ever stops being true.
       */
      const companyScope = isEliminationBatch
        ? { isElimination: true }
        : { companyId: { in: footprintCompanyIds }, isElimination: false }

      /**
       * Read the live rows in exactly the scope about to be archived, and
       * compare them with what is about to be written. This must happen HERE:
       * one statement earlier there is no scope to read, one later the rows
       * are gone.
       *
       * Same WHERE as the archive below, deliberately — a diff computed over a
       * different population than the one being replaced would be reassuring
       * and wrong.
       */
      const storedForDiff = await tx.budgetLine.findMany({
        where: {
          organizationId: plan.organizationId,
          ...companyScope,
          deletedAt: null,
          ...notAManualCorrection,
          ...planFilter,
          ...periodFilter,
        },
        select: { accountId: true, companyId: true, monthIndex: true, plannedAmount: true },
      })
      const diff = diffImportRows(
        storedForDiff,
        plan.rows.map((r) => ({
          accountId: r.accountId,
          companyId: r.companyId,
          monthIndex: r.monthIndex,
          plannedAmount: r.plannedAmount,
        })),
      )

      let archived = 0
      let purged = 0
      if (plan.purgeArchivedFirst) {
        // Hard-delete previously soft-archived rows in scope.
        const purgeResult = await tx.budgetLine.deleteMany({
          where: {
            organizationId: plan.organizationId,
            ...companyScope,
            deletedAt: { not: null },
            ...notAManualCorrection,
            ...planFilter,
            ...periodFilter,
          },
        })
        purged = purgeResult.count
      }
      // Collateral-deletion guard (now redundant-by-construction — kept as a
      // belt-and-suspenders tripwire): count LIVE rows within this import's
      // own footprint BEFORE archiving, independently from the archive WHERE.
      const footprintLiveCount =
        (footprintCompanyIds.length === 0 && !isEliminationBatch) ||
        planIds.length === 0
          ? 0
          : await tx.budgetLine.count({
              where: {
                organizationId: plan.organizationId,
                ...companyScope,
                planId: { in: planIds },
                deletedAt: null,
                // Excluded here too, or the tripwire below compares an archive
                // that skips corrections against a count that includes them
                // and fires on every import after the first correction.
                ...notAManualCorrection,
                ...periodFilter,
              },
            })

      // Soft-archive currently-live rows in scope.
      const stamp = archiveStamp(plan.actorUserId)
      const archiveResult = await tx.budgetLine.updateMany({
        where: {
          organizationId: plan.organizationId,
          ...companyScope,
          deletedAt: null,
          ...notAManualCorrection,
          ...planFilter,
          ...periodFilter,
        },
        data: stamp as unknown as Prisma.BudgetLineUpdateManyMutationInput,
      })
      archived = archiveResult.count
      assertNoCollateralDeletion({
        table: "BudgetLine",
        archivedCount: archived,
        footprintLiveCount,
        footprint: isEliminationBatch
          ? `plans=[${planIds.join(",")}] eliminations`
          : `plans=[${planIds.join(",")}] companies=[${footprintCompanyIds.join(",")}]`,
      })

      // Insert new rows. `createMany` is one round-trip per chunk; a
      // failure mid-chunk rolls back via the surrounding TX.
      // Phase 2.1 session 3: `category` String dropped from BudgetLine
      // schema; `accountId` is required NOT NULL.
      const payload = plan.rows.map((r) => ({
        organizationId: plan.organizationId,
        planId: r.planId,
        companyId: r.companyId,
        isElimination: r.isElimination === true,
        lineType: r.lineType,
        plannedAmount: r.plannedAmount,
        currencyCode: r.currencyCode,
        exchangeRate: r.exchangeRate,
        monthIndex: r.monthIndex,
        // `sortOrder` MUST mirror `monthIndex` (0..11). The recompute
        // pipeline, the Panel-3 drill-down, and the 12-month series
        // endpoint all filter/bucket budget lines by `sortOrder` as the
        // month index (recompute-data-source.ts:312-327). Leaving it at
        // the schema default `0` (the prior bug) collapsed every month
        // into January: monthly/quarterly indicators for AzerSheker —
        // whose lines all defaulted to sortOrder=0 — lumped the whole
        // year into 2026-01/Q1 and showed zero for Feb..Dec. Mirroring
        // monthIndex keeps all four readers consistent without touching
        // the core-calc bucketing logic.
        sortOrder: r.monthIndex ?? 0,
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

      return { resetArchived: archived, resetPurged: purged, rowsInserted: inserted, diff }
  }
  // Execute write phase either via existing outer tx or new one.
  const { resetArchived, resetPurged, rowsInserted, diff } = isOuterTx
    ? await writePhase(dbHandle as Prisma.TransactionClient)
    : await (prismaOrTx as PrismaClient).$transaction(writePhase)

  // ── Phase 3: recompute IVs touched by the new rows ─────────────
  let recomputedIvCount = 0
  if (opts.recompute) {
    const affected: Array<{ companyId: string; period: string }> = []
    const seen = new Set<string>()
    for (const r of plan.rows) {
      // 2026-08-18 — an elimination row has no company, and the indicator
      // recompute is per-company by construction. Skipping it here is not a
      // gap being hidden: group-level indicators are recomputed from the P&L
      // read, which includes eliminations, while a per-company indicator must
      // not move because of a row that belongs to no company.
      if (r.companyId === null) continue
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
    diff,
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
  // Read back exactly the companies this import wrote (rows' footprint),
  // matching the derive-delete-from-write archive scope. Reading by the
  // (possibly broader) caller `plan.companyIds` would surface a surviving
  // sibling company as a spurious reconciliation "extra".
  const footprintCompanyIds = [
    ...new Set(
      plan.rows.map((r) => r.companyId).filter((id): id is string => id !== null),
    ),
  ]
  // 2026-08-18 — an elimination batch has no companyId to narrow by. Without
  // its own scope the read-back would match `{ in: [] }`, come back empty,
  // report every expected sum as `missing`, and turn a batch that wrote
  // perfectly into an unconditional red. Same scope as the archive above, for
  // the same reason the two have always been kept in step.
  const eliminationOnly =
    plan.rows.length > 0 && plan.rows.every((r) => r.isElimination === true)
  const readScope = eliminationOnly
    ? { isElimination: true }
    : { companyId: { in: footprintCompanyIds }, isElimination: false }
  // 2026-07-31 (11.51) — scope the read-back to the plan(s) this batch wrote.
  //
  // The clean-slate above has been plan-scoped since 2026-06-16 (`planFilter`),
  // deliberately: importing the 2026 ACTUALS must not archive the 2026 BUDGET
  // plan. But this read-back kept matching on org+company+year only, and the
  // recon key (`company::account::period`) carries no plan dimension either —
  // so a budget sheet's verification summed the sibling ACTUALS plan's live
  // rows straight back in. Every actuals-only account became an `extra`, and
  // any `extra` is an unconditional red (`reconciliation.ts:152`), which
  // aborts the whole group.
  //
  // Read back exactly what you were allowed to delete: same scope as
  // `planFilter`, so the two can no longer disagree.
  const footprintPlanIds = [...new Set(plan.rows.map((r) => r.planId))]
  // Phase 13.6 — and exclude manual corrections, for the same reason the
  // archive does.
  //
  // This verdict's claim is "the rows I WROTE match what I parsed". A human
  // adjustment was not written by this import and is not in `expectedSums`, so
  // counting it here turns it into an `extra` — and any `extra` is an
  // unconditional red (`reconciliation.ts:152`) that aborts the whole group.
  //
  // Caught by the survival test, which put a correction on the same account as
  // an imported row (the common case) and watched the NEXT import go red.
  // Without this, the first correction anyone makes breaks every subsequent
  // import of that file, and the feature would be abandoned within a week.
  const rows = await prisma.budgetLine.findMany({
    where: {
      organizationId: plan.organizationId,
      planId: { in: footprintPlanIds },
      ...readScope,
      deletedAt: null,
      // Same three-valued-logic trap as the archive filter above: `origin` is
      // nullable and every imported row has it NULL, so a bare `not` matches
      // nothing. Here the consequence is the mirror image — the readback would
      // see zero rows, report every expected sum as `missing`, and turn a
      // perfectly good import red.
      OR: [{ origin: null }, { origin: { not: MANUAL_CORRECTION_ORIGIN } }],
    },
    select: {
      companyId: true,
      isElimination: true,
      plannedAmount: true,
      monthIndex: true,
      plan: { select: { year: true } },
      account: { select: { code: true } },
    },
  })
  // We need entity CODE for the key but the rows carry companyId. Pull
  // the code map once — scoped to the footprint companies (consistent with
  // the row read above; the caller's broader companyIds would only fetch
  // unused extra codes).
  const companies = await prisma.company.findMany({
    where: {
      organizationId: plan.organizationId,
      id: { in: footprintCompanyIds },
    },
    select: { id: true, code: true },
  })
  const codeById = new Map(companies.map((c) => [c.id, c.code]))

  const out = new Map<ReconciliationKey, number>()
  for (const r of rows) {
    // 2026-08-18 — an elimination row has no company, so its key carries the
    // ELIMINATIONS namespace where an entity code would be. The handler builds
    // the expected key the same way; a bare code would be fine today (one
    // contributor per plan) but would collide the moment anything else lands
    // without a company.
    const code = r.isElimination
      ? ELIMINATION_RECON_ENTITY
      : r.companyId
        ? codeById.get(r.companyId)
        : undefined
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
