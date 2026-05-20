/**
 * Phase 7.M Step 6 — round-trip integration tests for `runImportBatch`.
 *
 * Strategy: mock the Prisma client at the method level (no DB) and
 * pass synthetic rows + expected sums. The tests below prove the
 * three round-trip invariants that finance trust depends on:
 *
 *   1. Exact xlsx → DB → reconciliation = 🟢 (bit-perfect happy path).
 *   2. Re-importing the same file twice = still 🟢 (idempotency).
 *   3. Mutating one cell by < tolerance = 🟢; by > 1% = 🔴.
 */
import { describe, it, expect, vi } from "vitest"
import { runImportBatch, type ImportBatchPlan, type ImportBatchRow } from "./import-batch"
import { buildReconKey, type ReconciliationKey } from "./reconciliation"
import type { PrismaClient } from "@prisma/client"

// ─── Synthetic Prisma client ────────────────────────────────────────────────

interface FakeBudgetLineRow {
  organizationId: string
  companyId: string
  category: string
  lineType: string
  plannedAmount: number
  currencyCode: string | null
  exchangeRate: number | null
  monthIndex: number | null
  planId: string
  sourceDocument: string
  deletedAt: Date | null
  deletedBy: string | null
}

function makeFakePrisma(opts: {
  initialRows?: FakeBudgetLineRow[]
  companyCodeById?: Record<string, string>
  planYearById?: Record<string, number>
} = {}): PrismaClient & {
  __budgetLines: FakeBudgetLineRow[]
} {
  const budgetLines: FakeBudgetLineRow[] = [...(opts.initialRows ?? [])]
  const codeById = opts.companyCodeById ?? { c_azsf: "AZSEKER-AZSF" }
  const yearById = opts.planYearById ?? { plan_2026: 2026 }

  const fake = {
    __budgetLines: budgetLines,
    budgetLine: {
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0
        for (const row of budgetLines) {
          const w = args.where as { organizationId?: string; companyId?: { in: string[] }; deletedAt?: null }
          if (w.organizationId && row.organizationId !== w.organizationId) continue
          if (w.companyId && !w.companyId.in.includes(row.companyId)) continue
          if (w.deletedAt === null && row.deletedAt !== null) continue
          Object.assign(row, args.data)
          count += 1
        }
        return { count }
      }),
      deleteMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const w = args.where as { organizationId?: string; companyId?: { in: string[] }; deletedAt?: { not: null } }
        let count = 0
        for (let i = budgetLines.length - 1; i >= 0; i--) {
          const row = budgetLines[i]
          if (w.organizationId && row.organizationId !== w.organizationId) continue
          if (w.companyId && !w.companyId.in.includes(row.companyId)) continue
          if (w.deletedAt?.not === null && row.deletedAt === null) continue
          budgetLines.splice(i, 1)
          count += 1
        }
        return { count }
      }),
      createMany: vi.fn(async (args: { data: ReadonlyArray<Partial<FakeBudgetLineRow>> }) => {
        for (const d of args.data) {
          budgetLines.push({
            organizationId: d.organizationId!,
            companyId: d.companyId!,
            category: d.category!,
            lineType: d.lineType!,
            plannedAmount: d.plannedAmount!,
            currencyCode: d.currencyCode ?? null,
            exchangeRate: d.exchangeRate ?? null,
            monthIndex: d.monthIndex ?? null,
            planId: d.planId!,
            sourceDocument: d.sourceDocument ?? "",
            deletedAt: null,
            deletedBy: null,
          })
        }
        return { count: args.data.length }
      }),
      findMany: vi.fn(async (args: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
        const w = args.where as { organizationId?: string; companyId?: { in: string[] }; deletedAt?: null }
        return budgetLines
          .filter((r) => {
            if (w.organizationId && r.organizationId !== w.organizationId) return false
            if (w.companyId && !w.companyId.in.includes(r.companyId)) return false
            if (w.deletedAt === null && r.deletedAt !== null) return false
            return true
          })
          .map((r) => ({
            companyId: r.companyId,
            category: r.category,
            plannedAmount: r.plannedAmount,
            monthIndex: r.monthIndex,
            plan: { year: yearById[r.planId] ?? 2026 },
          }))
      }),
    },
    budgetPlan: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    company: {
      findMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => {
        return args.where.id.in
          .filter((id) => codeById[id])
          .map((id) => ({ id, code: codeById[id] }))
      }),
    },
    $transaction: vi.fn(async (fn: (tx: PrismaClient) => Promise<unknown>) => {
      return fn(fake as unknown as PrismaClient)
    }),
  }
  return fake as unknown as PrismaClient & { __budgetLines: FakeBudgetLineRow[] }
}

// ─── Helper to build a plan ──────────────────────────────────────────────────

function planFor(
  rows: ReadonlyArray<ImportBatchRow>,
  opts: Partial<ImportBatchPlan> = {},
): ImportBatchPlan {
  const expected = new Map<ReconciliationKey, number>()
  for (const r of rows) {
    const code = "AZSEKER-AZSF" // single-company fixture
    const key = buildReconKey(code, r.category, r.period)
    expected.set(key, (expected.get(key) ?? 0) + r.plannedAmount)
  }
  return {
    organizationId: "org_1",
    label: "fixture",
    actorUserId: "user_test",
    sourceDocument: "fixture.xlsx",
    companyIds: ["c_azsf"],
    periodScope: ["2026-04"],
    rows,
    expectedSums: expected,
    ...opts,
  }
}

const R = (
  category: string,
  plannedAmount: number,
  monthIndex: number = 3, // April
): ImportBatchRow => ({
  companyId: "c_azsf",
  category,
  lineType: "revenue",
  period: `2026-${String(monthIndex + 1).padStart(2, "0")}`,
  monthIndex,
  plannedAmount,
  currencyCode: "AZN",
  exchangeRate: null,
  planId: "plan_2026",
  sourceCell: `fixture.xlsx#Sheet1!A${plannedAmount}`,
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("runImportBatch — bit-perfect round-trip", () => {
  it("first import → reconciliation = green, all rows inserted", async () => {
    const prisma = makeFakePrisma()
    const plan = planFor([
      R("PLF.01.01.01", 1234.56),
      R("PLF.01.01.02", 5678.9),
      R("PLF.01.02.01", 100),
    ])
    const result = await runImportBatch(prisma, plan)
    expect(result.metrics.rowsInserted).toBe(3)
    expect(result.metrics.resetArchived).toBe(0)
    expect(result.reconciliation.verdict).toBe("green")
    expect(result.reconciliation.matched).toBe(3)
    expect(result.reconciliation.drift).toEqual([])
    expect(result.reconciliation.missing).toEqual([])
    expect(result.reconciliation.extra).toEqual([])
  })

  it("re-importing the same file twice yields green and live row count stays bit-perfect", async () => {
    const prisma = makeFakePrisma()
    const plan = planFor([R("PLF.01.01.01", 1000), R("PLF.01.01.02", 2000)])
    // First import → 2 live rows.
    const r1 = await runImportBatch(prisma, plan)
    expect(r1.reconciliation.verdict).toBe("green")
    expect(prisma.__budgetLines.filter((b) => b.deletedAt === null)).toHaveLength(2)
    // Second import with purgeArchivedFirst=true. Since no rows are
    // archived yet (first import only wrote live), purge step does
    // nothing — it's the soft-archive of currently-live rows that
    // does the work + the new write.
    const r2 = await runImportBatch(prisma, { ...plan, purgeArchivedFirst: true })
    expect(r2.metrics.resetPurged).toBe(0)
    expect(r2.metrics.resetArchived).toBe(2)
    expect(r2.metrics.rowsInserted).toBe(2)
    expect(r2.reconciliation.verdict).toBe("green")
    // The live state matches the file expected sums bit-perfectly.
    const livePost = prisma.__budgetLines.filter((b) => b.deletedAt === null)
    expect(livePost).toHaveLength(2)
  })

  it("third import with purgeArchivedFirst purges previous archive tail (keeps DB bounded)", async () => {
    const prisma = makeFakePrisma()
    const plan = planFor([R("PLF.01.01.01", 1000)])
    await runImportBatch(prisma, plan) // 1 live
    await runImportBatch(prisma, plan) // 1 archived + 1 live = 2 physical
    expect(prisma.__budgetLines).toHaveLength(2)
    const r3 = await runImportBatch(prisma, { ...plan, purgeArchivedFirst: true })
    // Purge step removes the 1 archived from the 2nd import.
    expect(r3.metrics.resetPurged).toBe(1)
    // Archive step soft-deletes the 1 live row from the 2nd import.
    expect(r3.metrics.resetArchived).toBe(1)
    // Total physical now: 1 archived + 1 live = 2 (stayed bounded).
    expect(prisma.__budgetLines).toHaveLength(2)
    expect(r3.reconciliation.verdict).toBe("green")
  })

  it("re-importing without purge soft-archives previous rows + writes new ones", async () => {
    const prisma = makeFakePrisma()
    const plan = planFor([R("PLF.01.01.01", 1000)])
    await runImportBatch(prisma, plan)
    const r2 = await runImportBatch(prisma, plan)
    expect(r2.metrics.resetArchived).toBe(1) // archived the previous live row
    expect(r2.metrics.resetPurged).toBe(0) // soft-delete kept around
    expect(r2.reconciliation.verdict).toBe("green")
    // Total physical rows: 1 archived + 1 live = 2.
    expect(prisma.__budgetLines).toHaveLength(2)
    const live = prisma.__budgetLines.filter((b) => b.deletedAt === null)
    expect(live).toHaveLength(1)
  })
})

describe("runImportBatch — drift detection", () => {
  it("synthetic mismatch under 1% pct → yellow (small drift bucket)", async () => {
    const prisma = makeFakePrisma()
    // Wrote 999, file said 1000 → 0.1% drift, below the yellow threshold.
    const plan = planFor([R("PLF.01.01.01", 999)])
    const tampered: ImportBatchPlan = {
      ...plan,
      expectedSums: new Map([
        [buildReconKey("AZSEKER-AZSF", "PLF.01.01.01", "2026-04"), 1000],
      ]),
    }
    const result = await runImportBatch(prisma, tampered)
    expect(result.reconciliation.verdict).toBe("yellow")
    expect(result.reconciliation.drift).toHaveLength(1)
    expect(result.reconciliation.drift[0]).toMatchObject({
      expected: 1000,
      actual: 999,
      drift: -1,
    })
  })

  it("synthetic mismatch over 1% pct → red", async () => {
    const prisma = makeFakePrisma()
    // Wrote 50, file said 100 → 50% drift, well past the threshold.
    const plan = planFor([R("PLF.01.01.01", 50)])
    const tampered: ImportBatchPlan = {
      ...plan,
      expectedSums: new Map([
        [buildReconKey("AZSEKER-AZSF", "PLF.01.01.01", "2026-04"), 100],
      ]),
    }
    const result = await runImportBatch(prisma, tampered)
    expect(result.reconciliation.verdict).toBe("red")
    expect(result.reconciliation.drift[0].driftPct).toBeCloseTo(0.5, 5)
  })

  it("sub-tolerance drift (0.001 AZN) still green", async () => {
    const prisma = makeFakePrisma()
    const plan = planFor([R("PLF.01.01.01", 1234.561)])
    // Expected map rounds to 2dp.
    const tightened: ImportBatchPlan = {
      ...plan,
      expectedSums: new Map([
        [buildReconKey("AZSEKER-AZSF", "PLF.01.01.01", "2026-04"), 1234.56],
      ]),
    }
    const result = await runImportBatch(prisma, tightened)
    expect(result.reconciliation.verdict).toBe("green")
  })
})

describe("runImportBatch — recompute hook is invoked exactly once per affected pair", () => {
  it("hook receives the deduplicated (companyId, period) tuples", async () => {
    const prisma = makeFakePrisma()
    const plan = planFor([
      R("PLF.01.01.01", 100, 3),
      R("PLF.01.01.02", 200, 3),
      R("PLF.01.02.01", 300, 4),
    ])
    const recompute = vi.fn(async () => 14)
    const result = await runImportBatch(prisma, plan, { recompute })
    expect(recompute).toHaveBeenCalledTimes(1)
    const call = (recompute.mock.calls as unknown as Array<
      [{ organizationId: string; affected: Array<{ companyId: string; period: string }> }]
    >)[0][0]
    expect(call.organizationId).toBe("org_1")
    // 3 rows but only 2 distinct (companyId, period) pairs.
    expect(call.affected).toHaveLength(2)
    expect(result.metrics.recomputedIvCount).toBe(14)
  })

  it("recompute throw is captured (non-fatal) — verdict still computed", async () => {
    const prisma = makeFakePrisma()
    const plan = planFor([R("PLF.01.01.01", 100)])
    const recompute = vi.fn(async () => {
      throw new Error("recompute pipeline down")
    })
    const result = await runImportBatch(prisma, plan, { recompute })
    expect(result.metrics.recomputedIvCount).toBe(0)
    // Write succeeded → reconciliation still green.
    expect(result.reconciliation.verdict).toBe("green")
  })
})
