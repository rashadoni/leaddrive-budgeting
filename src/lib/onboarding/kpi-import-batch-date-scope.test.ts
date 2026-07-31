/**
 * 11.56 — the KPI read-back was WIDER than the reset it verifies.
 *
 * `runKpiBatch` resolves `plan.dateScope` into a date predicate twice: once
 * for the reset delete (kpi-import-batch.ts:120-131) and once, independently,
 * for the post-write read-back (`defaultReadActualKpiSums`). The read side
 * only ever implemented the 4-digit-YEAR branch. An explicit-ISO dateScope
 * therefore deleted `date IN (…)` but read back with NO date predicate at
 * all, summing rows the delete was forbidden to touch into `actual`. Those
 * become `extra` keys, and reconciliation.ts:151-152 makes any extra an
 * unconditional red — which rolls back the whole file group.
 *
 * Governing invariant: READ BACK EXACTLY WHAT YOU WERE ALLOWED TO DELETE.
 *
 * Why a separate file with its own fake: the fake in kpi-import-batch.test.ts
 * honours `date.in` in deleteMany/count but IGNORES it in findMany (:86-101).
 * That blindness would keep these tests red even against a correct patch — a
 * fake that drops the very predicate under test cannot witness the fix. The
 * fake here routes all four methods through ONE matcher and throws on any
 * WHERE key it does not implement, so a differently-shaped fix screams
 * instead of silently "passing".
 */
import { describe, it, expect, vi } from "vitest"
import {
  runKpiBatch,
  type KpiImportPlan,
  type KpiImportRow,
} from "./kpi-import-batch"
import { buildReconKey, type ReconciliationKey } from "./reconciliation"
import type { PrismaClient } from "@prisma/client"

interface FakeKpiRow {
  organizationId: string
  companyId: string
  metric: string
  date: Date
  value: number
  unit: string | null
  source: string | null
}

type FactWhere = {
  organizationId?: string
  companyId?: { in: string[] }
  metric?: { in: string[] }
  date?: { gte?: Date; lte?: Date; in?: Date[] }
}

const KNOWN_TOP_KEYS = new Set(["organizationId", "companyId", "metric", "date"])
const KNOWN_DATE_OPS = new Set(["gte", "lte", "in"])

/** Refuse to evaluate a predicate we do not implement. A fake that silently
 *  drops an unknown WHERE key is how the 11.51 class survived review twice. */
function assertPredicatesUnderstood(
  op: string,
  where: Record<string, unknown>,
): void {
  for (const k of Object.keys(where)) {
    if (!KNOWN_TOP_KEYS.has(k)) {
      throw new Error(
        `fake operationalFact.${op}: unimplemented WHERE key "${k}" — extend the fake instead of letting it pass blindly`,
      )
    }
  }
  const d = where.date as Record<string, unknown> | undefined
  if (d) {
    for (const k of Object.keys(d)) {
      if (!KNOWN_DATE_OPS.has(k)) {
        throw new Error(
          `fake operationalFact.${op}: unimplemented date operator "${k}"`,
        )
      }
    }
  }
}

/** ONE matcher for deleteMany / count / findMany, so the delete side and the
 *  read side can never be evaluated under different rules by the fake. Any
 *  divergence the test observes is a divergence in the CODE, not the double. */
function matches(row: FakeKpiRow, where: Record<string, unknown>): boolean {
  const w = where as FactWhere
  if (w.organizationId !== undefined && row.organizationId !== w.organizationId)
    return false
  if (w.companyId !== undefined && !w.companyId.in.includes(row.companyId))
    return false
  if (w.metric !== undefined && !w.metric.in.includes(row.metric)) return false
  if (w.date !== undefined) {
    if (w.date.gte !== undefined && row.date < w.date.gte) return false
    if (w.date.lte !== undefined && row.date > w.date.lte) return false
    if (
      w.date.in !== undefined &&
      !w.date.in.some((d) => d.getTime() === row.date.getTime())
    )
      return false
  }
  return true
}

function makeFakePrisma(initialRows: FakeKpiRow[] = []) {
  const kpi: FakeKpiRow[] = [...initialRows]
  const calls = {
    deleteMany: [] as Record<string, unknown>[],
    findMany: [] as Record<string, unknown>[],
  }
  const fake = {
    __kpi: kpi,
    __calls: calls,
    operationalFact: {
      deleteMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        assertPredicatesUnderstood("deleteMany", args.where)
        calls.deleteMany.push(args.where)
        let count = 0
        for (let i = kpi.length - 1; i >= 0; i--) {
          if (!matches(kpi[i], args.where)) continue
          kpi.splice(i, 1)
          count += 1
        }
        return { count }
      }),
      count: vi.fn(async (args: { where: Record<string, unknown> }) => {
        assertPredicatesUnderstood("count", args.where)
        return kpi.filter((r) => matches(r, args.where)).length
      }),
      createMany: vi.fn(
        async (args: { data: ReadonlyArray<Partial<FakeKpiRow>> }) => {
          for (const d of args.data) {
            kpi.push({
              organizationId: d.organizationId!,
              companyId: d.companyId!,
              metric: d.metric!,
              date: d.date!,
              value: d.value!,
              unit: d.unit ?? null,
              source: d.source ?? null,
            })
          }
          return { count: args.data.length }
        },
      ),
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        assertPredicatesUnderstood("findMany", args.where)
        calls.findMany.push(args.where)
        return kpi
          .filter((r) => matches(r, args.where))
          .map((r) => ({
            companyId: r.companyId,
            metric: r.metric,
            date: r.date,
            value: r.value,
          }))
      }),
    },
    $transaction: vi.fn(async (fn: (tx: PrismaClient) => Promise<unknown>) =>
      fn(fake as unknown as PrismaClient),
    ),
  }
  return fake as unknown as PrismaClient & {
    __kpi: FakeKpiRow[]
    __calls: { deleteMany: Record<string, unknown>[]; findMany: Record<string, unknown>[] }
  }
}

const seed = (
  metric: string,
  date: string,
  value: number,
  companyId = "c1",
): FakeKpiRow => ({
  organizationId: "org_1",
  companyId,
  metric,
  date: new Date(date),
  value,
  unit: null,
  source: null,
})

const R = (
  metric: string,
  date: string,
  value: number,
  companyId = "c1",
): KpiImportRow => ({
  companyId,
  metric,
  date,
  value,
  unit: "ton",
  source: "xlsx_import",
})

function planFor(
  rows: ReadonlyArray<KpiImportRow>,
  dateScope: ReadonlyArray<string>,
  overrides: Partial<KpiImportPlan> = {},
): KpiImportPlan {
  const expected = new Map<ReconciliationKey, number>()
  for (const r of rows) {
    const key = buildReconKey(r.companyId, r.metric, r.date)
    expected.set(key, (expected.get(key) ?? 0) + r.value)
  }
  return {
    organizationId: "org_1",
    label: "kpi-date-scope-fixture",
    actorUserId: "user_test",
    sourceDocument: "fixture.xlsx",
    companyIds: ["c1"],
    dateScope,
    rows,
    expectedSums: expected,
    ...overrides,
  }
}

// ─── Fails before the patch, passes after ────────────────────────────────────

describe("runKpiBatch — explicit-ISO dateScope: read-back must mirror the reset", () => {
  it("T1: a prior-year fact the reset could not touch is NOT counted as an extra", async () => {
    // The reset is confined to date IN (2026-12-31); the 2025 fact is
    // untouchable by design. Reading it back turns it into an `extra`, and
    // extras are an unconditional red (reconciliation.ts:151-152) — correct
    // data, rejected, whole group rolled back.
    const prisma = makeFakePrisma([seed("m1", "2025-12-31", 111)])
    const plan = planFor([R("m1", "2026-12-31", 500)], ["2026-12-31"])

    const result = await runKpiBatch(prisma, plan)

    expect(result.reconciliation.extra).toEqual([])
    expect(result.reconciliation.verdict).toBe("green")
    expect(result.reconciliation.matched).toBe(1)
    // The out-of-scope fact must still be on disk — the fix narrows the READ,
    // it must not widen the DELETE.
    expect(prisma.__kpi.filter((r) => r.date.getUTCFullYear() === 2025)).toHaveLength(1)
  })

  it("T2: the read-back's date predicate is byte-identical to the reset's", async () => {
    // The invariant itself, pinned directly: whatever WHERE the delete ran
    // under, the verification must run under the same one. Catches drift in
    // BOTH directions (wider read → false extras; narrower read → leftovers
    // the verification can no longer see).
    const prisma = makeFakePrisma()
    const plan = planFor(
      [R("m1", "2026-03-31", 10), R("m1", "2026-06-30", 20)],
      ["2026-03-31", "2026-06-30"],
    )

    await runKpiBatch(prisma, plan)

    expect(prisma.__calls.deleteMany).toHaveLength(1)
    expect(prisma.__calls.findMany).toHaveLength(1)
    expect(prisma.__calls.findMany[0].date).toEqual(
      prisma.__calls.deleteMany[0].date,
    )
  })

  it("T3: a same-year, different-day sibling fact outside the scope is not read back", async () => {
    // Not merely a cross-year problem: day-grain scopes leave in-year
    // siblings untouchable too, and those are the common shape for KPIs
    // (the module header states facts are timestamped at the day grain).
    const prisma = makeFakePrisma([seed("m1", "2026-06-30", 77)])
    const plan = planFor([R("m1", "2026-12-31", 500)], ["2026-12-31"])

    const result = await runKpiBatch(prisma, plan)

    expect(result.reconciliation.extra).toEqual([])
    expect(result.reconciliation.verdict).toBe("green")
    expect(result.metrics.resetDeleted).toBe(0) // June was never in scope
    expect(prisma.__kpi).toHaveLength(2)
  })

  it("T4: a row written OUTSIDE the explicit dateScope is reported as missing", async () => {
    // The read-back's OTHER job is verifying the WRITE, and narrowing it to
    // the reset window changes that job's answer: before this patch the
    // unbounded read swallowed an out-of-scope insert and returned GREEN.
    // Red is the honest verdict — that row sits outside the reset window, so
    // a re-import can never reclaim it and will collide with the unique
    // (companyId, date, metric) index. Pinned so nobody "fixes" it back to
    // green by re-widening the read, and so the year branch (which has always
    // behaved this way) and the explicit branch stay in step.
    const prisma = makeFakePrisma()
    const plan = planFor(
      [R("m1", "2026-12-31", 500), R("m1", "2026-11-30", 300)],
      ["2026-12-31"],
    )

    const result = await runKpiBatch(prisma, plan)

    expect(result.reconciliation.missing).toEqual(["c1::m1::2026-11-30"])
    expect(result.reconciliation.verdict).toBe("red")
  })
})

// ─── Guards: pass BOTH before and after the patch ────────────────────────────

describe("runKpiBatch — date-scope guards (must not regress)", () => {
  it("G1: year-prefix scope (the only live caller shape) still ignores other years", async () => {
    // All three production call sites pass 4-digit years —
    // production-adapter-handlers-financial.ts:984 and :1078, and
    // production-adapter-handlers-soft.ts:764. This branch must be untouched.
    const prisma = makeFakePrisma([seed("m1", "2025-12-31", 111)])
    const plan = planFor([R("m1", "2026-12-31", 500)], ["2026"])

    const result = await runKpiBatch(prisma, plan)

    expect(result.reconciliation.verdict).toBe("green")
    expect(result.reconciliation.extra).toEqual([])
    expect(prisma.__calls.findMany[0].date).toEqual({
      gte: new Date(Date.UTC(2026, 0, 1)),
      lte: new Date(Date.UTC(2027, 0, 1) - 1),
    })
    expect(prisma.__kpi.filter((r) => r.date.getUTCFullYear() === 2025)).toHaveLength(1)
  })

  it("G2: a mixed scope resolves to the YEAR window on both sides (branch order pinned)", async () => {
    // Year beats explicit dates in the reset (:125 before :129). If only one
    // side were reordered the two predicates diverge again.
    const prisma = makeFakePrisma()
    const plan = planFor([R("m1", "2026-12-31", 500)], ["2026", "2026-12-31"])

    await runKpiBatch(prisma, plan)

    const del = prisma.__calls.deleteMany[0].date as Record<string, unknown>
    const read = prisma.__calls.findMany[0].date as Record<string, unknown>
    expect(del.in).toBeUndefined()
    expect(read.in).toBeUndefined()
    expect(read).toEqual(del)
  })

  it("G3: empty dateScope adds no date predicate to either side", async () => {
    // Empty scope means "reset ALL dates for these companies+metrics"
    // (KpiImportPlan doc, :53-54). The read must stay equally unbounded —
    // narrowing it here would hide leftovers the reset failed to remove.
    const prisma = makeFakePrisma([seed("m1", "2019-01-31", 5)])
    const plan = planFor([R("m1", "2026-12-31", 500)], [])

    const result = await runKpiBatch(prisma, plan)

    expect(prisma.__calls.deleteMany[0].date).toBeUndefined()
    expect(prisma.__calls.findMany[0].date).toBeUndefined()
    expect(result.metrics.resetDeleted).toBe(1) // the 2019 fact WAS in scope
    expect(result.reconciliation.verdict).toBe("green")
  })

  it("G4: every explicit date in the scope is read back, not just the first", async () => {
    // Guards a wrong fix that narrows the read to one date (or to the rows'
    // own dates): the un-read date's inserted fact would surface as `missing`.
    const prisma = makeFakePrisma()
    const plan = planFor(
      [R("m1", "2026-03-31", 10), R("m1", "2026-06-30", 20)],
      ["2026-03-31", "2026-06-30"],
    )

    const result = await runKpiBatch(prisma, plan)

    expect(result.reconciliation.missing).toEqual([])
    expect(result.reconciliation.matched).toBe(2)
    expect(result.reconciliation.verdict).toBe("green")
  })

  it("G5: real drift under an explicit-date scope is still caught", async () => {
    // The fix narrows the verification window; it must not neuter the
    // verification. A tampered expected value stays red.
    const prisma = makeFakePrisma()
    const base = planFor([R("m1", "2026-12-31", 50)], ["2026-12-31"])
    const tampered: KpiImportPlan = {
      ...base,
      expectedSums: new Map([[buildReconKey("c1", "m1", "2026-12-31"), 100]]),
    }

    const result = await runKpiBatch(prisma, tampered)

    expect(result.reconciliation.verdict).toBe("red")
    expect(result.reconciliation.drift).toHaveLength(1)
    expect(result.reconciliation.extra).toEqual([])
  })

  it("G6: a sibling company's fact in the same explicit-date scope is neither deleted nor read", async () => {
    // The company/metric narrowing from the earlier fix (:248-254) must
    // survive the date narrowing.
    const prisma = makeFakePrisma([seed("m1", "2026-12-31", 9999, "c_other")])
    const plan = planFor([R("m1", "2026-12-31", 500)], ["2026-12-31"], {
      companyIds: ["c1", "c_other"],
    })

    const result = await runKpiBatch(prisma, plan)

    expect(result.reconciliation.verdict).toBe("green")
    const other = prisma.__kpi.filter((r) => r.companyId === "c_other")
    expect(other).toHaveLength(1)
    expect(other[0].value).toBe(9999)
  })
})
