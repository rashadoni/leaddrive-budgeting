/**
 * Phase 7.M Step 6 — round-trip tests for `runCashFlowBatch`.
 *
 * CF uses soft-delete + an organisation-scoped table (no companyId).
 * The reset filter narrows by `source` tag so co-existing CF batches
 * from other sources don't get touched.
 */
import { describe, it, expect, vi } from "vitest"
import {
  runCashFlowBatch,
  type CfImportPlan,
  type CfImportRow,
} from "./cf-import-batch"
import { buildReconKey, type ReconciliationKey } from "./reconciliation"
import type { PrismaClient } from "@prisma/client"

interface FakeCfRow {
  organizationId: string
  year: number
  month: number
  entryType: string
  source: string
  sourceId: string | null
  amount: number
  currencyCode: string
  description: string | null
  isProjected: boolean
  activityType: string
  category: string | null
  companyId?: string | null
  deletedAt: Date | null
  deletedBy: string | null
}

// 2026-05-31 entity-scope: the reset now passes
// `OR: [{ sourceId: { startsWith: "<entity>::" } }]` to isolate one entity's
// CF on a shared sourceTag. The fake honours it so the regression test bites.
function matchesEntityScope(
  r: { sourceId: string | null },
  w: { OR?: Array<{ sourceId?: { startsWith?: string } }> },
): boolean {
  if (!w.OR) return true
  return w.OR.some(
    (c) => c.sourceId?.startsWith != null && (r.sourceId ?? "").startsWith(c.sourceId.startsWith),
  )
}

function makeFakePrisma(opts: { initialRows?: FakeCfRow[] } = {}): PrismaClient & {
  __cf: FakeCfRow[]
} {
  const cf: FakeCfRow[] = [...(opts.initialRows ?? [])]
  const fake = {
    __cf: cf,
    cashFlowEntry: {
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const w = args.where as {
          organizationId?: string
          source?: string
          OR?: Array<{ sourceId?: { startsWith?: string } }>
          deletedAt?: null
          year?: { in: number[] }
        }
        let count = 0
        for (const r of cf) {
          if (w.organizationId && r.organizationId !== w.organizationId) continue
          if (w.source && r.source !== w.source) continue
          if (!matchesEntityScope(r, w)) continue
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
          source?: string
          OR?: Array<{ sourceId?: { startsWith?: string } }>
          deletedAt?: null
          year?: { in: number[] }
        }
        let n = 0
        for (const r of cf) {
          if (w.organizationId && r.organizationId !== w.organizationId) continue
          if (w.source && r.source !== w.source) continue
          if (!matchesEntityScope(r, w)) continue
          if (w.deletedAt === null && r.deletedAt !== null) continue
          if (w.year && !w.year.in.includes(r.year)) continue
          n += 1
        }
        return n
      }),
      deleteMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const w = args.where as {
          organizationId?: string
          source?: string
          OR?: Array<{ sourceId?: { startsWith?: string } }>
          deletedAt?: { not: null }
          year?: { in: number[] }
        }
        let count = 0
        for (let i = cf.length - 1; i >= 0; i--) {
          const r = cf[i]
          if (w.organizationId && r.organizationId !== w.organizationId) continue
          if (w.source && r.source !== w.source) continue
          if (!matchesEntityScope(r, w)) continue
          if (w.deletedAt?.not === null && r.deletedAt === null) continue
          if (w.year && !w.year.in.includes(r.year)) continue
          cf.splice(i, 1)
          count += 1
        }
        return { count }
      }),
      createMany: vi.fn(async (args: { data: ReadonlyArray<Partial<FakeCfRow>> }) => {
        for (const d of args.data) {
          cf.push({
            organizationId: d.organizationId!,
            year: d.year!,
            month: d.month!,
            entryType: d.entryType!,
            source: d.source!,
            sourceId: d.sourceId ?? null,
            amount: d.amount!,
            currencyCode: d.currencyCode ?? "AZN",
            description: d.description ?? null,
            isProjected: d.isProjected ?? false,
            activityType: d.activityType!,
            category: d.category ?? null,
            companyId: d.companyId ?? null,
            deletedAt: null,
            deletedBy: null,
          })
        }
        return { count: args.data.length }
      }),
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const w = args.where as {
          organizationId?: string
          source?: string
          OR?: Array<{ sourceId?: { startsWith?: string } }>
          deletedAt?: null
          year?: { in: number[] }
        }
        return cf
          .filter((r) => {
            if (w.organizationId && r.organizationId !== w.organizationId) return false
            if (w.source && r.source !== w.source) return false
            if (!matchesEntityScope(r, w)) return false
            if (w.deletedAt === null && r.deletedAt !== null) return false
            if (w.year && !w.year.in.includes(r.year)) return false
            return true
          })
          .map((r) => ({
            sourceId: r.sourceId,
            category: r.category,
            year: r.year,
            month: r.month,
            amount: r.amount,
          }))
      }),
    },
    company: {
      // CF companyId resolution (2026-06-23): entityCode → Company. The fake
      // returns one company per requested code so the write sets companyId.
      findMany: vi.fn(async (args: { where: { code?: { in?: string[] } } }) => {
        const codes = args.where?.code?.in ?? []
        return codes.map((code) => ({ id: `co_${code}`, code }))
      }),
    },
    $transaction: vi.fn(async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(fake as unknown as PrismaClient)),
  }
  return fake as unknown as PrismaClient & { __cf: FakeCfRow[] }
}

const E = (
  entity: string,
  cfCode: string,
  amount: number,
  month: number = 4,
): CfImportRow => ({
  entityCode: entity,
  cfCode,
  category: `${entity}-${cfCode}`,
  accountId: `coa_${cfCode}`,
  activityType: "operating",
  entryType: amount >= 0 ? "inflow" : "outflow",
  year: 2026,
  month,
  amount,
  currencyCode: "AZN",
  description: `Test entry ${cfCode}`,
  source: "test-source",
  sourceId: `${entity}::${cfCode}`,
})

function planFor(
  rows: ReadonlyArray<CfImportRow>,
  overrides: Partial<CfImportPlan> = {},
): CfImportPlan {
  const expected = new Map<ReconciliationKey, number>()
  for (const r of rows) {
    const period = `${r.year}-${String(r.month).padStart(2, "0")}`
    const key = buildReconKey(r.source, r.sourceId, period)
    expected.set(key, (expected.get(key) ?? 0) + r.amount)
  }
  return {
    organizationId: "org_1",
    label: "fixture-cf",
    actorUserId: "user_test",
    sourceDocument: "fixture.xlsx",
    sourceTag: "test-source",
    periodScope: ["2026-04"],
    rows,
    expectedSums: expected,
    ...overrides,
  }
}

describe("runCashFlowBatch — round-trip", () => {
  it("first import → green, all rows inserted", async () => {
    const prisma = makeFakePrisma()
    const r = await runCashFlowBatch(
      prisma,
      planFor([E("AZSF", "CF.01.01", 100_000), E("AZSF", "CF.01.02", -50_000)]),
    )
    expect(r.metrics.rowsInserted).toBe(2)
    expect(r.reconciliation.verdict).toBe("green")
  })

  it("recon read does NOT select the dropped `category` column", async () => {
    // Regression (2026-05-30): defaultReadActualCfSums selected `category`,
    // a column Phase 2.1 dropped from CashFlowEntry. tsc could not catch it
    // (the function takes a loose `PrismaClient | TransactionClient` union,
    // which erodes Prisma's strict select-type checking), so it threw at
    // runtime on EVERY real CF --apply — only surfaced by the multi-file
    // E2E. The recon key is built from `sourceId`, so `category` was dead.
    // Lock it out of the select so a re-add fails this test (not prod).
    const prisma = makeFakePrisma()
    await runCashFlowBatch(prisma, planFor([E("AZSF", "CF.01.01", 100_000)]))
    const findManySpy = prisma.cashFlowEntry.findMany as unknown as {
      mock: { calls: Array<[{ select?: Record<string, unknown> }]> }
    }
    const reconCall = findManySpy.mock.calls.find((c) => c[0]?.select)
    expect(reconCall, "recon findMany with a select should have run").toBeTruthy()
    const select = reconCall![0].select!
    expect(select.category).toBeUndefined()
    expect(select).toMatchObject({
      sourceId: true,
      year: true,
      month: true,
      amount: true,
    })
  })

  it("re-import soft-archives prior + writes fresh", async () => {
    const prisma = makeFakePrisma()
    const plan = planFor([E("AZSF", "CF.01.01", 1000)])
    await runCashFlowBatch(prisma, plan)
    const second = await runCashFlowBatch(prisma, plan)
    expect(second.metrics.resetArchived).toBe(1)
    expect(second.metrics.resetPurged).toBe(0)
    expect(second.reconciliation.verdict).toBe("green")
    expect(prisma.__cf).toHaveLength(2) // 1 archived + 1 live
  })

  it("source-tag scoping: rows from other sources are NOT touched", async () => {
    const prisma = makeFakePrisma({
      initialRows: [
        {
          organizationId: "org_1",
          year: 2026,
          month: 4,
          entryType: "inflow",
          source: "another-source",
          sourceId: "X",
          amount: 99,
          currencyCode: "AZN",
          description: "kept",
          isProjected: false,
          activityType: "operating",
          category: "X",
          deletedAt: null,
          deletedBy: null,
        },
      ],
    })
    const plan = planFor([E("AZSF", "CF.01.01", 1000)])
    await runCashFlowBatch(prisma, plan)
    // 1 from other-source untouched + 1 new live.
    expect(prisma.__cf).toHaveLength(2)
    const otherSource = prisma.__cf.find((r) => r.source === "another-source")
    expect(otherSource).toBeDefined()
    expect(otherSource?.deletedAt).toBeNull()
  })

  it("cross-source-tag re-import archives the entity's prior rows (no doubling) — 2026-06-21 bug", async () => {
    // The historical loader tagged CF `workbook-cf-historical`; the reporting-
    // pack re-import uses a DIFFERENT tag. The OLD source-constrained reset left
    // the historical rows live, so the insert DOUBLED the entity's CF. With the
    // fix, an entity-scoped reset archives the prior rows regardless of source.
    const prisma = makeFakePrisma({
      initialRows: [
        {
          organizationId: "org_1",
          year: 2026,
          month: 4,
          entryType: "inflow",
          source: "workbook-cf-historical", // different tag than this import
          sourceId: "AZSF::CF.01.01", // entity-prefixed → matches entityScope
          amount: 1000,
          currencyCode: "AZN",
          description: "historical",
          isProjected: false,
          activityType: "operating",
          category: "X",
          deletedAt: null,
          deletedBy: null,
        },
      ],
    })
    const r = await runCashFlowBatch(prisma, planFor([E("AZSF", "CF.01.01", 1000)]))
    expect(r.metrics.resetArchived).toBe(1) // the historical-tag row archived
    const live = prisma.__cf.filter((x) => x.deletedAt === null)
    expect(live).toHaveLength(1) // only the fresh insert is live — NOT doubled
    const historical = prisma.__cf.find((x) => x.source === "workbook-cf-historical")
    expect(historical?.deletedAt).not.toBeNull()
  })

  it("drift detection: tampered expected → red", async () => {
    const prisma = makeFakePrisma()
    const plan = planFor([E("AZSF", "CF.01.01", 50)])
    const tampered: CfImportPlan = {
      ...plan,
      expectedSums: new Map([
        [buildReconKey("test-source", "AZSF::CF.01.01", "2026-04"), 100],
      ]),
    }
    const r = await runCashFlowBatch(prisma, tampered)
    expect(r.reconciliation.verdict).toBe("red")
  })
})

// ─── Phase 7.M Tier 5 — outer transaction support ─────────────────────────────

describe("runCashFlowBatch — outer-transaction mode (Phase 7.M Tier 5)", () => {
  it("call with PrismaClient still wraps own $transaction (back-compat)", async () => {
    const prisma = makeFakePrisma()
    const txSpy = prisma.$transaction as unknown as ReturnType<typeof vi.fn>
    const plan = planFor([E("AZSF", "CF.01.01", 100)])
    const result = await runCashFlowBatch(prisma, plan)
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
    const plan = planFor([E("AZSF", "CF.01.01", 100)])
    const result = await runCashFlowBatch(
      tx as unknown as PrismaClient,
      plan,
    )
    expect(txSpy).not.toHaveBeenCalled()
    expect(result.reconciliation.verdict).toBe("green")
    expect(prisma.__cf.filter((r) => r.deletedAt === null)).toHaveLength(1)
  })

  it("two batches inside the same outer $transaction share visibility", async () => {
    const prisma = makeFakePrisma()
    // Different sourceTags so the second batch's reset doesn't archive
    // the first batch's writes — multi-file pattern uses one source
    // per file.
    const planA = planFor(
      [{ ...E("AZSF", "CF.01.01", 100), source: "fileA-source" }],
      { label: "fileA", sourceTag: "fileA-source" },
    )
    const planB = planFor(
      [{ ...E("CPC", "CF.02.01", 200), source: "fileB-source" }],
      { label: "fileB", sourceTag: "fileB-source" },
    )
    const results = await prisma.$transaction(async (tx) => {
      const txClient = new Proxy(tx as unknown as PrismaClient, {
        get(target, prop) {
          if (prop === "$transaction") return undefined
          return (target as unknown as Record<string | symbol, unknown>)[prop as string]
        },
      }) as unknown as PrismaClient
      const ra = await runCashFlowBatch(txClient, planA)
      const rb = await runCashFlowBatch(txClient, planB)
      return [ra, rb]
    })
    expect(results[0].reconciliation.verdict).toBe("green")
    expect(results[1].reconciliation.verdict).toBe("green")
    expect(prisma.__cf.filter((r) => r.deletedAt === null)).toHaveLength(2)
  })
})

// ─── 2026-05-31 cross-archive bugfix — per-entity reset on a shared sourceTag ──
// cash_flow_entries has NO companyId; the entity lives in sourceId as
// `<entityCode>::<cfCode>`. The AzerSheker multi-import used ONE shared
// sourceTag for every entity, so each entity's batch archived siblings' live CF
// (only the last survived: 37 live of 309). These tests pin the fix: reset/recon
// are scoped to the batch's entities by sourceId prefix.
describe("runCashFlowBatch — per-entity isolation on a shared sourceTag", () => {
  it("one entity's batch does NOT archive a sibling's CF under the SAME sourceTag", async () => {
    const prisma = makeFakePrisma()
    await runCashFlowBatch(prisma, planFor([E("AZSEKER-AZSF", "CF.01.01", 100)]))
    // Pre-fix: this second batch (same sourceTag) archived AZSF's CF.
    // Post-fix: reset scoped to the CPC sourceId prefix → AZSF stays live.
    const rb = await runCashFlowBatch(prisma, planFor([E("AZSEKER-CPC", "CF.02.01", 200)]))
    expect(rb.metrics.resetArchived).toBe(0)
    const live = prisma.__cf.filter((r) => r.deletedAt === null)
    expect(live).toHaveLength(2)
    expect(live.map((r) => r.sourceId).sort()).toEqual([
      "AZSEKER-AZSF::CF.01.01",
      "AZSEKER-CPC::CF.02.01",
    ])
    expect(rb.reconciliation.verdict).toBe("green")
  })

  it("re-importing one entity replaces only its own CF; sibling untouched", async () => {
    const prisma = makeFakePrisma()
    await runCashFlowBatch(prisma, planFor([E("AZSEKER-AZSF", "CF.01.01", 100)]))
    await runCashFlowBatch(prisma, planFor([E("AZSEKER-CPC", "CF.02.01", 200)]))
    const reAzsf = await runCashFlowBatch(prisma, planFor([E("AZSEKER-AZSF", "CF.01.01", 150)]))
    expect(reAzsf.metrics.resetArchived).toBe(1) // ONLY AZSF's prior row
    const live = prisma.__cf.filter((r) => r.deletedAt === null)
    expect(live).toHaveLength(2)
    expect(live.find((r) => r.sourceId === "AZSEKER-AZSF::CF.01.01")?.amount).toBe(150)
    expect(live.find((r) => r.sourceId === "AZSEKER-CPC::CF.02.01")?.amount).toBe(200)
    expect(reAzsf.reconciliation.verdict).toBe("green")
  })
})

describe("runCashFlowBatch — companyId (CF double-layer fix)", () => {
  it("sets companyId on inserted rows, resolved from the entityCode", async () => {
    const prisma = makeFakePrisma()
    await runCashFlowBatch(prisma, planFor([E("AZSEKER-CPC", "CF.01.01", 100)]))
    const live = prisma.__cf.filter((r) => r.deletedAt === null)
    expect(live).toHaveLength(1)
    expect((live[0] as { companyId?: string | null }).companyId).toBe("co_AZSEKER-CPC")
  })
})
