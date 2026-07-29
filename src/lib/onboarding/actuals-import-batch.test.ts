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
  /** Live rows inside the import's own footprint, as seen by the guard.
   *  Defaults to `deleteCount` so the guard is satisfied unless a test is
   *  deliberately simulating an over-reaching reset. */
  footprintCount?: number
} = {}) {
  const deleteMany = vi.fn(async () => ({ count: opts.deleteCount ?? 0 }))
  const createMany = vi.fn(async () => ({ count: opts.createCount ?? 0 }))
  const findMany = vi.fn(async () => opts.existingActuals ?? [])
  const count = vi.fn(async () => opts.footprintCount ?? opts.deleteCount ?? 0)

  const budgetActual = { deleteMany, createMany, findMany, count }
  const fake = {
    budgetActual,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({ budgetActual })
    }),
  } as unknown as PrismaClient
  return { prisma: fake, deleteMany, createMany, findMany, count }
}

/** Pull the single `AND`-composed WHERE the RESET phase built. */
function resetWhere(deleteMany: ReturnType<typeof vi.fn>) {
  const [arg] = deleteMany.mock.calls[0] as unknown as [
    { where: Record<string, unknown> },
  ]
  return arg.where
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
    // RESET filter: (org, plan) + AND[dateWindow, companyFootprint].
    // Phase 11.1 — the date window and the company scope are composed under
    // `AND` because each can itself be an `OR`, and two `OR` keys cannot
    // coexist in one Prisma WHERE object.
    expect(deleteMany).toHaveBeenCalledOnce()
    expect(resetWhere(deleteMany)).toEqual({
      organizationId: "org_1",
      planId: "plan_1",
      AND: [
        { OR: [{ expenseDate: { startsWith: "2026" } }] },
        // both rows carry companyId null → org-wide bucket only
        { companyId: null },
        // Phase 11.1b — this sheet's own rows only; never hand-entered ones.
        { source: "test.xlsx" },
      ],
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
    expect(result.metrics).toEqual({ resetDeleted: 3, rowsInserted: 2, orphanedRows: 3 })
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
    expect(resetWhere(deleteMany)).toEqual({
      organizationId: "org_1",
      planId: "plan_1",
      AND: [
        { expenseDate: { in: ["2026-03-15"] } },
        { companyId: null },
        { source: "test.xlsx" },
      ],
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

  it("empty rows array: RESET scope matches nothing (no delete-without-reinsert)", async () => {
    // Phase 11.1 — a zero-row parse must NOT wipe the window. The company
    // footprint is empty, so the scope degrades to `{ in: [] }`, which
    // matches no row: the delete runs but can only ever remove 0.
    const { prisma, deleteMany, createMany } = buildPrismaStub({
      deleteCount: 0,
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
    expect(resetWhere(deleteMany)).toEqual({
      organizationId: "org_1",
      planId: "plan_1",
      AND: [
        { OR: [{ expenseDate: { startsWith: "2026" } }] },
        { companyId: { in: [] } },
        { source: "test.xlsx" },
      ],
    })
    expect(createMany).not.toHaveBeenCalled()
    expect(result.metrics).toEqual({ resetDeleted: 0, rowsInserted: 0, orphanedRows: 0 })
  })

  describe("Phase 11.1 — company-scoped reset (derive-delete-from-write)", () => {
    it("scopes the RESET to exactly the companies the batch inserts", async () => {
      const { prisma, deleteMany, count } = buildPrismaStub({ deleteCount: 4 })
      await runActualsBatch(prisma, {
        organizationId: "org_1",
        planId: "plan_1",
        label: "test",
        actorUserId: "u1",
        sourceDocument: "test.xlsx",
        dateScope: ["2026"],
        rows: [
          row("Cat1", 100, "2026-03-15", 2, { companyId: "co_a" }),
          row("Cat2", 200, "2026-04-10", 3, { companyId: "co_b" }),
          row("Cat3", 300, "2026-05-10", 4, { companyId: "co_a" }),
        ],
        expectedSums: new Map(),
      })
      // The sibling company `co_c` is NOT in the footprint, so its actuals
      // are unreachable by this reset — the whole point of 11.1.
      expect(resetWhere(deleteMany)).toEqual({
        organizationId: "org_1",
        planId: "plan_1",
        AND: [
          { OR: [{ expenseDate: { startsWith: "2026" } }] },
          { companyId: { in: ["co_a", "co_b"] } },
          { source: "test.xlsx" },
        ],
      })
      // Two independent counts: the collateral guard's footprint, and the
      // Phase 11.1b orphan probe for rows owned by another source document.
      expect(count).toHaveBeenCalledTimes(2)
    })

    it("mixes named companies and the org-wide (null) bucket under one OR", async () => {
      const { prisma, deleteMany } = buildPrismaStub({ deleteCount: 2 })
      await runActualsBatch(prisma, {
        organizationId: "org_1",
        planId: "plan_1",
        label: "test",
        actorUserId: "u1",
        sourceDocument: "test.xlsx",
        dateScope: ["2026"],
        rows: [
          row("Cat1", 100, "2026-03-15", 2, { companyId: "co_a" }),
          row("Cat2", 200, "2026-03-16", 2), // companyId null → org-wide
        ],
        expectedSums: new Map(),
      })
      expect(resetWhere(deleteMany)).toEqual({
        organizationId: "org_1",
        planId: "plan_1",
        AND: [
          { OR: [{ expenseDate: { startsWith: "2026" } }] },
          { OR: [{ companyId: { in: ["co_a"] } }, { companyId: null }] },
          { source: "test.xlsx" },
        ],
      })
    })

    it("throws CollateralDeletionError when the reset removes more than the footprint", async () => {
      // Simulates the pre-11.1 regression shape: the delete reached 9 rows
      // while only 3 live rows belong to this import. The guard must abort so
      // the surrounding transaction rolls back — BudgetActual has no
      // soft-delete, so an over-reaching purge is unrecoverable.
      const { prisma, createMany } = buildPrismaStub({
        deleteCount: 9,
        footprintCount: 3,
      })
      await expect(
        runActualsBatch(prisma, {
          organizationId: "org_1",
          planId: "plan_1",
          label: "test",
          actorUserId: "u1",
          sourceDocument: "test.xlsx",
          dateScope: ["2026"],
          rows: [row("Cat1", 100, "2026-03-15", 2, { companyId: "co_a" })],
          expectedSums: new Map(),
        }),
      ).rejects.toThrow(/\[clean-slate guard\] BudgetActual/)
      // Aborted BEFORE the insert — no partial state.
      expect(createMany).not.toHaveBeenCalled()
    })

    it("skips the guard entirely when there is no dateScope (append semantics)", async () => {
      const { prisma, deleteMany, count } = buildPrismaStub({})
      await runActualsBatch(prisma, {
        organizationId: "org_1",
        planId: "plan_1",
        label: "test",
        actorUserId: "u1",
        sourceDocument: "test.xlsx",
        dateScope: [],
        rows: [row("Cat1", 100, "2026-03-15", 2, { companyId: "co_a" })],
        expectedSums: new Map(),
      })
      expect(deleteMany).not.toHaveBeenCalled()
      expect(count).not.toHaveBeenCalled()
    })

    it("reads reconciliation sums back through the same company footprint", async () => {
      // Without this the key (planId, category, monthIndex) would fold a
      // sibling company's surviving rows into the comparison and report a
      // false mismatch — a regression the plan-wide purge used to mask.
      const { prisma, findMany } = buildPrismaStub({
        existingActuals: [{ category: "Cat1", monthIndex: 2, actualAmount: 100 }],
        deleteCount: 1,
      })
      await runActualsBatch(prisma, {
        organizationId: "org_1",
        planId: "plan_1",
        label: "test",
        actorUserId: "u1",
        sourceDocument: "test.xlsx",
        dateScope: ["2026"],
        rows: [row("Cat1", 100, "2026-03-15", 2, { companyId: "co_a" })],
        expectedSums: new Map([[buildReconKey("plan_1", "Cat1", "2"), 100]]),
      })
      const [readArg] = findMany.mock.calls[0] as unknown as [
        { where: Record<string, unknown> },
      ]
      expect(readArg.where).toEqual({
        organizationId: "org_1",
        planId: "plan_1",
        AND: [
          { OR: [{ expenseDate: { startsWith: "2026" } }] },
          { companyId: { in: ["co_a"] } },
        ],
      })
    })
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
        count: vi.fn(async () => 0),
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

  describe("Phase 11.1b — provenance-scoped reset", () => {
    it("never touches rows an import did not write", async () => {
      // BudgetActual has no deletedAt, so deleting a hand-entered actual is
      // unrecoverable. `source IS NULL` marks legacy rows, rows typed in
      // through /budgeting, auto-sync output and snapshots.
      const { prisma, deleteMany } = buildPrismaStub({ deleteCount: 2 })
      await runActualsBatch(prisma, {
        organizationId: "org_1",
        planId: "plan_1",
        label: "test",
        actorUserId: "u1",
        sourceDocument: "budget-actuals-sheet:ACTUALS CPC",
        dateScope: ["2026"],
        rows: [row("Cat1", 100, "2026-03-15", 2, { companyId: "co_a" })],
        expectedSums: new Map(),
      })
      const w = resetWhere(deleteMany) as { AND: Array<Record<string, unknown>> }
      expect(w.AND).toContainEqual({
        source: "budget-actuals-sheet:ACTUALS CPC",
      })
    })

    it("gives each SHEET its own rows, so two sheets stop clobbering", async () => {
      // Two BUDGET_ACTUALS sheets for the same company and year run
      // sequentially in ONE transaction. Company scoping cannot separate them
      // — they share the company — so before this the second sheet's reset
      // deleted the first sheet's inserts and only the last survived.
      const { prisma, deleteMany, createMany } = buildPrismaStub({
        deleteCount: 0,
        createCount: 1,
      })
      const base = {
        organizationId: "org_1",
        planId: "plan_1",
        label: "test",
        actorUserId: "u1",
        dateScope: ["2026"],
        rows: [row("Cat1", 100, "2026-03-15", 2, { companyId: "co_a" })],
        expectedSums: new Map(),
      }
      await runActualsBatch(prisma, { ...base, sourceDocument: "sheet-A" })
      await runActualsBatch(prisma, { ...base, sourceDocument: "sheet-B" })

      const a = resetWhere(deleteMany) as { AND: Array<Record<string, unknown>> }
      const [second] = deleteMany.mock.calls[1] as unknown as [
        { where: { AND: Array<Record<string, unknown>> } },
      ]
      expect(a.AND).toContainEqual({ source: "sheet-A" })
      expect(second.where.AND).toContainEqual({ source: "sheet-B" })
      // Both sheets wrote; neither reset could reach the other's rows.
      expect(createMany).toHaveBeenCalledTimes(2)
    })

    it("stamps the source on every inserted row", async () => {
      const { prisma, createMany } = buildPrismaStub({ createCount: 1 })
      await runActualsBatch(prisma, {
        organizationId: "org_1",
        planId: "plan_1",
        label: "test",
        actorUserId: "u1",
        sourceDocument: "sheet-A",
        dateScope: ["2026"],
        rows: [row("Cat1", 100, "2026-03-15", 2, { companyId: "co_a" })],
        expectedSums: new Map(),
      })
      const [arg] = createMany.mock.calls[0] as unknown as [
        { data: Array<Record<string, unknown>> },
      ]
      expect(arg.data[0]).toMatchObject({ source: "sheet-A" })
    })

    it("REPORTS rows left behind by a renamed sheet instead of hiding them", async () => {
      // Renaming a sheet changes its ownership key, so the previous run's
      // rows are unreachable by this reset. Widening the scope would restore
      // the clobber; staying silent would leave a stale layer inflating every
      // actuals total. So: counted and returned.
      const { prisma } = buildPrismaStub({ deleteCount: 1, footprintCount: 7 })
      const r = await runActualsBatch(prisma, {
        organizationId: "org_1",
        planId: "plan_1",
        label: "test",
        actorUserId: "u1",
        sourceDocument: "sheet-renamed",
        dateScope: ["2026"],
        rows: [row("Cat1", 100, "2026-03-15", 2, { companyId: "co_a" })],
        expectedSums: new Map(),
      })
      expect(r.metrics.orphanedRows).toBe(7)
    })
  })
})
