/**
 * Phase 7.M Step 6 — round-trip tests for `runBalanceSheetBatch`.
 *
 * Mirrors import-batch.test.ts (P&L sister) — same fake-Prisma harness
 * shape but adapted for balance_sheet_lines fields (planId / accountCode
 * / year + month flat columns instead of companyId / category /
 * monthIndex).
 */
import { describe, it, expect, vi } from "vitest"
import {
  runBalanceSheetBatch,
  type BsImportPlan,
  type BsImportRow,
} from "./bs-import-batch"
import { buildReconKey, type ReconciliationKey } from "./reconciliation"
import type { PrismaClient } from "@prisma/client"

// Phase 2.1 session 3: accountCode + accountName columns dropped from
// BalanceSheetLine. Test fake stores accountId; we derive a display
// `accountCode` for reconciliation keys by stripping the `coa_` prefix
// the R fixture uses (production reads via `select: { account: { code } }`,
// mocked further down).
interface FakeBsRow {
  organizationId: string
  planId: string
  companyId: string | null
  accountId: string
  lineType: string
  subType: string | null
  year: number
  month: number
  amount: number
  notes: string | null
  deletedAt: Date | null
  deletedBy: string | null
}

function accountCodeFromId(accountId: string): string {
  return accountId.startsWith("coa_") ? accountId.slice(4) : accountId
}

function makeFakePrisma(opts: { initialRows?: FakeBsRow[] } = {}): PrismaClient & {
  __bs: FakeBsRow[]
} {
  const bs: FakeBsRow[] = [...(opts.initialRows ?? [])]
  const fake = {
    __bs: bs,
    balanceSheetLine: {
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0
        const w = args.where as {
          organizationId?: string
          planId?: { in: string[] }
          companyId?: { in: string[] }
          deletedAt?: null
          year?: { in: number[] }
        }
        for (const r of bs) {
          if (w.organizationId && r.organizationId !== w.organizationId) continue
          if (w.planId && !w.planId.in.includes(r.planId)) continue
          if (w.companyId && (r.companyId == null || !w.companyId.in.includes(r.companyId))) continue
          if (w.deletedAt === null && r.deletedAt !== null) continue
          if (w.year && !w.year.in.includes(r.year)) continue
          Object.assign(r, args.data)
          count += 1
        }
        return { count }
      }),
      count: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const w = args.where as {
          organizationId?: string
          planId?: { in: string[] }
          companyId?: { in: string[] }
          deletedAt?: null
          year?: { in: number[] }
        }
        let n = 0
        for (const r of bs) {
          if (w.organizationId && r.organizationId !== w.organizationId) continue
          if (w.planId && !w.planId.in.includes(r.planId)) continue
          if (w.companyId && (r.companyId == null || !w.companyId.in.includes(r.companyId))) continue
          if (w.deletedAt === null && r.deletedAt !== null) continue
          if (w.year && !w.year.in.includes(r.year)) continue
          n += 1
        }
        return n
      }),
      deleteMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const w = args.where as {
          organizationId?: string
          planId?: { in: string[] }
          companyId?: { in: string[] }
          deletedAt?: { not: null }
          year?: { in: number[] }
        }
        let count = 0
        for (let i = bs.length - 1; i >= 0; i--) {
          const r = bs[i]
          if (w.organizationId && r.organizationId !== w.organizationId) continue
          if (w.planId && !w.planId.in.includes(r.planId)) continue
          if (w.companyId && (r.companyId == null || !w.companyId.in.includes(r.companyId))) continue
          if (w.deletedAt?.not === null && r.deletedAt === null) continue
          if (w.year && !w.year.in.includes(r.year)) continue
          bs.splice(i, 1)
          count += 1
        }
        return { count }
      }),
      createMany: vi.fn(async (args: { data: ReadonlyArray<Partial<FakeBsRow>> }) => {
        for (const d of args.data) {
          bs.push({
            organizationId: d.organizationId!,
            planId: d.planId!,
            companyId: d.companyId ?? null,
            accountId: d.accountId!,
            lineType: d.lineType!,
            subType: d.subType ?? null,
            year: d.year!,
            month: d.month!,
            amount: d.amount!,
            notes: d.notes ?? null,
            deletedAt: null,
            deletedBy: null,
          })
        }
        return { count: args.data.length }
      }),
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const w = args.where as {
          organizationId?: string
          planId?: { in: string[] }
          companyId?: { in: string[] }
          deletedAt?: null
          year?: { in: number[] }
        }
        return bs
          .filter((r) => {
            if (w.organizationId && r.organizationId !== w.organizationId) return false
            if (w.planId && !w.planId.in.includes(r.planId)) return false
            if (w.companyId && (r.companyId == null || !w.companyId.in.includes(r.companyId))) return false
            if (w.deletedAt === null && r.deletedAt !== null) return false
            if (w.year && !w.year.in.includes(r.year)) return false
            return true
          })
          .map((r) => ({
            planId: r.planId,
            // Phase 2.1 session 3: production read uses
            // `select: { account: { code: true } }` via the FK; mock
            // derives the code from the stored accountId.
            account: { code: accountCodeFromId(r.accountId) },
            year: r.year,
            month: r.month,
            amount: r.amount,
          }))
      }),
    },
    $transaction: vi.fn(async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(fake as unknown as PrismaClient)),
  }
  return fake as unknown as PrismaClient & { __bs: FakeBsRow[] }
}

const R = (
  accountCode: string,
  amount: number,
  month: number = 4,
  companyId: string | null = null,
): BsImportRow => ({
  planId: "plan_2026",
  companyId,
  accountCode,
  accountId: `coa_${accountCode}`,
  lineType: "asset",
  subType: "current_asset",
  year: 2026,
  month,
  amount,
  sourceCell: `fixture.xlsx#BS!${accountCode}@2026-${String(month).padStart(2, "0")}`,
})

function planFor(
  rows: ReadonlyArray<BsImportRow>,
  overrides: Partial<BsImportPlan> = {},
): BsImportPlan {
  const expected = new Map<ReconciliationKey, number>()
  for (const r of rows) {
    const period = `${r.year}-${String(r.month).padStart(2, "0")}`
    const key = buildReconKey(r.planId, r.accountCode, period)
    expected.set(key, (expected.get(key) ?? 0) + r.amount)
  }
  return {
    organizationId: "org_1",
    label: "fixture-bs",
    actorUserId: "user_test",
    sourceDocument: "fixture.xlsx",
    planIds: ["plan_2026"],
    periodScope: ["2026-04"],
    rows,
    expectedSums: expected,
    ...overrides,
  }
}

describe("runBalanceSheetBatch — round-trip", () => {
  it("first import yields verdict green and all rows inserted", async () => {
    const prisma = makeFakePrisma()
    const result = await runBalanceSheetBatch(
      prisma,
      planFor([R("BS.01.01.01", 100_000), R("BS.02.01.01", 50_000)]),
    )
    expect(result.metrics.rowsInserted).toBe(2)
    expect(result.metrics.resetArchived).toBe(0)
    expect(result.reconciliation.verdict).toBe("green")
    expect(result.reconciliation.matched).toBe(2)
  })

  it("re-import same data without purge → live=N, archive tail grows", async () => {
    const prisma = makeFakePrisma()
    const plan = planFor([R("BS.01.01.01", 1000)])
    await runBalanceSheetBatch(prisma, plan)
    const second = await runBalanceSheetBatch(prisma, plan)
    expect(second.metrics.resetArchived).toBe(1)
    expect(second.metrics.resetPurged).toBe(0)
    expect(second.reconciliation.verdict).toBe("green")
    const live = prisma.__bs.filter((r) => r.deletedAt === null)
    expect(live).toHaveLength(1)
  })

  it("re-import with purgeArchivedFirst keeps tail bounded", async () => {
    const prisma = makeFakePrisma()
    const plan = planFor([R("BS.01.01.01", 1000)])
    await runBalanceSheetBatch(prisma, plan) // 1 live
    await runBalanceSheetBatch(prisma, plan) // 1 archived + 1 live = 2 total
    const third = await runBalanceSheetBatch(prisma, { ...plan, purgeArchivedFirst: true })
    expect(third.metrics.resetPurged).toBe(1)
    expect(third.metrics.resetArchived).toBe(1)
    expect(third.reconciliation.verdict).toBe("green")
    expect(prisma.__bs).toHaveLength(2)
  })

  it("drift > 1% pct → red", async () => {
    const prisma = makeFakePrisma()
    const plan = planFor([R("BS.01.01.01", 50)])
    const tampered: BsImportPlan = {
      ...plan,
      expectedSums: new Map([
        [buildReconKey("plan_2026", "BS.01.01.01", "2026-04"), 100],
      ]),
    }
    const r = await runBalanceSheetBatch(prisma, tampered)
    expect(r.reconciliation.verdict).toBe("red")
  })
})

// ─── Phase 7.M Tier 5 — outer transaction support ─────────────────────────────

describe("runBalanceSheetBatch — outer-transaction mode (Phase 7.M Tier 5)", () => {
  it("call with PrismaClient still wraps own $transaction (back-compat)", async () => {
    const prisma = makeFakePrisma()
    const txSpy = prisma.$transaction as unknown as ReturnType<typeof vi.fn>
    const plan = planFor([R("BS.01.01.01", 100)])
    const result = await runBalanceSheetBatch(prisma, plan)
    expect(txSpy).toHaveBeenCalledTimes(1)
    expect(result.reconciliation.verdict).toBe("green")
  })

  it("call with TransactionClient (no $transaction method) does NOT wrap", async () => {
    const prisma = makeFakePrisma()
    const tx = new Proxy(prisma, {
      get(target, prop) {
        if (prop === "$transaction") return undefined
        return (target as unknown as Record<string | symbol, unknown>)[prop as string]
      },
    })
    const txSpy = prisma.$transaction as unknown as ReturnType<typeof vi.fn>
    const plan = planFor([R("BS.01.01.01", 100)])
    const result = await runBalanceSheetBatch(
      tx as unknown as PrismaClient,
      plan,
    )
    expect(txSpy).not.toHaveBeenCalled()
    expect(result.reconciliation.verdict).toBe("green")
    expect(prisma.__bs.filter((r) => r.deletedAt === null)).toHaveLength(1)
  })

  it("two batches inside the same outer $transaction share visibility", async () => {
    const prisma = makeFakePrisma()
    // Different planIds so the second batch's reset doesn't archive
    // the first batch's writes — mirrors the real multi-file pattern
    // where each entity gets its own plan slice.
    const planA = planFor(
      [
        {
          ...R("BS.01.01.01", 100),
          planId: "plan_A",
        },
      ],
      { label: "fileA", planIds: ["plan_A"] },
    )
    const planB = planFor(
      [
        {
          ...R("BS.02.01.01", 200),
          planId: "plan_B",
        },
      ],
      { label: "fileB", planIds: ["plan_B"] },
    )
    const results = await prisma.$transaction(async (tx) => {
      const txClient = new Proxy(tx as unknown as PrismaClient, {
        get(target, prop) {
          if (prop === "$transaction") return undefined
          return (target as unknown as Record<string | symbol, unknown>)[prop as string]
        },
      }) as unknown as PrismaClient
      const ra = await runBalanceSheetBatch(txClient, planA)
      const rb = await runBalanceSheetBatch(txClient, planB)
      return [ra, rb]
    })
    expect(results[0].reconciliation.verdict).toBe("green")
    expect(results[1].reconciliation.verdict).toBe("green")
    expect(prisma.__bs.filter((r) => r.deletedAt === null)).toHaveLength(2)
  })
})

// ─── 2026-05-31 cross-archive bugfix — per-entity (companyId) reset scope ──────
// Real AzerSheker shape: ALL entities live on ONE shared plan ("Azərşəkər 2026
// Budget"). The reset was scoped by planId only, so a per-entity batch archived
// siblings' live BS — the 2026-05-26 multi-import left CPC/AZSF/EDEN with zero
// live balance sheet (only the last-written entity, MALT, survived). These tests
// pin the fix: reset/recon are now scoped by companyId.
describe("runBalanceSheetBatch — per-entity isolation on a shared plan", () => {
  it("one company's batch does NOT archive a sibling's live BS on the SAME plan", async () => {
    const prisma = makeFakePrisma()
    await runBalanceSheetBatch(prisma, planFor([R("BS.01.01.01", 100, 4, "co_A")], { label: "CPC" }))
    // Pre-fix: this second batch's planId-scoped reset archived co_A.
    // Post-fix: reset is scoped to co_B → co_A's BS stays live.
    const rb = await runBalanceSheetBatch(prisma, planFor([R("BS.02.01.01", 200, 4, "co_B")], { label: "AZSF" }))
    expect(rb.metrics.resetArchived).toBe(0) // co_B had nothing prior to archive
    const live = prisma.__bs.filter((r) => r.deletedAt === null)
    expect(live).toHaveLength(2)
    expect(live.map((r) => r.companyId).sort()).toEqual(["co_A", "co_B"])
    expect(rb.reconciliation.verdict).toBe("green")
  })

  it("re-importing one company replaces only its own rows; sibling untouched", async () => {
    const prisma = makeFakePrisma()
    await runBalanceSheetBatch(prisma, planFor([R("BS.01.01.01", 100, 4, "co_A")], { label: "CPC" }))
    await runBalanceSheetBatch(prisma, planFor([R("BS.02.01.01", 200, 4, "co_B")], { label: "AZSF" }))
    const reA = await runBalanceSheetBatch(prisma, planFor([R("BS.01.01.01", 150, 4, "co_A")], { label: "CPC" }))
    expect(reA.metrics.resetArchived).toBe(1) // ONLY co_A's prior row
    const live = prisma.__bs.filter((r) => r.deletedAt === null)
    expect(live).toHaveLength(2)
    expect(live.find((r) => r.companyId === "co_A")?.amount).toBe(150)
    expect(live.find((r) => r.companyId === "co_B")?.amount).toBe(200)
    expect(reA.reconciliation.verdict).toBe("green")
  })

  it("derive-delete-from-write: broader caller planIds archives only the rows' plan; sibling PLAN untouched", async () => {
    // The archive scope is derived from the plans the rows carry
    // (footprintPlanIds), not the caller's `plan.planIds`. Seed a live BS row
    // on plan_other (same company/year), import into plan_2026 while the
    // caller declares BOTH plans — plan_other's row must survive and recon
    // must stay green (the surviving sibling plan is not read as "extra").
    const prisma = makeFakePrisma({
      initialRows: [
        { organizationId: "org_1", planId: "plan_other", companyId: "co_A", accountId: "coa_BS.09.09.09", lineType: "asset", subType: "current_asset", year: 2026, month: 4, amount: 8888, notes: null, deletedAt: null, deletedBy: null },
      ],
    })
    const result = await runBalanceSheetBatch(
      prisma,
      planFor([R("BS.01.01.01", 100, 4, "co_A")], { planIds: ["plan_2026", "plan_other"] }),
    )
    // plan_2026 had nothing prior → 0 archived; plan_other untouched.
    expect(result.metrics.resetArchived).toBe(0)
    const otherLive = prisma.__bs.filter((r) => r.planId === "plan_other" && r.deletedAt === null)
    expect(otherLive).toHaveLength(1)
    expect(otherLive[0].amount).toBe(8888)
    expect(result.reconciliation.verdict).toBe("green")
  })
})
