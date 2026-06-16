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

// Phase 2.1 session 3: BudgetLine.category column dropped. Fake stores
// accountId; defaultReadActualSums reads via `select: { account: { code } }`
// — mock derives a fake account.code by stripping the `coa_` prefix
// the R fixture uses (`accountId: coa_${category}`).
interface FakeBudgetLineRow {
  organizationId: string
  companyId: string
  accountId: string
  lineType: string
  plannedAmount: number
  currencyCode: string | null
  exchangeRate: number | null
  monthIndex: number | null
  sortOrder: number | null
  planId: string
  sourceDocument: string
  deletedAt: Date | null
  deletedBy: string | null
}

function accountCodeFromId(accountId: string): string {
  return accountId.startsWith("coa_") ? accountId.slice(4) : accountId
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
          const w = args.where as { organizationId?: string; companyId?: { in: string[] }; deletedAt?: null; planId?: { in: string[] }; plan?: { year?: { in: number[] } } }
          if (w.organizationId && row.organizationId !== w.organizationId) continue
          if (w.companyId && !w.companyId.in.includes(row.companyId)) continue
          if (w.deletedAt === null && row.deletedAt !== null) continue
          // Honor the planId scope (the 2026-06-16 cross-plan clean-slate
          // fix) and the periodFilter relation (`plan.year`) so the mock
          // faithfully reproduces Prisma's AND semantics.
          if (w.planId && !w.planId.in.includes(row.planId)) continue
          if (w.plan?.year && !w.plan.year.in.includes(yearById[row.planId] ?? 2026)) continue
          Object.assign(row, args.data)
          count += 1
        }
        return { count }
      }),
      deleteMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const w = args.where as { organizationId?: string; companyId?: { in: string[] }; deletedAt?: { not: null }; planId?: { in: string[] }; plan?: { year?: { in: number[] } } }
        let count = 0
        for (let i = budgetLines.length - 1; i >= 0; i--) {
          const row = budgetLines[i]
          if (w.organizationId && row.organizationId !== w.organizationId) continue
          if (w.companyId && !w.companyId.in.includes(row.companyId)) continue
          if (w.deletedAt?.not === null && row.deletedAt === null) continue
          if (w.planId && !w.planId.in.includes(row.planId)) continue
          if (w.plan?.year && !w.plan.year.in.includes(yearById[row.planId] ?? 2026)) continue
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
            accountId: d.accountId!,
            lineType: d.lineType!,
            plannedAmount: d.plannedAmount!,
            currencyCode: d.currencyCode ?? null,
            exchangeRate: d.exchangeRate ?? null,
            monthIndex: d.monthIndex ?? null,
            sortOrder: d.sortOrder ?? null,
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
            plannedAmount: r.plannedAmount,
            monthIndex: r.monthIndex,
            plan: { year: yearById[r.planId] ?? 2026 },
            // Production read uses `select: { account: { code: true } }`;
            // mock derives the code from accountId (R fixture sets
            // `coa_${category}`).
            account: { code: accountCodeFromId(r.accountId) },
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
  accountId: `coa_${category}`,
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

describe("runImportBatch — clean-slate is scoped to the TARGET plan (cross-plan wipe regression)", () => {
  it("importing into the ACTUALS plan does NOT archive the same-year BUDGET plan's lines", async () => {
    // Regression for the 2026-06-11 budget wipe. The archive matched by
    // org+company+year ONLY, so an AI multi-file import targeting the 2026
    // ACTUALS plan soft-deleted the matching-year 2026 BUDGET plan's lines
    // as collateral (2700 budget rows lost; the Workspace then defaulted to
    // the actuals plan and showed a tautological "100% executed"). The fix
    // scopes the clean-slate to the rows' own planId(s).
    const prisma = makeFakePrisma({
      planYearById: { plan_budget: 2026, plan_actual: 2026 },
      initialRows: [
        // Live 2026 BUDGET lines (January) — must survive an actuals import.
        { organizationId: "org_1", companyId: "c_azsf", accountId: "coa_PLF.BUD.01", lineType: "revenue", plannedAmount: 5000, currencyCode: "AZN", exchangeRate: null, monthIndex: 0, sortOrder: 0, planId: "plan_budget", sourceDocument: "budget.xlsx", deletedAt: null, deletedBy: null },
        { organizationId: "org_1", companyId: "c_azsf", accountId: "coa_PLF.BUD.02", lineType: "revenue", plannedAmount: 7000, currencyCode: "AZN", exchangeRate: null, monthIndex: 0, sortOrder: 0, planId: "plan_budget", sourceDocument: "budget.xlsx", deletedAt: null, deletedBy: null },
      ],
    })
    // Import April actuals into a DIFFERENT plan, SAME company + SAME year.
    const actualRow: ImportBatchRow = {
      companyId: "c_azsf", category: "PLF.ACT.01", accountId: "coa_PLF.ACT.01",
      lineType: "revenue", period: "2026-04", monthIndex: 3, plannedAmount: 1200,
      currencyCode: "AZN", exchangeRate: null, planId: "plan_actual",
      sourceCell: "actuals.xlsx#Sheet1!A1",
    }
    const plan: ImportBatchPlan = {
      organizationId: "org_1", label: "actuals import", actorUserId: "ai-multi-import",
      sourceDocument: "actuals.xlsx", companyIds: ["c_azsf"], periodScope: ["2026-04"],
      rows: [actualRow],
      expectedSums: new Map([[buildReconKey("AZSEKER-AZSF", "PLF.ACT.01", "2026-04"), 1200]]),
    }
    const result = await runImportBatch(prisma, plan)

    // The budget plan's two lines are untouched (still live, none archived).
    expect(prisma.__budgetLines.filter((b) => b.planId === "plan_budget" && b.deletedAt === null)).toHaveLength(2)
    expect(prisma.__budgetLines.filter((b) => b.planId === "plan_budget" && b.deletedAt !== null)).toHaveLength(0)
    // The actuals import landed in its own plan.
    expect(prisma.__budgetLines.filter((b) => b.planId === "plan_actual" && b.deletedAt === null)).toHaveLength(1)
    // Nothing from the sibling plan was archived, and recon is green.
    expect(result.metrics.resetArchived).toBe(0)
    expect(result.reconciliation.verdict).toBe("green")
  })

  it("re-importing the SAME plan still clean-slates that plan (scope didn't over-narrow)", async () => {
    // Guard the other direction: the planId scope must NOT prevent a normal
    // same-plan re-import from archiving its own prior lines.
    const prisma = makeFakePrisma({
      planYearById: { plan_budget: 2026, plan_actual: 2026 },
      initialRows: [
        { organizationId: "org_1", companyId: "c_azsf", accountId: "coa_PLF.ACT.01", lineType: "revenue", plannedAmount: 999, currencyCode: "AZN", exchangeRate: null, monthIndex: 3, sortOrder: 3, planId: "plan_actual", sourceDocument: "old.xlsx", deletedAt: null, deletedBy: null },
      ],
    })
    const actualRow: ImportBatchRow = {
      companyId: "c_azsf", category: "PLF.ACT.01", accountId: "coa_PLF.ACT.01",
      lineType: "revenue", period: "2026-04", monthIndex: 3, plannedAmount: 1200,
      currencyCode: "AZN", exchangeRate: null, planId: "plan_actual",
      sourceCell: "actuals.xlsx#Sheet1!A1",
    }
    const plan: ImportBatchPlan = {
      organizationId: "org_1", label: "re-import", actorUserId: "ai-multi-import",
      sourceDocument: "actuals.xlsx", companyIds: ["c_azsf"], periodScope: ["2026-04"],
      rows: [actualRow],
      expectedSums: new Map([[buildReconKey("AZSEKER-AZSF", "PLF.ACT.01", "2026-04"), 1200]]),
    }
    const result = await runImportBatch(prisma, plan)
    // The prior plan_actual row got archived; the new one is live.
    expect(result.metrics.resetArchived).toBe(1)
    expect(prisma.__budgetLines.filter((b) => b.planId === "plan_actual" && b.deletedAt === null)).toHaveLength(1)
    expect(result.reconciliation.verdict).toBe("green")
  })

  it("rows: [] is a safe no-op — preserves existing live rows (locks the footgun closure)", async () => {
    // Codex review nit: the empty-planIds → `{ in: [] }` → archive-nothing
    // behavior is now safety-critical (it's what stops a parse-zero-rows
    // import from wiping live data with no reinsert). Lock it: a zero-row
    // import must archive NOTHING and leave existing live rows intact.
    const prisma = makeFakePrisma({
      planYearById: { plan_actual: 2026 },
      initialRows: [
        { organizationId: "org_1", companyId: "c_azsf", accountId: "coa_PLF.ACT.01", lineType: "revenue", plannedAmount: 999, currencyCode: "AZN", exchangeRate: null, monthIndex: 0, sortOrder: 0, planId: "plan_actual", sourceDocument: "old.xlsx", deletedAt: null, deletedBy: null },
      ],
    })
    const plan: ImportBatchPlan = {
      organizationId: "org_1", label: "empty import", actorUserId: "ai-multi-import",
      sourceDocument: "empty.xlsx", companyIds: ["c_azsf"], periodScope: ["2026-04"],
      rows: [],
      expectedSums: new Map(),
    }
    const result = await runImportBatch(prisma, plan)
    expect(result.metrics.resetArchived).toBe(0)
    expect(result.metrics.rowsInserted).toBe(0)
    // The pre-existing live row survived the zero-row import.
    expect(prisma.__budgetLines.filter((b) => b.planId === "plan_actual" && b.deletedAt === null)).toHaveLength(1)
  })
})

describe("runImportBatch — sortOrder mirrors monthIndex (month-bucketing invariant)", () => {
  it("writes sortOrder = monthIndex so month/quarter readers bucket correctly", async () => {
    // Regression: the createMany payload previously omitted `sortOrder`, so
    // every imported line fell to the schema default 0. recompute-data-source,
    // the Panel-3 drill-down, and the 12-month series endpoint all treat
    // `sortOrder` as the 0..11 month index — a 0 default collapsed the whole
    // year into January (Feb..Dec read as zero). Lock the writer to mirror
    // monthIndex onto sortOrder.
    const prisma = makeFakePrisma()
    const plan = planFor(
      [
        R("PLF.01.01.01", 100, 0), // Jan
        R("PLF.01.01.02", 200, 5), // Jun
        R("PLF.01.01.03", 300, 11), // Dec
      ],
      { periodScope: ["2026-01", "2026-06", "2026-12"] },
    )
    await runImportBatch(prisma, plan)
    const live = prisma.__budgetLines.filter((b) => b.deletedAt === null)
    expect(live).toHaveLength(3)
    for (const row of live) {
      expect(row.sortOrder).toBe(row.monthIndex)
    }
    expect(new Set(live.map((b) => b.sortOrder))).toEqual(new Set([0, 5, 11]))
  })

  it("falls back to sortOrder 0 when monthIndex is null (annual line; prior behavior preserved)", async () => {
    const prisma = makeFakePrisma()
    const annual: ImportBatchRow = { ...R("PLF.09.09.09", 999, 0), monthIndex: null, period: "2026" }
    const plan = planFor([annual], { periodScope: ["2026"] })
    await runImportBatch(prisma, plan)
    const live = prisma.__budgetLines.filter((b) => b.deletedAt === null)
    expect(live).toHaveLength(1)
    expect(live[0].monthIndex).toBeNull()
    expect(live[0].sortOrder).toBe(0)
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

// ─── Phase 7.M Tier 5 — outer transaction support ─────────────────────────────

describe("runImportBatch — outer-transaction mode (Phase 7.M Tier 5)", () => {
  it("call with PrismaClient still wraps own $transaction (back-compat)", async () => {
    const prisma = makeFakePrisma()
    const txSpy = prisma.$transaction as unknown as ReturnType<typeof vi.fn>
    const plan = planFor([R("PLF.01.01.01", 100)])
    const result = await runImportBatch(prisma, plan)
    expect(txSpy).toHaveBeenCalledTimes(1)
    expect(result.reconciliation.verdict).toBe("green")
  })

  it("call with TransactionClient (no $transaction method) does NOT wrap", async () => {
    const prisma = makeFakePrisma()
    // Simulate a Prisma.TransactionClient: it lacks the $transaction
    // method by definition (the type strips it). We mimic that by
    // creating a proxy that delegates everything to the underlying
    // fake EXCEPT $transaction.
    const tx = new Proxy(prisma, {
      get(target, prop) {
        if (prop === "$transaction") return undefined
        return (target as unknown as Record<string | symbol, unknown>)[prop as string]
      },
    })
    const txSpy = prisma.$transaction as unknown as ReturnType<typeof vi.fn>
    const plan = planFor([R("PLF.01.01.01", 100)])
    const result = await runImportBatch(
      tx as unknown as PrismaClient,
      plan,
    )
    // The outer-tx path must NOT open a new $transaction.
    expect(txSpy).not.toHaveBeenCalled()
    // The write still landed and reconciles green.
    expect(result.reconciliation.verdict).toBe("green")
    expect(prisma.__budgetLines.filter((b) => b.deletedAt === null)).toHaveLength(1)
  })

  it("two batches inside the same outer $transaction share write visibility", async () => {
    const prisma = makeFakePrisma({
      companyCodeById: { c_azsf: "AZSEKER-AZSF", c_cpc: "AZSEKER-CPC" },
    })
    const planA = planFor([R("PLF.01.01.01", 100)], { label: "fileA" })
    const planB = planFor(
      [
        {
          companyId: "c_cpc",
          category: "PLF.02.01.01",
          accountId: "coa_PLF.02.01.01",
          lineType: "revenue",
          period: "2026-04",
          monthIndex: 3,
          plannedAmount: 200,
          currencyCode: "AZN",
          exchangeRate: null,
          planId: "plan_2026",
          sourceCell: "fileB.xlsx#Sheet1!A1",
        },
      ],
      {
        label: "fileB",
        companyIds: ["c_cpc"],
        expectedSums: new Map([
          [buildReconKey("AZSEKER-CPC", "PLF.02.01.01", "2026-04"), 200],
        ]),
      },
    )
    // Run both inside one outer $transaction (the orchestrator pattern).
    const results = await prisma.$transaction(async (tx) => {
      // Strip $transaction so the runner takes the outer-tx path.
      const txClient = new Proxy(tx as unknown as PrismaClient, {
        get(target, prop) {
          if (prop === "$transaction") return undefined
          return (target as unknown as Record<string | symbol, unknown>)[prop as string]
        },
      }) as unknown as PrismaClient
      const ra = await runImportBatch(txClient, planA)
      const rb = await runImportBatch(txClient, planB)
      return [ra, rb]
    })
    expect(results[0].reconciliation.verdict).toBe("green")
    expect(results[1].reconciliation.verdict).toBe("green")
    expect(prisma.__budgetLines.filter((b) => b.deletedAt === null)).toHaveLength(2)
  })

  it("outer-tx mode: a failing later phase short-circuits (caller's tx rolls back)", async () => {
    const prisma = makeFakePrisma()
    const txClient = new Proxy(prisma, {
      get(target, prop) {
        if (prop === "$transaction") return undefined
        return (target as unknown as Record<string | symbol, unknown>)[prop as string]
      },
    }) as unknown as PrismaClient
    const plan = planFor([R("PLF.01.01.01", 100)])
    // Hook into outer code: run two batches inside one $transaction;
    // make the second batch throw, verify the orchestrator sees it.
    let observedError: unknown = null
    try {
      await prisma.$transaction(async () => {
        await runImportBatch(txClient, plan)
        // Force a failure mid-group (simulates a write error in batch 2).
        throw new Error("synthetic mid-group failure")
      })
    } catch (e) {
      observedError = e
    }
    expect(observedError).toBeInstanceOf(Error)
    expect((observedError as Error).message).toMatch(/synthetic mid-group/i)
    // Our fake prisma doesn't actually roll back (mock limitation), but
    // the contract that matters here is: the inner batch did NOT open
    // its own tx (so a real Postgres would roll back the entire outer
    // tx including the first batch's writes).
    const txSpy = prisma.$transaction as unknown as ReturnType<typeof vi.fn>
    // One outer call → the orchestrator's tx. Zero inner calls from
    // runImportBatch (because we passed the txClient proxy).
    expect(txSpy).toHaveBeenCalledTimes(1)
  })
})
