/**
 * Phase 7.M Tier 7 (Phase 4, 2026-05-21) — atomic SalesForecast import-batch
 * orchestrator. Fifth sister of `runImportBatch` (PLF/BudgetLine),
 * `runBalanceSheetBatch` (BS), `runCashFlowBatch` (CF), `runKpiBatch`
 * (operational_facts), `runActualsBatch` (budget_actuals).
 *
 * Schema differences vs siblings
 * ──────────────────────────────
 *  • Target table: `sales_forecasts` (org-scoped, NO planId).
 *  • Row identity: unique by (organizationId, departmentId, year, month)
 *    — exactly 12 rows per (org, dept, year).
 *  • Re-import semantics: UPSERT by unique key. No reset phase — cells
 *    that are present in the new batch overwrite, cells absent leave the
 *    prior value untouched. Mirrors the legacy
 *    `/api/budgeting/sales-forecast/import` upsert loop.
 *
 * 4-phase contract (same wording as siblings):
 *
 *   1. RESET     — none (upsert semantics).
 *   2. WRITE     — bulk upsert by (org, dept, year, month) unique key.
 *   3. RECOMPUTE — no-op for this table (P&L recompute reads forecast
 *                  sums at query time; no precomputed indicators).
 *   4. RECONCILE — file vs DB sums per `${departmentId}::${month}`.
 */
import type { PrismaClient, Prisma } from "@prisma/client"
import {
  reconcile,
  buildReconKey,
  type ReconciliationKey,
  type ReconciliationReport,
  type ReconciliationOptions,
} from "./reconciliation"

export interface SalesForecastRow {
  departmentId: string
  /** 1..12 (1=Jan..12=Dec). */
  month: number
  /** Finite ≥0. */
  amount: number
}

export interface SalesForecastPlan {
  organizationId: string
  year: number
  label: string
  actorUserId: string
  sourceDocument: string
  rows: ReadonlyArray<SalesForecastRow>
  expectedSums: ReadonlyMap<ReconciliationKey, number>
  reconciliationOptions?: ReconciliationOptions
}

export interface SalesForecastPhaseMetrics {
  rowsUpserted: number
}

export interface SalesForecastResult {
  batchId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  plan: {
    label: string
    sourceDocument: string
    organizationId: string
    year: number
  }
  metrics: SalesForecastPhaseMetrics
  reconciliation: ReconciliationReport
}

export async function runSalesForecastBatch(
  prismaOrTx: PrismaClient | Prisma.TransactionClient,
  plan: SalesForecastPlan,
  opts: {
    readActualSums?: (
      prismaClient: PrismaClient | Prisma.TransactionClient,
      input: {
        organizationId: string
        year: number
        departmentIds: ReadonlyArray<string>
      },
    ) => Promise<Map<ReconciliationKey, number>>
    batchIdFactory?: () => string
  } = {},
): Promise<SalesForecastResult> {
  const isOuterTx =
    typeof (prismaOrTx as PrismaClient).$transaction !== "function"
  const dbHandle = prismaOrTx as PrismaClient & Prisma.TransactionClient
  const startedAt = new Date()
  const batchId =
    opts.batchIdFactory?.() ??
    `salesfx_batch_${startedAt
      .toISOString()
      .replace(/[:.]/g, "-")}_${Math.random().toString(36).slice(2, 10)}`

  const writePhase = async (tx: Prisma.TransactionClient) => {
    let upserted = 0
    for (const r of foldRowsByCell(plan.rows)) {
      await tx.salesForecast.upsert({
        where: {
          organizationId_departmentId_year_month: {
            organizationId: plan.organizationId,
            departmentId: r.departmentId,
            year: plan.year,
            month: r.month,
          },
        },
        update: { amount: r.amount },
        create: {
          organizationId: plan.organizationId,
          departmentId: r.departmentId,
          year: plan.year,
          month: r.month,
          amount: r.amount,
        },
      })
      upserted++
    }
    return { rowsUpserted: upserted }
  }
  const { rowsUpserted } = isOuterTx
    ? await writePhase(dbHandle as Prisma.TransactionClient)
    : await (prismaOrTx as PrismaClient).$transaction(writePhase)

  const departmentIds = Array.from(
    new Set(plan.rows.map((r) => r.departmentId)),
  )
  const actualSums = opts.readActualSums
    ? await opts.readActualSums(dbHandle, {
        organizationId: plan.organizationId,
        year: plan.year,
        departmentIds,
      })
    : await defaultReadActualSums(dbHandle, plan, departmentIds)

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
      organizationId: plan.organizationId,
      year: plan.year,
    },
    metrics: { rowsUpserted },
    reconciliation,
  }
}

/**
 * Fold duplicate `(departmentId, month)` cells by SUM before the write.
 *
 * 2026-07-31 (11.57) — the caller accumulates `expectedSums` ADDITIVELY
 * (`production-adapter-handlers-soft.ts`: `set(key, (get(key) ?? 0) + amount)`)
 * but the write is an UPSERT whose `update` REPLACES the amount, so the LAST
 * duplicate won and the expectation held the SUM. Reachable without anything
 * exotic: `parseSalesForecastWorkbook` lower-cases the label, so "Retail" and
 * "RETAIL" on two grid rows resolve to one departmentId.
 *
 * Every sibling batch `createMany`s after a reset, so their duplicate leaf
 * rows sum in the database for free. This is the only upsert batch; folding
 * gives it the same arithmetic instead of a second, contradictory one.
 *
 * Copies each row — `plan.rows` is the parse result and the orchestrator still
 * holds it after `applyToDb`.
 */
function foldRowsByCell(
  rows: ReadonlyArray<SalesForecastRow>,
): SalesForecastRow[] {
  const byCell = new Map<string, SalesForecastRow>()
  for (const r of rows) {
    const cell = `${r.departmentId}::${r.month}`
    const hit = byCell.get(cell)
    if (hit) hit.amount += r.amount
    else byCell.set(cell, { ...r })
  }
  return [...byCell.values()]
}

async function defaultReadActualSums(
  prisma: PrismaClient | Prisma.TransactionClient,
  plan: SalesForecastPlan,
  departmentIds: ReadonlyArray<string>,
): Promise<Map<ReconciliationKey, number>> {
  if (departmentIds.length === 0) return new Map()
  // 2026-07-31 (11.57) — read back exactly the cells this batch wrote.
  //
  // This table has NO reset phase: the write is an upsert, so the footprint is
  // precisely the (department, month) pairs in `plan.rows`. The read-back
  // matched on org+year+department only, while the recon key it builds carries
  // `month` — so every stored cell outside that footprint returned as `extra`,
  // and any extra is an unconditional red (`reconciliation.ts:152`) that
  // aborts the group. Such cells are routine: a grid edit via
  // POST /api/budgeting/sales-forecast, an earlier import of another sheet, or
  // a blank cell in THIS file (the parser skips empties, so the prior row
  // survives). `sales_forecasts` has no `deletedAt`, so they survive forever.
  //
  // The month predicate alone is NOT enough — `department IN (…) × month IN (…)`
  // is a cross-product, so a stored (d1, Feb) still slips through when the file
  // writes (d1, Jan) and (d2, Feb). The written-key gate below is what closes
  // it; the WHERE clause is kept as well so the database does the bulk of the
  // narrowing rather than shipping the whole year back.
  const writtenKeys = new Set(
    plan.rows.map((r) => buildReconKey(r.departmentId, String(r.month), "")),
  )
  const months = [...new Set(plan.rows.map((r) => r.month))]
  const rows = await prisma.salesForecast.findMany({
    where: {
      organizationId: plan.organizationId,
      year: plan.year,
      departmentId: { in: [...departmentIds] },
      ...(months.length > 0 ? { month: { in: months } } : {}),
    },
    select: { departmentId: true, month: true, amount: true },
  })
  const out = new Map<ReconciliationKey, number>()
  for (const r of rows) {
    const key = buildReconKey(r.departmentId, String(r.month), "")
    if (!writtenKeys.has(key)) continue
    out.set(key, (out.get(key) ?? 0) + r.amount)
  }
  return out
}
