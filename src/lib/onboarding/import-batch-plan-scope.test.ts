/**
 * 11.51 — the P&L read-back must be scoped to the plan(s) it wrote.
 *
 * The failure this closes
 * ───────────────────────
 * Observed on production 2026-07-31: importing a workbook holding both
 * `PLF Actual 2026` and `PLF Budget 2026` aborted with "Post-write
 * reconciliation rejected". Every `PLF Budget` sheet was named as drifted;
 * no `PLF Actual` sheet was. Zero rows committed.
 *
 * The clean-slate has been plan-scoped since 2026-06-16 (`planFilter`) — on
 * purpose, because an actuals import must not archive the sibling budget
 * plan (that asymmetry caused the 2026-06-11 wipe of 2700 budget lines). But
 * `defaultReadActualSums` still matched on org+company only, and its key
 * (`company::account::period`) carries no plan dimension. So the budget
 * sheet's own verification read the ACTUALS plan's live rows back in:
 * shared accounts inflated the sum, actuals-only accounts appeared as
 * `extra`, and any `extra` is an unconditional red.
 *
 * Not an ordering bug. Ordering only decides which sheet gets blamed on a
 * virgin database; on any re-import the sibling plan already holds committed
 * rows before either sheet writes, so BOTH go red.
 *
 * Why the existing suite missed it: `import-batch.test.ts`'s fake ignores
 * `planId` in `findMany`, and its one sibling-plan test survives only because
 * the contaminating rows sit in January while its `periodScope` is
 * `["2026-04"]`. Production scopes all twelve months. The fake below honours
 * `planId`, and the contaminating row shares the period under test.
 */
import { describe, it, expect, vi } from "vitest"
import {
  runImportBatch,
  type ImportBatchPlan,
  type ImportBatchRow,
} from "./import-batch"
import { buildReconKey, type ReconciliationKey } from "./reconciliation"
import type { PrismaClient } from "@prisma/client"

interface FakeRow {
  organizationId: string
  companyId: string
  accountId: string
  plannedAmount: number
  monthIndex: number | null
  planId: string
  deletedAt: Date | null
}

const YEAR_BY_PLAN: Record<string, number> = {
  plan_2026_actual: 2026,
  plan_2026_budget: 2026,
}
const CODE_BY_COMPANY: Record<string, string> = { c_azsf: "AZSEKER-AZSF" }

function makeFakePrisma(initialRows: FakeRow[] = []) {
  const rows: FakeRow[] = [...initialRows]
  type Where = {
    organizationId?: string
    companyId?: { in: string[] }
    planId?: { in: string[] }
    deletedAt?: null
    plan?: { year?: { in: number[] } }
  }
  const match = (r: FakeRow, w: Where) => {
    if (w.organizationId && r.organizationId !== w.organizationId) return false
    if (w.companyId && !w.companyId.in.includes(r.companyId)) return false
    // The whole point of this file: the fake HONOURS planId. The sister
    // suite's fake does not, which is why the hole survived there.
    if (w.planId && !w.planId.in.includes(r.planId)) return false
    if (w.deletedAt === null && r.deletedAt !== null) return false
    if (w.plan?.year && !w.plan.year.in.includes(YEAR_BY_PLAN[r.planId] ?? 0))
      return false
    return true
  }
  const fake = {
    __rows: rows,
    budgetLine: {
      updateMany: vi.fn(
        async (args: { where: Where; data: Record<string, unknown> }) => {
          let count = 0
          for (const r of rows) {
            if (!match(r, args.where)) continue
            Object.assign(r, args.data)
            count += 1
          }
          return { count }
        },
      ),
      count: vi.fn(async (args: { where: Where }) =>
        rows.filter((r) => match(r, args.where)).length,
      ),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(
        async (args: {
          data: Array<{
            organizationId: string
            companyId: string
            accountId: string
            plannedAmount: number
            monthIndex: number | null
            planId: string
          }>
        }) => {
          for (const d of args.data) {
            rows.push({
              organizationId: d.organizationId,
              companyId: d.companyId,
              accountId: d.accountId,
              plannedAmount: d.plannedAmount,
              monthIndex: d.monthIndex,
              planId: d.planId,
              deletedAt: null,
            })
          }
          return { count: args.data.length }
        },
      ),
      findMany: vi.fn(async (args: { where: Where }) =>
        rows
          .filter((r) => match(r, args.where))
          .map((r) => ({
            companyId: r.companyId,
            plannedAmount: r.plannedAmount,
            monthIndex: r.monthIndex,
            plan: { year: YEAR_BY_PLAN[r.planId] ?? 2026 },
            account: { code: r.accountId.replace(/^coa_/, "") },
          })),
      ),
    },
    budgetPlan: { updateMany: vi.fn(async () => ({ count: 0 })) },
    company: {
      findMany: vi.fn(async (args: { where: { id: { in: string[] } } }) =>
        args.where.id.in
          .filter((id) => CODE_BY_COMPANY[id])
          .map((id) => ({ id, code: CODE_BY_COMPANY[id] })),
      ),
    },
    $transaction: vi.fn(async (fn: (tx: PrismaClient) => Promise<unknown>) =>
      fn(fake as unknown as PrismaClient),
    ),
  }
  return fake as unknown as PrismaClient & { __rows: FakeRow[] }
}

const MONTH_INDEX = 3 // April
const PERIOD = "2026-04"
/** All twelve months, as production's `buildPeriodScope` produces. */
const FULL_YEAR = Array.from(
  { length: 12 },
  (_, i) => `2026-${String(i + 1).padStart(2, "0")}`,
)

function row(
  code: string,
  plannedAmount: number,
  planId: string,
): ImportBatchRow {
  return {
    companyId: "c_azsf",
    category: code,
    accountId: `coa_${code}`,
    lineType: "revenue",
    period: PERIOD,
    monthIndex: MONTH_INDEX,
    plannedAmount,
    currencyCode: "AZN",
    exchangeRate: null,
    planId,
    sourceCell: `fixture.xlsx#Sheet1!${code}`,
  }
}

function planFor(rows: ReadonlyArray<ImportBatchRow>): ImportBatchPlan {
  const expectedSums = new Map<ReconciliationKey, number>()
  for (const r of rows) {
    const key = buildReconKey("AZSEKER-AZSF", r.category, r.period)
    expectedSums.set(key, (expectedSums.get(key) ?? 0) + r.plannedAmount)
  }
  return {
    organizationId: "org_1",
    label: "fixture",
    actorUserId: "user_test",
    sourceDocument: "fixture.xlsx",
    companyIds: ["c_azsf"],
    periodScope: FULL_YEAR,
    rows,
    expectedSums,
  }
}

/** A live row on the sibling ACTUALS plan, same company/account/month. */
const siblingActual = (code: string, amount: number): FakeRow => ({
  organizationId: "org_1",
  companyId: "c_azsf",
  accountId: `coa_${code}`,
  plannedAmount: amount,
  monthIndex: MONTH_INDEX,
  planId: "plan_2026_actual",
  deletedAt: null,
})

describe("P&L post-write reconciliation — plan scope", () => {
  it("a BUDGET import reconciles GREEN while the sibling ACTUALS plan holds live rows on the same cell", async () => {
    // THE regression. Unscoped, the read-back returns 1000 + 300 = 1300
    // against an expected 300 → drift → red → whole group rolled back.
    const prisma = makeFakePrisma([siblingActual("PLF.01.01.01", 1000)])
    const res = await runImportBatch(
      prisma,
      planFor([row("PLF.01.01.01", 300, "plan_2026_budget")]),
    )

    expect(res.reconciliation.verdict).toBe("green")
    expect(res.reconciliation.matched).toBe(1)
    expect(res.reconciliation.drift).toHaveLength(0)
  })

  it("an account that exists ONLY on the sibling plan is not reported as EXTRA", async () => {
    // The second half of the production failure: even with no shared account
    // code, every actuals-only key became an `extra`, and `extra` is an
    // unconditional red regardless of amounts.
    const prisma = makeFakePrisma([siblingActual("PLF.09.09.09", 4242)])
    const res = await runImportBatch(
      prisma,
      planFor([row("PLF.01.01.01", 300, "plan_2026_budget")]),
    )

    expect(res.reconciliation.extra).toHaveLength(0)
    expect(res.reconciliation.verdict).toBe("green")
  })

  it("leaves the sibling ACTUALS rows live — scoping the READ must not widen the archive", async () => {
    // The 2026-06-11 wipe was the opposite mistake. Pinned together so a
    // future "just make both scopes match" change cannot resurrect it.
    const prisma = makeFakePrisma([siblingActual("PLF.01.01.01", 1000)])
    await runImportBatch(
      prisma,
      planFor([row("PLF.01.01.01", 300, "plan_2026_budget")]),
    )

    const survivors = (prisma as unknown as { __rows: FakeRow[] }).__rows.filter(
      (r) => r.planId === "plan_2026_actual" && r.deletedAt === null,
    )
    expect(survivors).toHaveLength(1)
    expect(survivors[0].plannedAmount).toBe(1000)
  })

  it("still catches a real drift WITHIN the target plan", async () => {
    // Narrowing the read-back must not blind it. A stale row on the SAME plan
    // that the clean-slate did not remove has to keep surfacing.
    const prisma = makeFakePrisma()
    const plan = planFor([row("PLF.01.01.01", 300, "plan_2026_budget")])
    const corrupted = new Map(plan.expectedSums)
    corrupted.set(buildReconKey("AZSEKER-AZSF", "PLF.01.01.01", PERIOD), 999)

    const res = await runImportBatch(prisma, {
      ...plan,
      expectedSums: corrupted,
    })

    expect(res.reconciliation.verdict).toBe("red")
    expect(res.reconciliation.drift).toHaveLength(1)
  })
})
