/**
 * 2026-08-18 — the clean-slate scope for a batch that belongs to no company.
 *
 * An elimination row carries `companyId: null` by construction, and the
 * archive scope in `runImportBatch` is derived from the companies the incoming
 * rows name. Left alone, an elimination batch derives `{ in: [] }`, archives
 * NOTHING, and the next import of the same file inserts alongside the previous
 * run — a group elimination that silently doubles every time the operator
 * re-uploads, which is worse than the un-eliminated total it replaced.
 *
 * So the batch gets a scope of its own — `isElimination: true` — exactly as
 * `bs-import-batch.ts` does since Phase 14.8. These tests pin the four things
 * that scope has to be:
 *
 *   narrow      it archives elimination rows and nothing else;
 *   disjoint    an entity import never touches them, and vice versa;
 *   refused     a batch mixing both is an error, not a guess;
 *   verifiable  the post-write read-back finds the rows it just wrote,
 *               instead of reporting every one of them as `missing`.
 *
 * The fake below emulates `isElimination` in every WHERE. That is the point of
 * writing a new one rather than reusing the file next door: a mock that
 * ignores the column would let all four of these pass while the real database
 * did something else — the exact shape of the 2026-08-03 failure, where the
 * mock was more forgiving than Postgres and the production clean-slate turned
 * into a no-op.
 */
import { describe, it, expect, vi } from "vitest"
import {
  runImportBatch,
  ELIMINATION_RECON_ENTITY,
  type ImportBatchPlan,
  type ImportBatchRow,
} from "./import-batch"
import { buildReconKey, type ReconciliationKey } from "./reconciliation"
import type { PrismaClient } from "@prisma/client"

interface FakeRow {
  organizationId: string
  companyId: string | null
  isElimination: boolean
  accountId: string
  lineType: string
  plannedAmount: number
  currencyCode: string | null
  exchangeRate: number | null
  monthIndex: number | null
  sortOrder: number | null
  planId: string
  sourceDocument: string
  origin?: string | null
  deletedAt: Date | null
  deletedBy: string | null
}

type Where = {
  organizationId?: string
  companyId?: { in: string[] }
  isElimination?: boolean
  deletedAt?: null | { not: null }
  planId?: { in: string[] }
  plan?: { year?: { in: number[] } }
  OR?: Array<{ origin?: null | { not: string } }>
}

/** SQL three-valued logic for the nullable `origin` column, as next door. */
function originMatches(row: FakeRow, w: Where): boolean {
  if (!w.OR) return true
  return w.OR.some((c) =>
    c.origin === null
      ? (row.origin ?? null) === null
      : c.origin?.not !== undefined
        ? row.origin != null && row.origin !== c.origin.not
        : true,
  )
}

function matches(row: FakeRow, w: Where, planYear: Record<string, number>): boolean {
  if (w.organizationId && row.organizationId !== w.organizationId) return false
  if (!originMatches(row, w)) return false
  // The column under test. A null-company row is matched ONLY by an explicit
  // `isElimination` filter — never by `companyId: { in: [...] }`, which is how
  // the two scopes stay disjoint in Postgres too.
  if (w.isElimination !== undefined && row.isElimination !== w.isElimination) return false
  if (w.companyId && (row.companyId === null || !w.companyId.in.includes(row.companyId)))
    return false
  if (w.deletedAt === null && row.deletedAt !== null) return false
  if (w.deletedAt && typeof w.deletedAt === "object" && row.deletedAt === null) return false
  if (w.planId && !w.planId.in.includes(row.planId)) return false
  if (w.plan?.year && !w.plan.year.in.includes(planYear[row.planId] ?? 2026)) return false
  return true
}

function makeFake(initial: FakeRow[] = []) {
  const rows: FakeRow[] = [...initial]
  const planYear: Record<string, number> = { plan_2026: 2026 }
  const codeById: Record<string, string> = {
    c_a: "CO-A",
    c_b: "CO-B",
  }
  const fake = {
    __rows: rows,
    budgetLine: {
      updateMany: vi.fn(async (a: { where: Where; data: Record<string, unknown> }) => {
        let count = 0
        for (const r of rows) {
          if (!matches(r, a.where, planYear)) continue
          Object.assign(r, a.data)
          count++
        }
        return { count }
      }),
      deleteMany: vi.fn(async (a: { where: Where }) => {
        let count = 0
        for (let i = rows.length - 1; i >= 0; i--) {
          if (!matches(rows[i], a.where, planYear)) continue
          rows.splice(i, 1)
          count++
        }
        return { count }
      }),
      count: vi.fn(async (a: { where: Where }) =>
        rows.filter((r) => matches(r, a.where, planYear)).length,
      ),
      createMany: vi.fn(async (a: { data: ReadonlyArray<Partial<FakeRow>> }) => {
        for (const d of a.data) {
          rows.push({
            organizationId: d.organizationId!,
            companyId: d.companyId ?? null,
            isElimination: d.isElimination ?? false,
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
        return { count: a.data.length }
      }),
      findMany: vi.fn(async (a: { where: Where }) =>
        rows
          .filter((r) => matches(r, a.where, planYear))
          .map((r) => ({
            companyId: r.companyId,
            isElimination: r.isElimination,
            plannedAmount: r.plannedAmount,
            monthIndex: r.monthIndex,
            plan: { year: planYear[r.planId] ?? 2026 },
            account: { code: r.accountId.replace(/^coa_/, "") },
          })),
      ),
    },
    budgetPlan: { updateMany: vi.fn(async () => ({ count: 1 })) },
    company: {
      findMany: vi.fn(async (a: { where: { id?: { in: string[] } } }) =>
        Object.entries(codeById)
          .filter(([id]) => !a.where.id || a.where.id.in.includes(id))
          .map(([id, code]) => ({ id, code })),
      ),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(fake)),
  }
  return fake as unknown as PrismaClient & { __rows: FakeRow[] }
}

function entityRow(companyId: string, amount: number): ImportBatchRow {
  return {
    companyId,
    category: "PLF.01.01.01",
    lineType: "revenue",
    period: "2026-01",
    monthIndex: 0,
    plannedAmount: amount,
    currencyCode: "AZN",
    exchangeRate: null,
    planId: "plan_2026",
    accountId: "coa_PLF.01.01.01",
    sourceCell: `entity-${companyId}#1`,
  }
}

function elimRow(amount: number, cell = "elim#1"): ImportBatchRow {
  return {
    companyId: null,
    isElimination: true,
    category: "PLF.01.01.04",
    lineType: "revenue",
    period: "2026-01",
    monthIndex: 0,
    plannedAmount: amount,
    currencyCode: "AZN",
    exchangeRate: null,
    planId: "plan_2026",
    accountId: "coa_PLF.01.01.04",
    sourceCell: cell,
  }
}

function plan(rows: ImportBatchRow[], sums: Map<ReconciliationKey, number>): ImportBatchPlan {
  return {
    organizationId: "org_1",
    label: "test",
    actorUserId: "u_1",
    sourceDocument: "test.xlsx",
    companyIds: [],
    periodScope: ["2026-01"],
    rows,
    expectedSums: sums,
  }
}

const elimSums = (amount: number) =>
  new Map([
    [buildReconKey(ELIMINATION_RECON_ENTITY, "PLF.01.01.04", "2026-01"), amount],
  ])

const stored = (fake: { __rows: FakeRow[] }) => fake.__rows.filter((r) => r.deletedAt === null)

describe("elimination batches in runImportBatch", () => {
  it("writes the rows with no company and the flag set", async () => {
    const fake = makeFake()
    const res = await runImportBatch(fake, plan([elimRow(-15218)], elimSums(-15218)))
    expect(res.metrics.rowsInserted).toBe(1)
    const live = stored(fake)
    expect(live).toHaveLength(1)
    expect(live[0].companyId).toBeNull()
    expect(live[0].isElimination).toBe(true)
    // And the post-write read-back FOUND them: a scope that missed would
    // report the expected key as `missing`, which is an unconditional red.
    expect(res.reconciliation.verdict).toBe("green")
  })

  it("replaces the previous elimination import instead of doubling it", async () => {
    const fake = makeFake([
      {
        organizationId: "org_1",
        companyId: null,
        isElimination: true,
        accountId: "coa_PLF.01.01.04",
        lineType: "revenue",
        plannedAmount: -15218,
        currencyCode: "AZN",
        exchangeRate: null,
        monthIndex: 0,
        sortOrder: 0,
        planId: "plan_2026",
        sourceDocument: "elim#1",
        deletedAt: null,
        deletedBy: null,
      },
    ])
    await runImportBatch(fake, plan([elimRow(-15218, "elim#2")], elimSums(-15218)))
    const live = stored(fake)
    // One live row, not two: the prior run was archived by the elimination
    // scope. Doubling here would double the group's whole reversal.
    expect(live).toHaveLength(1)
    expect(live[0].sourceDocument).toBe("elim#2")
  })

  it("never archives a company's own rows", async () => {
    const fake = makeFake([
      {
        organizationId: "org_1",
        companyId: "c_a",
        isElimination: false,
        accountId: "coa_PLF.01.01.01",
        lineType: "revenue",
        plannedAmount: 1000,
        currencyCode: "AZN",
        exchangeRate: null,
        monthIndex: 0,
        sortOrder: 0,
        planId: "plan_2026",
        sourceDocument: "entity#1",
        deletedAt: null,
        deletedBy: null,
      },
    ])
    await runImportBatch(fake, plan([elimRow(-15218)], elimSums(-15218)))
    const live = stored(fake)
    expect(live).toHaveLength(2)
    expect(live.find((r) => r.companyId === "c_a")?.plannedAmount).toBe(1000)
  })

  it("and an entity import never archives the group's eliminations", async () => {
    const fake = makeFake([
      {
        organizationId: "org_1",
        companyId: null,
        isElimination: true,
        accountId: "coa_PLF.01.01.04",
        lineType: "revenue",
        plannedAmount: -15218,
        currencyCode: "AZN",
        exchangeRate: null,
        monthIndex: 0,
        sortOrder: 0,
        planId: "plan_2026",
        sourceDocument: "elim#1",
        deletedAt: null,
        deletedBy: null,
      },
    ])
    const sums = new Map([[buildReconKey("CO-A", "PLF.01.01.01", "2026-01"), 1000]])
    await runImportBatch(fake, plan([entityRow("c_a", 1000)], sums))
    const live = stored(fake)
    expect(live.filter((r) => r.isElimination)).toHaveLength(1)
  })

  it("refuses a batch that mixes eliminations with entity rows", async () => {
    const fake = makeFake()
    await expect(
      runImportBatch(
        fake,
        plan([elimRow(-15218), entityRow("c_a", 1000)], elimSums(-15218)),
      ),
    ).rejects.toThrow(/mixes 1 elimination row/)
    // Nothing was written: one clean-slate cannot express two disjoint scopes,
    // and a partial write here is exactly what the refusal exists to prevent.
    expect(stored(fake)).toHaveLength(0)
  })

  it("refuses a null-company row that does not claim to be an elimination", async () => {
    const fake = makeFake()
    const orphan = { ...entityRow("c_a", 1000), companyId: null }
    await expect(
      runImportBatch(fake, plan([orphan], new Map())),
    ).rejects.toThrow(/carry no companyId/)
  })
})
