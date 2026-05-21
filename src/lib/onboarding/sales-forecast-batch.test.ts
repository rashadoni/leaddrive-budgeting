/**
 * Phase 7.M Tier 7 (Phase 4) — sales-forecast-batch tests.
 */
import { describe, it, expect, vi } from "vitest"
import type { PrismaClient, Prisma } from "@prisma/client"
import {
  runSalesForecastBatch,
  type SalesForecastRow,
} from "./sales-forecast-batch"
import { buildReconKey } from "./reconciliation"

function buildPrismaStub(opts: {
  existingForecasts?: Array<{
    departmentId: string
    month: number
    amount: number
  }>
} = {}) {
  const upsert = vi.fn(async () => ({}))
  const findMany = vi.fn(async () => opts.existingForecasts ?? [])

  const fake = {
    salesForecast: { upsert, findMany },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({ salesForecast: { upsert, findMany } })
    }),
  } as unknown as PrismaClient
  return { prisma: fake, upsert, findMany }
}

function row(
  departmentId: string,
  month: number,
  amount: number,
): SalesForecastRow {
  return { departmentId, month, amount }
}

describe("runSalesForecastBatch", () => {
  it("upserts each row by (org, dept, year, month) unique key", async () => {
    const { prisma, upsert } = buildPrismaStub()
    const result = await runSalesForecastBatch(prisma, {
      organizationId: "org_1",
      year: 2026,
      label: "test",
      actorUserId: "u1",
      sourceDocument: "test.xlsx",
      rows: [
        row("dept_sales", 1, 1000),
        row("dept_sales", 2, 1100),
        row("dept_marketing", 1, 500),
      ],
      expectedSums: new Map([
        [buildReconKey("dept_sales", "1", ""), 1000],
        [buildReconKey("dept_sales", "2", ""), 1100],
        [buildReconKey("dept_marketing", "1", ""), 500],
      ]),
    })
    expect(upsert).toHaveBeenCalledTimes(3)
    const [firstArg] = upsert.mock.calls[0] as unknown as [
      {
        where: {
          organizationId_departmentId_year_month: {
            organizationId: string
            departmentId: string
            year: number
            month: number
          }
        }
        create: { amount: number }
        update: { amount: number }
      },
    ]
    expect(firstArg.where.organizationId_departmentId_year_month).toEqual({
      organizationId: "org_1",
      departmentId: "dept_sales",
      year: 2026,
      month: 1,
    })
    expect(firstArg.create.amount).toBe(1000)
    expect(firstArg.update.amount).toBe(1000)
    expect(result.metrics).toEqual({ rowsUpserted: 3 })
  })

  it("empty rows: no upsert calls, metrics 0", async () => {
    const { prisma, upsert } = buildPrismaStub()
    const result = await runSalesForecastBatch(prisma, {
      organizationId: "org_1",
      year: 2026,
      label: "test",
      actorUserId: "u1",
      sourceDocument: "test.xlsx",
      rows: [],
      expectedSums: new Map(),
    })
    expect(upsert).not.toHaveBeenCalled()
    expect(result.metrics.rowsUpserted).toBe(0)
  })

  it("accepts outer transaction without invoking $transaction", async () => {
    const { prisma } = buildPrismaStub()
    const outerUpsert = vi.fn(async () => ({}))
    const outerTx = {
      salesForecast: {
        upsert: outerUpsert,
        findMany: vi.fn(async () => []),
      },
    } as unknown as Prisma.TransactionClient
    await runSalesForecastBatch(outerTx, {
      organizationId: "org_1",
      year: 2026,
      label: "test",
      actorUserId: "u1",
      sourceDocument: "test.xlsx",
      rows: [row("d1", 1, 100)],
      expectedSums: new Map(),
    })
    expect(outerUpsert).toHaveBeenCalledOnce()
    expect((prisma as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction).not.toHaveBeenCalled()
  })

  it("default reconciliation reads SalesForecast sums + keys by (departmentId, month)", async () => {
    const { prisma, findMany } = buildPrismaStub({
      existingForecasts: [
        { departmentId: "d1", month: 1, amount: 1000 },
      ],
    })
    const expectedSums = new Map([
      [buildReconKey("d1", "1", ""), 1000],
    ])
    const result = await runSalesForecastBatch(prisma, {
      organizationId: "org_1",
      year: 2026,
      label: "test",
      actorUserId: "u1",
      sourceDocument: "test.xlsx",
      rows: [row("d1", 1, 1000)],
      expectedSums,
    })
    expect(findMany).toHaveBeenCalled()
    expect(result.reconciliation.verdict).toBe("green")
    expect(result.reconciliation.matched).toBe(1)
  })
})
