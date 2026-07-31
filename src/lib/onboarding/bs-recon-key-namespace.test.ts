/**
 * 11.51 — the balance-sheet read-back must speak the caller's key language.
 *
 * The failure this closes
 * ───────────────────────
 * Observed on production 2026-07-31: an AI Auto Import of a 2025+2026 workbook
 * aborted with "Post-write reconciliation rejected (verdict=red, drifted
 * sheets=…)" naming EVERY `BS Actual` sheet, in both years, for every entity.
 * Zero rows committed. The amounts were never wrong — the two sides of the
 * comparison were addressing different key spaces:
 *
 *   expected  planId :: AZSEKER-CPC-BS.01.01.01 :: 2026-03
 *   actual    planId :: BS.01.01.01             :: 2026-03
 *
 * `reconcile()` is a pure key lookup, so it produced matched:0, missing:N,
 * extra:N — and any non-empty missing/extra is an unconditional red, which
 * rolls the whole group back.
 *
 * Provenance: `0569c8f3` (Phase 2.1 session 3) dropped the `accountCode`
 * COLUMN — which had held the entity-prefixed string — and re-pointed the
 * read-back at `account.code`, the bare CoA code. The P&L branch got the
 * compensating change in that same commit; the BS branch did not. It stayed
 * invisible until `ededab3d` (11.2) made post-write reconciliation real
 * instead of computing the report and discarding it.
 *
 * Why the existing suite missed it: `bs-import-batch.test.ts` sets
 * `accountId: coa_${accountCode}` and its fake derives `account.code` back out
 * of that id, so both sides are the SAME string by construction. The fixture
 * below deliberately breaks that symmetry the way production does — prefixed
 * `accountCode`, bare CoA code — which is the only shape that can catch this.
 */
import { describe, it, expect, vi } from "vitest"
import {
  runBalanceSheetBatch,
  type BsImportPlan,
  type BsImportRow,
} from "./bs-import-batch"
import { buildReconKey, type ReconciliationKey } from "./reconciliation"
import type { PrismaClient } from "@prisma/client"

interface FakeBsRow {
  organizationId: string
  planId: string
  companyId: string | null
  /** The BARE CoA code, exactly as `resolveOrCreateAccountId` persists it. */
  accountCode: string
  year: number
  month: number
  amount: number
  deletedAt: Date | null
}

function makeFakePrisma(initialRows: FakeBsRow[] = []) {
  const bs: FakeBsRow[] = [...initialRows]
  type Where = {
    organizationId?: string
    planId?: { in: string[] }
    companyId?: { in: string[] }
    deletedAt?: null
    year?: { in: number[] }
  }
  const match = (r: FakeBsRow, w: Where) => {
    if (w.organizationId && r.organizationId !== w.organizationId) return false
    if (w.planId && !w.planId.in.includes(r.planId)) return false
    if (w.companyId && (r.companyId == null || !w.companyId.in.includes(r.companyId)))
      return false
    if (w.deletedAt === null && r.deletedAt !== null) return false
    if (w.year && !w.year.in.includes(r.year)) return false
    return true
  }
  const fake = {
    __bs: bs,
    balanceSheetLine: {
      updateMany: vi.fn(
        async (args: { where: Where; data: Record<string, unknown> }) => {
          let count = 0
          for (const r of bs) {
            if (!match(r, args.where)) continue
            Object.assign(r, args.data)
            count += 1
          }
          return { count }
        },
      ),
      count: vi.fn(async (args: { where: Where }) =>
        bs.filter((r) => match(r, args.where)).length,
      ),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(
        async (args: {
          data: Array<{
            organizationId: string
            planId: string
            companyId: string | null
            accountId: string
            year: number
            month: number
            amount: number
          }>
        }) => {
          for (const d of args.data) {
            bs.push({
              organizationId: d.organizationId,
              planId: d.planId,
              companyId: d.companyId ?? null,
              // Mirrors production: the CoA row carries the STRIPPED code,
              // so the read-back can only ever see the bare form.
              accountCode: d.accountId.replace(/^coa_/, ""),
              year: d.year,
              month: d.month,
              amount: d.amount,
              deletedAt: null,
            })
          }
          return { count: args.data.length }
        },
      ),
      findMany: vi.fn(async (args: { where: Where }) =>
        bs
          .filter((r) => match(r, args.where))
          .map((r) => ({
            planId: r.planId,
            account: { code: r.accountCode },
            year: r.year,
            month: r.month,
            amount: r.amount,
          })),
      ),
    },
    $transaction: vi.fn(async (fn: (tx: PrismaClient) => Promise<unknown>) =>
      fn(fake as unknown as PrismaClient),
    ),
  }
  return fake as unknown as PrismaClient & { __bs: FakeBsRow[] }
}

const ENTITY = "AZSEKER-CPC"

/** A row shaped like the real BS handler's: prefixed code, bare CoA id. */
function row(bareCode: string, amount: number, month = 3): BsImportRow {
  return {
    planId: "plan_2026_actual",
    companyId: "co_cpc",
    accountCode: `${ENTITY}-${bareCode}`,
    accountId: `coa_${bareCode}`,
    lineType: "asset",
    subType: "current_asset",
    year: 2026,
    month,
    amount,
    sourceCell: `fixture.xlsx#BS!${bareCode}@2026-03`,
  }
}

function planFor(
  rows: ReadonlyArray<BsImportRow>,
  overrides: Partial<BsImportPlan> = {},
): BsImportPlan {
  const expectedSums = new Map<ReconciliationKey, number>()
  for (const r of rows) {
    const period = `${r.year}-${String(r.month).padStart(2, "0")}`
    // Exactly what `makeBsHandler` does — key on the prefixed accountCode.
    const key = buildReconKey(r.planId, r.accountCode, period)
    expectedSums.set(key, (expectedSums.get(key) ?? 0) + r.amount)
  }
  return {
    organizationId: "org_1",
    label: "fixture-bs",
    actorUserId: "user_test",
    sourceDocument: "fixture.xlsx",
    planIds: ["plan_2026_actual"],
    periodScope: ["2026-03"],
    rows,
    expectedSums,
    reconAccountPrefix: ENTITY,
    ...overrides,
  }
}

describe("BS post-write reconciliation — key namespace", () => {
  it("reconciles GREEN when the caller prefixed its expected keys with the entity", async () => {
    // THE regression. Without `reconAccountPrefix` plumbed into the read-back
    // this is red with matched:0 — every key missing AND extra — even though
    // the amounts round-trip to the qəpik.
    const prisma = makeFakePrisma()
    const rows = [row("BS.01.01.01", 1_234_567.89), row("BS.01.02.03", 42_000)]
    const res = await runBalanceSheetBatch(prisma, planFor(rows))

    expect(res.reconciliation.verdict).toBe("green")
    expect(res.reconciliation.matched).toBe(2)
    expect(res.reconciliation.missing).toHaveLength(0)
    expect(res.reconciliation.extra).toHaveLength(0)
  })

  it("still reconciles GREEN for a caller that keys on the BARE code", async () => {
    // The consolidated-holding path (`azseker-consolidated-bs-import.ts`) keys
    // on `CONS.BS.<slug>` with no prefix and was never broken. Deriving the
    // prefix from `companyId` instead of taking it as a declaration would have
    // broken it — it sets a companyId too. Pinned so nobody "simplifies" it.
    const prisma = makeFakePrisma()
    const bare: BsImportRow = {
      ...row("CONS.BS.CASH", 5_000),
      accountCode: "CONS.BS.CASH",
      accountId: "coa_CONS.BS.CASH",
    }
    // `planFor` keys off `accountCode`, which is already bare here — the one
    // thing that changes is that no prefix is declared.
    const res = await runBalanceSheetBatch(
      prisma,
      planFor([bare], { reconAccountPrefix: undefined }),
    )

    expect(res.reconciliation.verdict).toBe("green")
    expect(res.reconciliation.matched).toBe(1)
  })

  it("still catches a REAL drift — the fix must not make recon toothless", async () => {
    // A row that lands with the wrong amount has to stay red. If the prefix
    // plumbing accidentally made keys un-matchable in the other direction the
    // test above would pass while this one silently went green.
    const prisma = makeFakePrisma()
    const rows = [row("BS.01.01.01", 1_000)]
    const plan = planFor(rows)
    const corrupted = new Map(plan.expectedSums)
    corrupted.set(
      buildReconKey("plan_2026_actual", `${ENTITY}-BS.01.01.01`, "2026-03"),
      2_000,
    )

    const res = await runBalanceSheetBatch(prisma, {
      ...plan,
      expectedSums: corrupted,
    })

    expect(res.reconciliation.verdict).toBe("red")
    expect(res.reconciliation.drift).toHaveLength(1)
  })

  it("reports an expected account that never landed as MISSING", async () => {
    // The other direction: the read-back must not fabricate a match for a key
    // it never saw. Without this, a fix that made every lookup "succeed"
    // would pass the green test above and hide dropped rows.
    const prisma = makeFakePrisma()
    const plan = planFor([row("BS.01.01.01", 100)])
    const withGhost = new Map(plan.expectedSums)
    const ghost = buildReconKey(
      "plan_2026_actual",
      `${ENTITY}-BS.99.99.99`,
      "2026-03",
    )
    withGhost.set(ghost, 500)

    const res = await runBalanceSheetBatch(prisma, {
      ...plan,
      expectedSums: withGhost,
    })

    expect(res.reconciliation.verdict).toBe("red")
    expect(res.reconciliation.missing).toContain(ghost)
    // …and the row that DID land is still matched, not collateral damage.
    expect(res.reconciliation.matched).toBe(1)
  })
})
