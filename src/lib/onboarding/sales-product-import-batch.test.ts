/**
 * 2026-07-15 — guards for the product-sales batch writer.
 *
 * Locks the scoping contract that keeps this from repeating the import
 * corruption classes: the clean-slate is derived from THIS write's own product
 * codes and pinned to (plan, year); an empty parse is a no-op, never a delete;
 * and the write is only trusted after a readback that must match.
 */
import { describe, it, expect, vi } from "vitest"
import { runSalesProductBatch } from "./sales-product-import-batch"
import type { ProductMonthRow } from "./ai-import/product-sales-parser"

function row(
  slug: string,
  month: number,
  quantity: number,
  amount: number,
  explicitUnitPrice?: number,
): ProductMonthRow {
  return {
    identity: {
      slug,
      code: `AZSEKER_EDEN__${slug}`,
      name: slug,
      known: true,
    },
    month,
    year: 2026,
    quantity,
    amount,
    ...(explicitUnitPrice !== undefined ? { explicitUnitPrice } : {}),
  }
}

/** tx stub; `written` captures createMany payload and feeds the readback. */
function makeTx(opts: { corruptReadback?: boolean; dropRow?: boolean } = {}) {
  const state: { written: Array<Record<string, unknown>> } = { written: [] }
  const productIdByCode = new Map<string, string>()
  const tx = {
    productLine: {
      upsert: vi.fn(async (args: { where: { organizationId_code: { code: string } } }) => {
        const code = args.where.organizationId_code.code
        const id = `pl_${code}`
        productIdByCode.set(code, id)
        return { id }
      }),
    },
    salesBudgetLine: {
      deleteMany: vi.fn(async () => ({ count: 3 })),
      createMany: vi.fn(async (args: { data: Array<Record<string, unknown>> }) => {
        state.written = args.data
        return { count: args.data.length }
      }),
      findMany: vi.fn(async () => {
        let rows = state.written.map((w) => ({
          productLineId: w.productLineId as string,
          month: w.month as number,
          quantity: w.quantity as number,
          amount: w.amount as number,
        }))
        if (opts.corruptReadback) rows = rows.map((r) => ({ ...r, amount: r.amount + 5 }))
        if (opts.dropRow) rows = rows.slice(1)
        return rows
      }),
    },
  }
  return { tx: tx as never, state }
}

const BASE = { organizationId: "org1", planId: "plan_budget_2026", year: 2026 }

describe("runSalesProductBatch", () => {
  it("upserts products, writes rows, and derives unitPrice from the money", async () => {
    const { tx, state } = makeTx()
    const res = await runSalesProductBatch(tx, {
      ...BASE,
      rows: [row("WHEAT", 1, 100, 37_000, 370), row("BARLEY", 2, 50, 28_000)],
    })
    expect(res.metrics.productsUpserted).toBe(2)
    expect(res.metrics.rowsInserted).toBe(2)
    expect(state.written[0]).toMatchObject({
      planId: "plan_budget_2026",
      year: 2026,
      month: 1,
      quantity: 100,
      amount: 37_000,
      unitPrice: 370,
    })
    // derived when the sheet states no price
    expect(state.written[1]).toMatchObject({ unitPrice: 560 })
  })

  it("clean-slates ONLY this write's products, pinned to plan + year", async () => {
    const { tx } = makeTx()
    await runSalesProductBatch(tx, { ...BASE, rows: [row("WHEAT", 1, 10, 3_700)] })
    const where = (tx as unknown as {
      salesBudgetLine: { deleteMany: { mock: { calls: Array<[{ where: Record<string, unknown> }]> } } }
    }).salesBudgetLine.deleteMany.mock.calls[0][0].where
    expect(where).toMatchObject({
      organizationId: "org1",
      planId: "plan_budget_2026",
      year: 2026,
    })
    // scoped to the products we are about to write — a sibling entity's
    // products (different codes) can't be caught by this delete
    expect(where.productLineId).toEqual({ in: ["pl_AZSEKER_EDEN__WHEAT"] })
  })

  it("an empty parse is a NO-OP — never a clean-slate", async () => {
    const { tx } = makeTx()
    const res = await runSalesProductBatch(tx, { ...BASE, rows: [] })
    expect(res.metrics).toEqual({ productsUpserted: 0, rowsInserted: 0, rowsArchived: 0 })
    expect(
      (tx as unknown as { salesBudgetLine: { deleteMany: { mock: { calls: unknown[] } } } })
        .salesBudgetLine.deleteMany.mock.calls,
    ).toHaveLength(0)
  })

  it("throws when the readback disagrees with what was written (rolls the tx back)", async () => {
    const { tx } = makeTx({ corruptReadback: true })
    await expect(
      runSalesProductBatch(tx, { ...BASE, rows: [row("WHEAT", 1, 100, 37_000)] }),
    ).rejects.toThrow(/amount drift/)
  })

  it("throws when the readback is missing a row", async () => {
    const { tx } = makeTx({ dropRow: true })
    await expect(
      runSalesProductBatch(tx, {
        ...BASE,
        rows: [row("WHEAT", 1, 100, 37_000), row("BARLEY", 1, 50, 28_000)],
      }),
    ).rejects.toThrow(/row-count mismatch/)
  })

  it("warns (not throws) on revenue with zero volume and stores price 0", async () => {
    const { tx, state } = makeTx()
    const res = await runSalesProductBatch(tx, {
      ...BASE,
      rows: [row("WHEAT", 1, 0, 5_000)],
    })
    expect(state.written[0]).toMatchObject({ quantity: 0, unitPrice: 0, amount: 5_000 })
    expect(res.warnings.some((w) => w.includes("zero volume"))).toBe(true)
  })
})
