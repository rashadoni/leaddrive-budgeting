/**
 * Phase 7.M Tier 7 (Phase 3) — actuals-import-batch tests.
 *
 * Mocks Prisma to verify the 4-phase contract (RESET → WRITE →
 * RECONCILE) without hitting a real DB.
 */
import { describe, it, expect, vi } from "vitest"
import type { PrismaClient, Prisma } from "@prisma/client"
import {
  runActualsBatch,
  type ActualsImportRow,
} from "./actuals-import-batch"
import { buildReconKey } from "./reconciliation"

function buildPrismaStub(opts: {
  existingActuals?: Array<{
    category: string
    monthIndex: number | null
    actualAmount: number
  }>
  deleteCount?: number
  createCount?: number
} = {}) {
  const deleteMany = vi.fn(async () => ({ count: opts.deleteCount ?? 0 }))
  const createMany = vi.fn(async () => ({ count: opts.createCount ?? 0 }))
  const findMany = vi.fn(async () => opts.existingActuals ?? [])

  const fake = {
    budgetActual: { deleteMany, createMany, findMany },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({ budgetActual: { deleteMany, createMany, findMany } })
    }),
  } as unknown as PrismaClient
  return { prisma: fake, deleteMany, createMany, findMany }
}

function row(
  category: string,
  amount: number,
  date: string,
  monthIndex: number,
  extra: Partial<ActualsImportRow> = {},
): ActualsImportRow {
  return {
    category,
    amount,
    date,
    monthIndex,
    department: null,
    description: null,
    lineType: "expense",
    companyId: null,
    ...extra,
  }
}

describe("runActualsBatch", () => {
  it("RESET phase purges by planId + year prefix, then bulk-inserts new rows", async () => {
    const { prisma, deleteMany, createMany } = buildPrismaStub({
      deleteCount: 3,
      createCount: 2,
    })
    const expectedSums = new Map([
      [buildReconKey("plan_1", "Cat1", "2"), 100],
      [buildReconKey("plan_1", "Cat2", "2"), 200],
    ])
    const result = await runActualsBatch(prisma, {
      organizationId: "org_1",
      planId: "plan_1",
      label: "test",
      actorUserId: "u1",
      sourceDocument: "test.xlsx",
      dateScope: ["2026"],
      rows: [
        row("Cat1", 100, "2026-03-15", 2),
        row("Cat2", 200, "2026-03-20", 2),
      ],
      expectedSums,
    })
    // RESET filter: year prefix → OR with startsWith
    expect(deleteMany).toHaveBeenCalledOnce()
    const [deleteArg] = deleteMany.mock.calls[0] as unknown as [
      { where: Record<string, unknown> },
    ]
    expect(deleteArg.where).toMatchObject({
      organizationId: "org_1",
      planId: "plan_1",
      OR: [{ expenseDate: { startsWith: "2026" } }],
    })
    // WRITE: payload shape correct
    expect(createMany).toHaveBeenCalledOnce()
    const [createArg] = createMany.mock.calls[0] as unknown as [
      { data: Array<Record<string, unknown>> },
    ]
    const createPayload = createArg.data
    expect(createPayload).toHaveLength(2)
    expect(createPayload[0]).toMatchObject({
      organizationId: "org_1",
      planId: "plan_1",
      category: "Cat1",
      actualAmount: 100,
      expenseDate: "2026-03-15",
      monthIndex: 2,
      lineType: "expense",
    })
    // Metrics propagated
    expect(result.metrics).toEqual({ resetDeleted: 3, rowsInserted: 2 })
    // Reconciliation report present
    expect(result.reconciliation).toBeDefined()
  })

  it("explicit-date dateScope deletes by IN filter, no year OR", async () => {
    const { prisma, deleteMany } = buildPrismaStub({ deleteCount: 1 })
    await runActualsBatch(prisma, {
      organizationId: "org_1",
      planId: "plan_1",
      label: "test",
      actorUserId: "u1",
      sourceDocument: "test.xlsx",
      dateScope: ["2026-03-15"],
      rows: [row("Cat1", 100, "2026-03-15", 2)],
      expectedSums: new Map(),
    })
    const [explicitArg] = deleteMany.mock.calls[0] as unknown as [
      { where: Record<string, unknown> },
    ]
    expect(explicitArg.where).toMatchObject({
      organizationId: "org_1",
      planId: "plan_1",
      expenseDate: { in: ["2026-03-15"] },
    })
  })

  it("empty dateScope skips RESET (append-only semantics)", async () => {
    const { prisma, deleteMany, createMany } = buildPrismaStub({
      createCount: 1,
    })
    await runActualsBatch(prisma, {
      organizationId: "org_1",
      planId: "plan_1",
      label: "test",
      actorUserId: "u1",
      sourceDocument: "test.xlsx",
      dateScope: [],
      rows: [row("Cat1", 100, "2026-03-15", 2)],
      expectedSums: new Map(),
    })
    expect(deleteMany).not.toHaveBeenCalled()
    expect(createMany).toHaveBeenCalledOnce()
  })

  it("empty rows array: no insert call, no row in metrics", async () => {
    const { prisma, deleteMany, createMany } = buildPrismaStub({
      deleteCount: 5,
    })
    const result = await runActualsBatch(prisma, {
      organizationId: "org_1",
      planId: "plan_1",
      label: "test",
      actorUserId: "u1",
      sourceDocument: "test.xlsx",
      dateScope: ["2026"],
      rows: [],
      expectedSums: new Map(),
    })
    expect(deleteMany).toHaveBeenCalledOnce()
    expect(createMany).not.toHaveBeenCalled()
    expect(result.metrics).toEqual({ resetDeleted: 5, rowsInserted: 0 })
  })

  it("accepts outer transaction (tx) without invoking $transaction", async () => {
    const { prisma } = buildPrismaStub({
      createCount: 1,
      deleteCount: 0,
    })
    // Build a tx that does NOT have $transaction (simulates outer-tx path)
    const outerTxDelete = vi.fn(async () => ({ count: 0 }))
    const outerTxCreate = vi.fn(async () => ({ count: 1 }))
    const outerTx = {
      budgetActual: {
        deleteMany: outerTxDelete,
        createMany: outerTxCreate,
        findMany: vi.fn(async () => []),
      },
    } as unknown as Prisma.TransactionClient
    await runActualsBatch(outerTx, {
      organizationId: "org_1",
      planId: "plan_1",
      label: "test",
      actorUserId: "u1",
      sourceDocument: "test.xlsx",
      dateScope: ["2026"],
      rows: [row("Cat1", 100, "2026-03-15", 2)],
      expectedSums: new Map(),
    })
    // Outer tx's mocks should be hit, not the prisma stub
    expect(outerTxCreate).toHaveBeenCalledOnce()
    // Prisma stub's $transaction must NOT be invoked (we bypass it)
    expect((prisma as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction).not.toHaveBeenCalled()
  })

  it("default reconciliation reads BudgetActual sums + keys by (planId, category, monthIndex)", async () => {
    const { prisma, findMany } = buildPrismaStub({
      existingActuals: [
        { category: "Cat1", monthIndex: 2, actualAmount: 100 },
        { category: "Cat1", monthIndex: 2, actualAmount: 50 }, // same key → sum 150
      ],
      createCount: 0,
    })
    const expectedSums = new Map([
      [buildReconKey("plan_1", "Cat1", "2"), 150],
    ])
    const result = await runActualsBatch(prisma, {
      organizationId: "org_1",
      planId: "plan_1",
      label: "test",
      actorUserId: "u1",
      sourceDocument: "test.xlsx",
      dateScope: ["2026"],
      rows: [],
      expectedSums,
    })
    expect(findMany).toHaveBeenCalled()
    // Default reconciler should have aggregated existing actuals into the
    // same key shape → verdict "green" (sums match: 100 + 50 = 150).
    expect(result.reconciliation.verdict).toBe("green")
    expect(result.reconciliation.matched).toBe(1)
    expect(result.reconciliation.drift).toEqual([])
  })
})
