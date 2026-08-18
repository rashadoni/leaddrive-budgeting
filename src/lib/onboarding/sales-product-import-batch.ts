/**
 * Product-sales batch writer (2026-07-15) — the only path that populates
 * `SalesBudgetLine` (quantity / unitPrice / amount) from an imported workbook.
 *
 * Contract mirrors the other import batches (import-batch.ts / kpi-import-batch.ts):
 *   RESET (scoped) → WRITE → READBACK-RECONCILE, all inside the caller's tx so
 *   the whole sheet commits or rolls back atomically.
 *
 * Scoping rules — the corruption class this must not repeat:
 *   • the clean-slate is derived from what we are about to WRITE (the product
 *     codes in `rows`), never from a broader caller-supplied set, so a sibling
 *     entity's products can't be wiped;
 *   • it is additionally pinned to (planId, year), so the budget plan and the
 *     actuals plan never clean-slate each other;
 *   • a zero-row parse is a NO-OP, never a delete — a format regression must
 *     not erase good data.
 *
 * Reconciliation reads the rows BACK from the DB after the write and compares
 * per product-month quantity + amount against what was intended; any drift
 * throws, rolling back the enclosing transaction.
 */
import type { Prisma } from "@prisma/client"
import { resolveUnitPrice, type ProductMonthRow } from "./ai-import/product-sales-parser"
import {
  reconcile,
  buildReconKey,
  type ReconciliationKey,
  type ReconciliationReport,
} from "./reconciliation"

export interface SalesProductBatchPlan {
  organizationId: string
  /** Target plan (already resolved to the right kind: budget vs actual). */
  planId: string
  year: number
  /** Parsed product-month rows for ONE entity. */
  rows: ReadonlyArray<ProductMonthRow>
  /** Unit stored on newly created ProductLines (e.g. "ton"). */
  unit?: string
  /** Optional revenue-account code hint per product slug. */
  revenueAccountCodeBySlug?: ReadonlyMap<string, string>
  /**
   * 2026-08-18 — the chart account per-product COGS is booked to.
   *
   * `COGSBudgetLine.accountId` is NOT NULL, and a per-product cost is the same
   * money the P&L already carries under its COGS section — so it points at the
   * client's own account rather than a parallel chart invented here. Absent =
   * the caller has no cost to write, and the cost pass is skipped entirely.
   */
  cogsAccountId?: string
}

export interface SalesProductBatchResult {
  metrics: {
    productsUpserted: number
    rowsInserted: number
    rowsArchived: number
    /** 2026-08-18 — per-product COGS rows written (0 when the source states none). */
    costRowsInserted: number
  }
  warnings: string[]
  /** Post-write DB readback, reconciled per (plan, product, month) on
   *  amount. Absent on the empty-parse no-op — nothing was written, so
   *  there is nothing to prove. See Phase 11.2. */
  reconciliation?: ReconciliationReport
}

/** Money/quantity comparison tolerance — float noise only, not a real drift. */
const EPSILON = 0.01

export async function runSalesProductBatch(
  tx: Prisma.TransactionClient,
  plan: SalesProductBatchPlan,
): Promise<SalesProductBatchResult> {
  const warnings: string[] = []
  if (plan.rows.length === 0) {
    // NO-OP, deliberately: never clean-slate on an empty parse.
    return {
      metrics: { productsUpserted: 0, rowsInserted: 0, rowsArchived: 0, costRowsInserted: 0 },
      warnings,
    }
  }

  // ── 1. Upsert ProductLines (org-scoped, code is entity-namespaced) ──
  const byCode = new Map<string, ProductMonthRow["identity"]>()
  for (const r of plan.rows) byCode.set(r.identity.code, r.identity)
  const productIdByCode = new Map<string, string>()
  for (const [code, identity] of byCode) {
    const revenueAccountCode = plan.revenueAccountCodeBySlug?.get(identity.slug)
    const product = await tx.productLine.upsert({
      where: { organizationId_code: { organizationId: plan.organizationId, code } },
      // Never overwrite an administrator-maintained account link or rename a
      // product a human may have curated — only fill what's still empty.
      update: revenueAccountCode ? { revenueAccountCode } : {},
      create: {
        organizationId: plan.organizationId,
        code,
        name: identity.name,
        unit: plan.unit ?? "ton",
        ...(revenueAccountCode ? { revenueAccountCode } : {}),
      },
      select: { id: true },
    })
    productIdByCode.set(code, product.id)
  }

  // ── 2. Clean-slate — ONLY this import's own products, plan and year ──
  const productIds = [...productIdByCode.values()]
  const del = await tx.salesBudgetLine.deleteMany({
    where: {
      organizationId: plan.organizationId,
      planId: plan.planId,
      year: plan.year,
      productLineId: { in: productIds },
    },
  })

  // ── 3. Write ──
  const payload = plan.rows.map((r) => {
    const unitPrice = resolveUnitPrice(r)
    if (r.quantity === 0 && r.amount !== 0) {
      warnings.push(
        `${r.identity.code} ${plan.year}-${String(r.month).padStart(2, "0")}: revenue ${r.amount.toFixed(0)} with zero volume — unit price stored as 0`,
      )
    }
    return {
      organizationId: plan.organizationId,
      planId: plan.planId,
      productLineId: productIdByCode.get(r.identity.code)!,
      year: r.year,
      month: r.month,
      quantity: r.quantity,
      unitPrice,
      amount: r.amount,
    }
  })
  await tx.salesBudgetLine.createMany({ data: payload })

  // ── 3b. Per-product cost, when the source states it ──────────────────
  //
  // 2026-08-18 — `Sales Budget CPC 2026` ships a `COGS, ₼` banner beside the
  // volumes, and nothing read it, so the product table could say what was sold
  // and never what it cost. Written here rather than in a batch of its own
  // because it shares this one's identity resolution: the same `ProductLine`
  // upsert, the same entity-namespaced codes, the same clean-slate scope.
  //
  // Rows whose `cost` is UNDEFINED are skipped, not written as zero. The
  // farming sheets state tonnes and no money at all, and a zero cost renders
  // as a 100% margin on wheat — a fabrication that looks exactly like an
  // answer. Absent stays absent all the way to the screen.
  const costRows = plan.rows.filter((r) => r.cost !== undefined)
  let costRowsWritten = 0
  if (costRows.length > 0 && plan.cogsAccountId) {
    await tx.cOGSBudgetLine.deleteMany({
      where: {
        organizationId: plan.organizationId,
        planId: plan.planId,
        year: plan.year,
        productLineId: { in: productIds },
      },
    })
    const costPayload = costRows.map((r) => ({
      organizationId: plan.organizationId,
      planId: plan.planId,
      productLineId: productIdByCode.get(r.identity.code)!,
      accountId: plan.cogsAccountId!,
      year: r.year,
      month: r.month,
      productionQty: r.quantity,
      totalCost: r.cost!,
    }))
    await tx.cOGSBudgetLine.createMany({ data: costPayload })

    // Same rule as the sales write below: trust it only once it reads back.
    const costBack = await tx.cOGSBudgetLine.findMany({
      where: {
        organizationId: plan.organizationId,
        planId: plan.planId,
        year: plan.year,
        productLineId: { in: productIds },
      },
      select: { totalCost: true },
    })
    if (costBack.length !== costPayload.length) {
      throw new Error(
        `[sales-product] COGS readback row-count mismatch: wrote ${costPayload.length}, ` +
          `read ${costBack.length} (plan=${plan.planId} year=${plan.year})`,
      )
    }
    const intended = costPayload.reduce((a, r) => a + r.totalCost, 0)
    const stored = costBack.reduce((a, r) => a + r.totalCost, 0)
    if (Math.abs(intended - stored) > 0.005) {
      throw new Error(
        `[sales-product] COGS readback drift: intended ${intended.toFixed(2)}, ` +
          `stored ${stored.toFixed(2)} (plan=${plan.planId} year=${plan.year})`,
      )
    }
    costRowsWritten = costPayload.length
  } else if (costRows.length > 0 && !plan.cogsAccountId) {
    warnings.push(
      `${costRows.length} product-month cost value(s) were parsed but no COGS account was ` +
        `resolved, so none were stored — per-product margin stays unavailable for this import.`,
    )
  }

  // ── 4. Readback reconciliation (the write is only trusted once re-read) ──
  const written = await tx.salesBudgetLine.findMany({
    where: {
      organizationId: plan.organizationId,
      planId: plan.planId,
      year: plan.year,
      productLineId: { in: productIds },
    },
    select: { productLineId: true, month: true, quantity: true, amount: true },
  })
  if (written.length !== payload.length) {
    throw new Error(
      `[sales-product] readback row-count mismatch: wrote ${payload.length}, read ${written.length} (plan=${plan.planId} year=${plan.year})`,
    )
  }
  const readByKey = new Map(
    written.map((w) => [`${w.productLineId}:${w.month}`, w]),
  )
  for (const p of payload) {
    const got = readByKey.get(`${p.productLineId}:${p.month}`)
    if (!got) {
      throw new Error(
        `[sales-product] readback missing row product=${p.productLineId} month=${p.month}`,
      )
    }
    if (Math.abs(got.quantity - p.quantity) > EPSILON) {
      throw new Error(
        `[sales-product] readback quantity drift product=${p.productLineId} month=${p.month}: wrote ${p.quantity}, read ${got.quantity}`,
      )
    }
    if (Math.abs(got.amount - p.amount) > EPSILON) {
      throw new Error(
        `[sales-product] readback amount drift product=${p.productLineId} month=${p.month}: wrote ${p.amount}, read ${got.amount}`,
      )
    }
  }

  // Phase 11.2 (2026-07-29) — emit the same readback as a structured
  // ReconciliationReport so this batch reports evidence in the shape every
  // other batch uses, instead of only signalling by exception. The throws
  // above stay as the hard gate; the report is DERIVED from the two maps
  // rather than asserted green, so it stays honest if the throws are ever
  // relaxed.
  const expectedAmounts = new Map<ReconciliationKey, number>()
  for (const p of payload) {
    const key = buildReconKey(plan.planId, p.productLineId, String(p.month))
    expectedAmounts.set(key, (expectedAmounts.get(key) ?? 0) + p.amount)
  }
  const actualAmounts = new Map<ReconciliationKey, number>()
  for (const w of written) {
    const key = buildReconKey(plan.planId, w.productLineId, String(w.month))
    actualAmounts.set(key, (actualAmounts.get(key) ?? 0) + w.amount)
  }

  return {
    metrics: {
      productsUpserted: productIdByCode.size,
      costRowsInserted: costRowsWritten,
      rowsInserted: payload.length,
      rowsArchived: del.count,
    },
    warnings,
    reconciliation: reconcile(expectedAmounts, actualAmounts),
  }
}
