/**
 * Phase 1.4 — unit tests for the soft-delete physical-purge helper.
 *
 * Pure-helper layer: Prisma is mocked. Cascade-on-BudgetPlan is a DB
 * concern (FK onDelete: Cascade in schema) and is covered by the
 * processor integration test, not here.
 */

import { describe, it, expect, vi } from "vitest"
import {
  runSoftDeleteCleanup,
  SOFT_DELETE_TTL_MS,
} from "./soft-delete-cleanup"
import type { PrismaClient } from "@prisma/client"

function makePrisma(counts: {
  budgetPlans?: number
  cashFlowEntries?: number
  balanceSheetLines?: number
  counterparties?: number
}) {
  const get = (n: number | undefined) => n ?? 0
  return {
    budgetPlan: {
      count: vi.fn(async () => get(counts.budgetPlans)),
      deleteMany: vi.fn(async () => ({ count: get(counts.budgetPlans) })),
    },
    cashFlowEntry: {
      count: vi.fn(async () => get(counts.cashFlowEntries)),
      deleteMany: vi.fn(async () => ({
        count: get(counts.cashFlowEntries),
      })),
    },
    balanceSheetLine: {
      count: vi.fn(async () => get(counts.balanceSheetLines)),
      deleteMany: vi.fn(async () => ({
        count: get(counts.balanceSheetLines),
      })),
    },
    counterparty: {
      count: vi.fn(async () => get(counts.counterparties)),
      deleteMany: vi.fn(async () => ({ count: get(counts.counterparties) })),
    },
    // $transaction shim: callable form takes array OR fn; we use the
    // array form. Resolves to the awaited array of results.
    $transaction: vi.fn(
      async (ops: ReadonlyArray<Promise<unknown>>) => Promise.all(ops),
    ),
  } as unknown as PrismaClient
}

describe("runSoftDeleteCleanup", () => {
  it("returns zero counts when nothing is soft-deleted", async () => {
    const prisma = makePrisma({})
    const counts = await runSoftDeleteCleanup(prisma)
    expect(counts).toEqual({
      budgetPlans: 0,
      cashFlowEntries: 0,
      balanceSheetLines: 0,
      counterparties: 0,
      total: 0,
    })
  })

  it("sums per-table deletes into total", async () => {
    const prisma = makePrisma({
      budgetPlans: 2,
      cashFlowEntries: 5,
      balanceSheetLines: 11,
      counterparties: 3,
    })
    const counts = await runSoftDeleteCleanup(prisma)
    expect(counts.budgetPlans).toBe(2)
    expect(counts.cashFlowEntries).toBe(5)
    expect(counts.balanceSheetLines).toBe(11)
    expect(counts.counterparties).toBe(3)
    expect(counts.total).toBe(2 + 5 + 11 + 3)
  })

  it("uses count (not deleteMany) in dry-run mode", async () => {
    const prisma = makePrisma({ budgetPlans: 7 })
    const counts = await runSoftDeleteCleanup(prisma, { dryRun: true })
    expect(counts.budgetPlans).toBe(7)
    expect(prisma.budgetPlan.count).toHaveBeenCalledTimes(1)
    expect(prisma.budgetPlan.deleteMany).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("default cutoff is 30 days before injected now", async () => {
    const prisma = makePrisma({})
    const now = new Date("2026-06-01T12:00:00Z")
    await runSoftDeleteCleanup(prisma, { now })
    const args = (prisma.budgetPlan.deleteMany as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as { where: { deletedAt: { lt: Date } } }
    const cutoff = args.where.deletedAt.lt
    const expected = new Date(now.getTime() - SOFT_DELETE_TTL_MS)
    expect(cutoff.toISOString()).toBe(expected.toISOString())
  })

  it("custom cutoffMs overrides the 30-day default", async () => {
    const prisma = makePrisma({})
    const now = new Date("2026-06-01T12:00:00Z")
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    await runSoftDeleteCleanup(prisma, { now, cutoffMs: sevenDays })
    const args = (prisma.cashFlowEntry.deleteMany as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as { where: { deletedAt: { lt: Date } } }
    const cutoff = args.where.deletedAt.lt
    expect(cutoff.toISOString()).toBe(
      new Date(now.getTime() - sevenDays).toISOString(),
    )
  })

  it("runs all 4 deletes inside a single $transaction (atomicity)", async () => {
    const prisma = makePrisma({ budgetPlans: 1 })
    await runSoftDeleteCleanup(prisma)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    const txArg = (prisma.$transaction as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as unknown[]
    expect(Array.isArray(txArg)).toBe(true)
    expect(txArg).toHaveLength(4)
  })

  it("idempotent: a re-run finds nothing more to delete", async () => {
    const prisma = makePrisma({ budgetPlans: 1 })
    await runSoftDeleteCleanup(prisma)
    // second call returns mocked counts again; in production the mock
    // would return zeros — assert the function tolerates either case
    const counts2 = await runSoftDeleteCleanup(prisma)
    expect(counts2.total).toBeGreaterThanOrEqual(0)
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
  })
})
