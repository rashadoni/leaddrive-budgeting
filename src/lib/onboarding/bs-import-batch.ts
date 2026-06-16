/**
 * Phase 7.M Step 6 (2026-05-19) — atomic BalanceSheet import-batch
 * orchestrator. Sister of `runImportBatch` (which writes `budget_lines`).
 *
 * Why a sister, not a generalisation
 * ──────────────────────────────────
 * Three differences between BudgetLine and BalanceSheetLine writes
 * defeat a clean generic abstraction:
 *
 *  1. Schema shape: BS uses `accountCode` + `accountName` + `year` +
 *     `month` flat columns. BudgetLine uses `category` + `monthIndex`
 *     and lacks an explicit name field.
 *  2. Scope semantics: BS is plan-scoped (planId), but the company
 *     is NOT a column on BS — every BS row belongs to a plan, and
 *     the plan-to-company link runs through `budget_lines` on the
 *     same plan. Reset/reconciliation needs to bridge that.
 *  3. Hierarchy: BS rows have `lineType: asset|liability|equity` AND
 *     `subType: current_asset|fixed_asset|...`. The two fields are
 *     parsed atomically per BS code, so the row payload differs.
 *
 * Rather than a leaky generic over those shapes, we ship a second
 * orchestrator with the same 4-phase contract. Both call the same
 * `reconcile()` helper so the math stays single-source-of-truth.
 *
 * 4-phase contract (identical wording to the P&L wrapper):
 *
 *   1. RESET     — soft-archive existing BS rows in scope, optionally
 *                  hard-purge the prior archive tail.
 *   2. WRITE     — insert new BS rows in one prisma.$transaction.
 *   3. RECOMPUTE — optional hook (BS rarely feeds IndicatorValues
 *                  directly; reserve for future BS-driven indicators).
 *   4. RECONCILE — compare expected/actual sums per
 *                  `${planId}::${accountCode}::${year}-${MM}`.
 */
import type { PrismaClient, Prisma } from "@prisma/client"
import { archiveStamp } from "@/lib/server/soft-delete"
import { assertNoCollateralDeletion } from "./collateral-guard"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger for the
// balance-sheet batch import phase narrator. 4 console.* → logger.
const log = getLogger("onboarding:bs-batch")
import {
  reconcile,
  buildReconKey,
  type ReconciliationKey,
  type ReconciliationReport,
  type ReconciliationOptions,
} from "./reconciliation"

export interface BsImportRow {
  /** Always inherits from the BudgetPlan that owns the company group. */
  planId: string
  /**
   * Phase 7.O (2026-05-24) — company scope for per-entity resolver queries.
   * Optional so callers that don't have a companyId (e.g. legacy imports)
   * can omit it without breaking the batch. When set, the row can be
   * queried by the `balanceSheetLine` resolver for inventory / equity etc.
   * When null / undefined, the row is only accessible via plan-scoped reads.
   */
  companyId?: string | null
  /**
   * Phase 2.1 session 3 (2026-05-26) — accountCode + accountName String
   * fields dropped from BalanceSheetLine schema. accountCode kept on the
   * row interface ONLY because it's used to build reconciliation keys
   * for cross-file conflict detection; never written to DB.
   */
  accountCode: string
  /**
   * Phase 2.1 session 3 — FK to ChartOfAccount. Required NOT NULL.
   * Resolved via `resolveOrCreateAccountId` inside the BS handler's
   * applyToDb before passing rows in.
   */
  accountId: string
  /** asset | liability | equity */
  lineType: string
  /** non_current | current (assets); long_term | short_term (liabilities) */
  subType: string | null
  year: number
  month: number // 1-12
  amount: number
  /** Free-form provenance — typically `Filename.xlsx#Sheet!A1:F123`. */
  sourceCell: string
}

export interface BsImportPlan {
  organizationId: string
  label: string
  actorUserId: string
  sourceDocument: string
  /** Plan IDs in scope for the reset. Rows on these plans matching
   *  `periodScope` will be soft-archived. */
  planIds: ReadonlyArray<string>
  /** Year-month strings in scope, e.g. `["2026-01",...,"2026-12"]`. */
  periodScope: ReadonlyArray<string>
  rows: ReadonlyArray<BsImportRow>
  expectedSums: ReadonlyMap<ReconciliationKey, number>
  purgeArchivedFirst?: boolean
  reconciliationOptions?: ReconciliationOptions
}

export interface BsImportPhaseMetrics {
  resetArchived: number
  resetPurged: number
  rowsInserted: number
}

export interface BsImportResult {
  batchId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  plan: {
    label: string
    sourceDocument: string
    planIds: ReadonlyArray<string>
    periodScope: ReadonlyArray<string>
  }
  metrics: BsImportPhaseMetrics
  reconciliation: ReconciliationReport
}

export async function runBalanceSheetBatch(
  /**
   * Phase 7.M Tier 5 — accepts PrismaClient (legacy single-file path:
   * opens own tx) OR Prisma.TransactionClient (multi-file orchestrator
   * path: caller-managed outer tx). Detected at runtime via
   * `$transaction` method presence.
   */
  prismaOrTx: PrismaClient | Prisma.TransactionClient,
  plan: BsImportPlan,
  opts: {
    /** Reconciliation hook — caller provides the DB read for the
     *  `actualSums` side. Default reads via `prisma.balanceSheetLine
     *  .findMany` with `EXCLUDE_DELETED`. Tests pass a synthetic
     *  implementation. */
    readActualSums?: (
      prismaClient: PrismaClient | Prisma.TransactionClient,
      input: {
        organizationId: string
        planIds: ReadonlyArray<string>
        periodScope: ReadonlyArray<string>
      },
    ) => Promise<Map<ReconciliationKey, number>>
    /** Override the batch id (test seam). */
    batchIdFactory?: () => string
  } = {},
): Promise<BsImportResult> {
  const isOuterTx =
    typeof (prismaOrTx as PrismaClient).$transaction !== "function"
  const dbHandle = prismaOrTx as PrismaClient & Prisma.TransactionClient
  const startedAt = new Date()
  const batchId =
    opts.batchIdFactory?.() ??
    `bs_batch_${startedAt.toISOString().replace(/[:.]/g, "-")}_${Math.random().toString(36).slice(2, 10)}`

  const yearScope = Array.from(
    new Set(
      plan.periodScope
        .map((p) => Number(p.slice(0, 4)))
        .filter((n) => Number.isFinite(n)),
    ),
  )

  // ── Phase 1+2: reset & write inside one transaction ────────────
  // When inside an outer tx (Phase 7.M Tier 5), skip the wrapper so
  // the multi-file orchestrator gets group-level atomicity.
  const writePhase = async (tx: Prisma.TransactionClient) => {
      const yearFilter =
        yearScope.length > 0 ? { year: { in: yearScope } } : {}

      // ── Entity breakdown from incoming rows (accountCode last dash-segment is the BS code) ──
      const incomingByEntity = new Map<string, number>()
      for (const r of plan.rows) {
        const parts = r.accountCode.split("-")
        const entity = parts.length > 1 ? parts.slice(0, -1).join("-") : parts[0]
        incomingByEntity.set(entity, (incomingByEntity.get(entity) ?? 0) + 1)
      }
      const incomingBreakdown = [...incomingByEntity.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([e, n]) => `${e}(${n})`)
        .join(", ")
      log.info("plan scope", {
        label: plan.label,
        planIds: [...plan.planIds],
        years: yearScope,
        incomingRows: plan.rows.length,
        incomingBreakdown: incomingBreakdown || "(none)",
      })

      let archived = 0
      let purged = 0
      // BUGFIX 2026-05-31: Phase 7.O added `companyId` to BS rows, but the
      // archive below still scoped ONLY by planId. Every AzerSheker entity
      // shares one plan, so a per-entity multi-file batch archived OTHER
      // entities' live BS — the 2026-05-26 multi-import left CPC/AZSF/EDEN
      // with zero live balance sheet (only the last-written entity, MALT,
      // survived). Mirror the P&L batch (`runImportBatch`): scope the reset
      // to the companies actually present in THIS batch. Fall back to the
      // legacy plan-only scope when no incoming row carries a companyId.
      const incomingCompanyIds = [
        ...new Set(plan.rows.map((r) => r.companyId).filter((x): x is string => x != null)),
      ]
      const companyScope =
        incomingCompanyIds.length > 0 ? { companyId: { in: incomingCompanyIds } } : {}
      // 2026-06-16 derive-delete-from-write — the purge/archive scope is now
      // derived from the plans the INSERTED rows actually carry
      // (`footprintPlanIds`), NOT caller-supplied `plan.planIds` (which can be
      // broader and archive a sibling entity's lines on a shared plan — the
      // 2026-05-31 bug). `incomingCompanyIds` already derives the company
      // dimension; `yearScope` (period) stays caller-controlled. The guard
      // below now holds by construction (kept as a tripwire). Empty rows →
      // `{ in: [] }` → no-op.
      const footprintPlanIds = [...new Set(plan.rows.map((r) => r.planId))]
      const footprintLiveCount =
        footprintPlanIds.length === 0
          ? 0
          : await tx.balanceSheetLine.count({
              where: {
                organizationId: plan.organizationId,
                planId: { in: footprintPlanIds },
                ...companyScope,
                deletedAt: null,
                ...yearFilter,
              },
            })
      if (plan.purgeArchivedFirst) {
        const purgeResult = await tx.balanceSheetLine.deleteMany({
          where: {
            organizationId: plan.organizationId,
            planId: { in: footprintPlanIds },
            ...companyScope,
            deletedAt: { not: null },
            ...yearFilter,
          },
        })
        purged = purgeResult.count
      }
      const stamp = archiveStamp(plan.actorUserId)
      const archiveResult = await tx.balanceSheetLine.updateMany({
        where: {
          organizationId: plan.organizationId,
          planId: { in: footprintPlanIds },
          ...companyScope,
          deletedAt: null,
          ...yearFilter,
        },
        data: stamp as unknown as Prisma.BalanceSheetLineUpdateManyMutationInput,
      })
      archived = archiveResult.count
      assertNoCollateralDeletion({
        table: "BalanceSheetLine",
        archivedCount: archived,
        footprintLiveCount,
        footprint: `plans=[${footprintPlanIds.join(",")}] companies=[${incomingCompanyIds.join(",")}]`,
      })
      log.info("archive phase", { archived, purged })
      if (archived > 0 && plan.rows.length > 0 && archived > plan.rows.length * 1.2) {
        log.warn("archive/insert mismatch — check all entities are in one batch", {
          archived,
          inserting: plan.rows.length,
          ratio: Number((archived / plan.rows.length).toFixed(1)),
        })
      }

      // Phase 2.1 session 3: accountCode + accountName columns dropped
      // from BalanceSheetLine; accountId is required NOT NULL.
      const payload = plan.rows.map((r) => ({
        organizationId: plan.organizationId,
        planId: r.planId,
        ...(r.companyId != null ? { companyId: r.companyId } : {}),
        accountId: r.accountId,
        lineType: r.lineType,
        subType: r.subType,
        year: r.year,
        month: r.month,
        amount: r.amount,
        notes: r.sourceCell,
      }))
      let inserted = 0
      if (payload.length > 0) {
        const result = await tx.balanceSheetLine.createMany({ data: payload })
        inserted = result.count
      }
      log.info("insert phase", { inserted })
      return { resetArchived: archived, resetPurged: purged, rowsInserted: inserted }
  }
  const { resetArchived, resetPurged, rowsInserted } = isOuterTx
    ? await writePhase(dbHandle as Prisma.TransactionClient)
    : await (prismaOrTx as PrismaClient).$transaction(writePhase)

  // ── Phase 4: reconcile expected vs actual sums ─────────────────
  const actualSums = opts.readActualSums
    ? await opts.readActualSums(dbHandle, {
        organizationId: plan.organizationId,
        planIds: plan.planIds,
        periodScope: plan.periodScope,
      })
    : await defaultReadActualBsSums(dbHandle, plan)

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
      planIds: plan.planIds,
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

/**
 * Default read: groups live BS rows by (planId, accountCode, period)
 * → SUM(amount). Caller can supply a synthetic implementation in
 * tests.
 */
async function defaultReadActualBsSums(
  prisma: PrismaClient | Prisma.TransactionClient,
  plan: BsImportPlan,
): Promise<Map<ReconciliationKey, number>> {
  const yearScope = Array.from(
    new Set(
      plan.periodScope
        .map((p) => Number(p.slice(0, 4)))
        .filter((n) => Number.isFinite(n)),
    ),
  )

  // Match the archive scope (companyId-aware 2026-05-31 + planId-derive
  // 2026-06-16): recon must read only the rows THIS batch is responsible
  // for. Sibling entities/plans share scope, so reading by the caller's
  // (possibly broader) planId/companyId would sum their balances in and
  // trip a false drift verdict now that the archive no longer cross-deletes
  // them. Derive BOTH dimensions from the rows.
  const footprintPlanIds = [...new Set(plan.rows.map((r) => r.planId))]
  const companyIds = [
    ...new Set(plan.rows.map((r) => r.companyId).filter((x): x is string => x != null)),
  ]
  // Phase 2.1 session 3: accountCode column dropped from BalanceSheetLine;
  // read via FK relation `account.code` instead.
  const rows = await prisma.balanceSheetLine.findMany({
    where: {
      organizationId: plan.organizationId,
      planId: { in: footprintPlanIds },
      ...(companyIds.length > 0 ? { companyId: { in: companyIds } } : {}),
      deletedAt: null,
      ...(yearScope.length > 0 ? { year: { in: yearScope } } : {}),
    },
    select: {
      planId: true,
      account: { select: { code: true } },
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
    const key = buildReconKey(r.planId, r.account.code, period)
    out.set(key, (out.get(key) ?? 0) + r.amount)
  }
  return out
}
