/**
 * Phase 7.M Step 6 — round-trip tests for `runKpiBatch`.
 *
 * KPI uses hard-delete (no soft-delete column on operational_facts).
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

function makeFakePrisma(opts: { initialRows?: FakeKpiRow[] } = {}): PrismaClient & {
  __kpi: FakeKpiRow[]
} {
  const kpi: FakeKpiRow[] = [...(opts.initialRows ?? [])]
  const fake = {
    __kpi: kpi,
    operationalFact: {
      deleteMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const w = args.where as {
          organizationId?: string
          companyId?: { in: string[] }
          date?: { gte?: Date; lte?: Date }
        }
        let count = 0
        for (let i = kpi.length - 1; i >= 0; i--) {
          const r = kpi[i]
          if (w.organizationId && r.organizationId !== w.organizationId) continue
          if (w.companyId && !w.companyId.in.includes(r.companyId)) continue
          if (w.date?.gte && r.date < w.date.gte) continue
          if (w.date?.lte && r.date > w.date.lte) continue
          kpi.splice(i, 1)
          count += 1
        }
        return { count }
      }),
      createMany: vi.fn(async (args: { data: ReadonlyArray<Partial<FakeKpiRow>> }) => {
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
      }),
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const w = args.where as {
          organizationId?: string
          companyId?: { in: string[] }
          date?: { gte?: Date; lte?: Date }
        }
        return kpi
          .filter((r) => {
            if (w.organizationId && r.organizationId !== w.organizationId) return false
            if (w.companyId && !w.companyId.in.includes(r.companyId)) return false
            if (w.date?.gte && r.date < w.date.gte) return false
            if (w.date?.lte && r.date > w.date.lte) return false
            return true
          })
          .map((r) => ({
            companyId: r.companyId,
            metric: r.metric,
            date: r.date,
            value: r.value,
          }))
      }),
    },
    $transaction: vi.fn(async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(fake as unknown as PrismaClient)),
  }
  return fake as unknown as PrismaClient & { __kpi: FakeKpiRow[] }
}

const F = (
  metric: string,
  value: number,
  date: string = "2026-12-31",
): KpiImportRow => ({
  companyId: "c_azsf",
  metric,
  date,
  value,
  unit: "ton",
  source: "xlsx_import",
})

function planFor(
  rows: ReadonlyArray<KpiImportRow>,
  overrides: Partial<KpiImportPlan> = {},
): KpiImportPlan {
  const expected = new Map<ReconciliationKey, number>()
  for (const r of rows) {
    const key = buildReconKey(r.companyId, r.metric, r.date)
    expected.set(key, (expected.get(key) ?? 0) + r.value)
  }
  return {
    organizationId: "org_1",
    label: "fixture-kpi",
    actorUserId: "user_test",
    sourceDocument: "fixture.xlsx",
    companyIds: ["c_azsf"],
    dateScope: ["2026"],
    rows,
    expectedSums: expected,
    ...overrides,
  }
}

describe("runKpiBatch — round-trip", () => {
  it("first import → green, all rows inserted, 0 deleted", async () => {
    const prisma = makeFakePrisma()
    const result = await runKpiBatch(
      prisma,
      planFor([F("area_hectares", 1500), F("yield_per_ha", 4.2)]),
    )
    expect(result.metrics.rowsInserted).toBe(2)
    expect(result.metrics.resetDeleted).toBe(0)
    expect(result.reconciliation.verdict).toBe("green")
  })

  it("re-import HARD-deletes prior rows in scope and re-inserts (no soft-delete on this table)", async () => {
    const prisma = makeFakePrisma()
    const plan = planFor([F("area_hectares", 1500)])
    await runKpiBatch(prisma, plan)
    const second = await runKpiBatch(prisma, plan)
    expect(second.metrics.resetDeleted).toBe(1)
    expect(second.metrics.rowsInserted).toBe(1)
    expect(prisma.__kpi).toHaveLength(1) // hard-delete, no archive tail
    expect(second.reconciliation.verdict).toBe("green")
  })

  it("year-prefix dateScope reset only touches matching year", async () => {
    const prisma = makeFakePrisma({
      initialRows: [
        {
          organizationId: "org_1",
          companyId: "c_azsf",
          metric: "area_hectares",
          date: new Date("2025-12-31"),
          value: 1200,
          unit: null,
          source: null,
        },
      ],
    })
    const plan = planFor([F("area_hectares", 1500, "2026-12-31")])
    await runKpiBatch(prisma, plan)
    // 2025 row survived; 2026 row added.
    expect(prisma.__kpi).toHaveLength(2)
  })

  it("drift detection: tampered expected → red", async () => {
    const prisma = makeFakePrisma()
    const plan = planFor([F("area_hectares", 50)])
    const tampered: KpiImportPlan = {
      ...plan,
      expectedSums: new Map([
        [buildReconKey("c_azsf", "area_hectares", "2026-12-31"), 100],
      ]),
    }
    const r = await runKpiBatch(prisma, tampered)
    expect(r.reconciliation.verdict).toBe("red")
  })
})
