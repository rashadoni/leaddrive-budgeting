/**
 * 11.57 — the sales-forecast batch verified itself against cells it never wrote.
 *
 * Two defects, both invisible until 11.2 made post-write reconciliation real.
 *
 *  (a) SCOPE. This is the only batch with NO reset phase — it upserts — so
 *      its write footprint is exactly the `(department, month)` cells in
 *      `plan.rows`. The read-back matched on org+year+department only, while
 *      the recon key it builds carries `month`. Every stored cell outside the
 *      footprint therefore returned as `extra`, and any extra is an
 *      unconditional red (`reconciliation.ts:152`) that aborts the group.
 *      Reachable three ways, all routine: a grid edit via
 *      POST /api/budgeting/sales-forecast, an earlier import of a different
 *      sheet, or a blank cell in the SAME file — the parser skips empties, so
 *      the previous row survives. `sales_forecasts` has no `deletedAt`, so
 *      these live forever.
 *
 *  (b) ARITHMETIC. `expectedSums` is accumulated additively by the caller
 *      while the upsert REPLACES, so two rows for one cell left the last
 *      amount in the database against a summed expectation. Reachable because
 *      the parser lower-cases labels: "Retail" and "RETAIL" resolve to one
 *      departmentId.
 *
 * A separate file with its own stub, because the one in
 * `sales-forecast-batch.test.ts` returns a fixed array and ignores `where`
 * entirely — a double that drops the predicate under test cannot witness the
 * fix, and that blindness is exactly how this survived.
 */
import { describe, it, expect, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import {
  runSalesForecastBatch,
  type SalesForecastRow,
} from "./sales-forecast-batch"
import { buildReconKey } from "./reconciliation"

interface StoredCell {
  departmentId: string
  month: number
  amount: number
}

type Where = {
  organizationId?: string
  year?: number
  departmentId?: { in: string[] }
  month?: { in: number[] }
}

const KNOWN = new Set(["organizationId", "year", "departmentId", "month"])

function buildPrismaStub(existing: StoredCell[] = []) {
  const store: StoredCell[] = existing.map((c) => ({ ...c }))
  const upsert = vi.fn(
    async (args: {
      where: {
        organizationId_departmentId_year_month: {
          departmentId: string
          month: number
        }
      }
      update: { amount: number }
      create: StoredCell
    }) => {
      const k = args.where.organizationId_departmentId_year_month
      const hit = store.find(
        (c) => c.departmentId === k.departmentId && c.month === k.month,
      )
      // Faithful upsert: update REPLACES. Modelling it as an increment would
      // hide defect (b) entirely.
      if (hit) hit.amount = args.update.amount
      else store.push({ ...args.create })
      return {}
    },
  )
  const findMany = vi.fn(async (args: { where: Where }) => {
    for (const k of Object.keys(args.where)) {
      if (!KNOWN.has(k)) {
        throw new Error(
          `stub salesForecast.findMany: unimplemented WHERE key "${k}" — extend the stub rather than letting it pass blindly`,
        )
      }
    }
    const w = args.where
    return store.filter((c) => {
      if (w.departmentId && !w.departmentId.in.includes(c.departmentId))
        return false
      if (w.month && !w.month.in.includes(c.month)) return false
      return true
    })
  })

  const fake = {
    salesForecast: { upsert, findMany },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ salesForecast: { upsert, findMany } }),
    ),
  } as unknown as PrismaClient
  return { prisma: fake, upsert, findMany, store }
}

const row = (
  departmentId: string,
  month: number,
  amount: number,
): SalesForecastRow => ({ departmentId, month, amount })

function planFor(rows: SalesForecastRow[]) {
  const expectedSums = new Map<string, number>()
  for (const r of rows) {
    const key = buildReconKey(r.departmentId, String(r.month), "")
    expectedSums.set(key, (expectedSums.get(key) ?? 0) + r.amount)
  }
  return {
    organizationId: "org_1",
    year: 2026,
    label: "test",
    actorUserId: "u1",
    sourceDocument: "test.xlsx",
    rows,
    expectedSums,
  }
}

describe("sales forecast — read back only the cells this batch wrote", () => {
  it("ignores a stored month the file does not cover", async () => {
    // The regression: a hand-entered February for the same department used to
    // come back as `extra` and turn a correct January import red.
    const { prisma } = buildPrismaStub([
      { departmentId: "dept_sales", month: 2, amount: 999 },
    ])
    const res = await runSalesForecastBatch(
      prisma,
      planFor([row("dept_sales", 1, 1000)]),
    )

    expect(res.reconciliation.extra).toEqual([])
    expect(res.reconciliation.verdict).toBe("green")
  })

  it("ignores a cell that satisfies BOTH predicates but was never written", async () => {
    // Why a `month: { in: … }` clause alone is not enough: department × month
    // is a cross-product. The file writes (sales, Jan) and (marketing, Feb);
    // a stored (sales, Feb) passes both `in` lists and still is not ours.
    const { prisma } = buildPrismaStub([
      { departmentId: "dept_sales", month: 2, amount: 777 },
    ])
    const res = await runSalesForecastBatch(
      prisma,
      planFor([row("dept_sales", 1, 1000), row("dept_marketing", 2, 500)]),
    )

    expect(res.reconciliation.extra).toEqual([])
    expect(res.reconciliation.verdict).toBe("green")
  })

  it("sums duplicate cells before writing, matching the additive expectation", async () => {
    // Defect (b). Upsert replaces, so the DB held 400 against an expected
    // 1000 — 60% drift, red, on a file that parsed perfectly.
    const { prisma, store } = buildPrismaStub()
    const res = await runSalesForecastBatch(
      prisma,
      planFor([row("dept_sales", 1, 600), row("dept_sales", 1, 400)]),
    )

    expect(store).toHaveLength(1)
    expect(store[0].amount).toBe(1000)
    expect(res.reconciliation.verdict).toBe("green")
    expect(res.reconciliation.drift).toEqual([])
  })

  it("still reports a genuine drift — narrowing must not blind the check", async () => {
    const { prisma } = buildPrismaStub()
    const plan = planFor([row("dept_sales", 1, 1000)])
    const res = await runSalesForecastBatch(prisma, {
      ...plan,
      expectedSums: new Map([[buildReconKey("dept_sales", "1", ""), 5000]]),
    })

    expect(res.reconciliation.verdict).toBe("red")
    expect(res.reconciliation.drift).toHaveLength(1)
  })

  it("still reports a cell that failed to land as missing", async () => {
    // Guards the other direction: the key-set gate filters the ACTUAL side,
    // so an expected key with no stored row must still surface.
    const { prisma } = buildPrismaStub()
    const plan = planFor([row("dept_sales", 1, 1000)])
    const withGhost = new Map(plan.expectedSums)
    withGhost.set(buildReconKey("dept_ghost", "7", ""), 42)
    const res = await runSalesForecastBatch(prisma, {
      ...plan,
      expectedSums: withGhost,
    })

    expect(res.reconciliation.missing).toContain(
      buildReconKey("dept_ghost", "7", ""),
    )
    expect(res.reconciliation.verdict).toBe("red")
  })
})
