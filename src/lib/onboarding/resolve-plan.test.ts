/**
 * Phase 11.4 — canonical import-plan resolver.
 *
 * These tests pin the exact behaviour that stops one year's data from being
 * split across two live plans (which the risk engine, filtering on
 * `kind` with no `planId`, would then sum — doubling every number).
 */
import { describe, it, expect, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import {
  resolveImportPlan,
  canonicalPlanName,
  findDuplicateImportPlans,
} from "./resolve-plan"

type PlanRow = {
  id: string
  name: string
  year: number
  kind: string
  createdAt: Date
  deletedAt: Date | null
}

function stubDb(plans: PlanRow[]) {
  const created: Array<Record<string, unknown>> = []
  const findFirst = vi.fn(
    async (args: {
      where: {
        organizationId: string
        year: number
        kind: string
        deletedAt: null
      }
      orderBy?: { createdAt: "asc" | "desc" }
    }) => {
      const matches = plans
        .filter(
          (p) =>
            p.year === args.where.year &&
            p.kind === args.where.kind &&
            p.deletedAt === null,
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      return matches[0] ? { id: matches[0].id } : null
    },
  )
  const create = vi.fn(async (args: { data: Record<string, unknown> }) => {
    created.push(args.data)
    return { id: `new_${created.length}` }
  })
  const findMany = vi.fn(async () => plans.filter((p) => p.deletedAt === null))
  const db = {
    budgetPlan: { findFirst, create, findMany },
  } as unknown as PrismaClient
  return { db, findFirst, create, findMany, created }
}

const plan = (over: Partial<PlanRow> = {}): PlanRow => ({
  id: "p1",
  name: "Azərşəkər 2026 Actuals",
  year: 2026,
  kind: "actual",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
  ...over,
})

describe("resolveImportPlan", () => {
  it("matches on (org, year, kind) and NEVER on name", async () => {
    // The exact regression: a route asking for "AI-Imported 2026 Budget"
    // must still find the plan the AI Auto Import path created under a
    // completely different name, instead of creating a second one.
    const { db, create, findFirst } = stubDb([
      plan({ id: "existing", name: "Azərşəkər 2026 Actuals" }),
    ])
    const got = await resolveImportPlan(db, {
      organizationId: "org1",
      year: 2026,
      kind: "actual",
      name: "AI-Imported 2026 Budget",
    })
    expect(got).toEqual({ id: "existing", created: false })
    expect(create).not.toHaveBeenCalled()
    const where = findFirst.mock.calls[0][0].where as Record<string, unknown>
    expect(where).not.toHaveProperty("name")
  })

  it("prefers the OLDEST live plan — the one that already holds data", async () => {
    const { db } = stubDb([
      plan({ id: "newer", createdAt: new Date("2026-06-01T00:00:00Z") }),
      plan({ id: "older", createdAt: new Date("2026-01-01T00:00:00Z") }),
    ])
    const got = await resolveImportPlan(db, {
      organizationId: "org1",
      year: 2026,
    })
    expect(got.id).toBe("older")
  })

  it("ignores soft-deleted plans", async () => {
    const { db, create } = stubDb([
      plan({ id: "dead", deletedAt: new Date("2026-05-01T00:00:00Z") }),
    ])
    const got = await resolveImportPlan(db, {
      organizationId: "org1",
      year: 2026,
    })
    expect(got.created).toBe(true)
    expect(create).toHaveBeenCalledOnce()
  })

  it("never lets a budget import resolve to the actuals plan", async () => {
    const { db, created } = stubDb([plan({ id: "actuals", kind: "actual" })])
    const got = await resolveImportPlan(db, {
      organizationId: "org1",
      year: 2026,
      kind: "budget",
    })
    expect(got.created).toBe(true)
    expect(created[0]).toMatchObject({ kind: "budget", year: 2026 })
  })

  it("ALWAYS writes an explicit kind on create", async () => {
    // The original defect: three routes created plans without `kind`, so
    // they silently took the schema default "actual" and collided with the
    // real actuals plan.
    const { db, created } = stubDb([])
    await resolveImportPlan(db, { organizationId: "org1", year: 2026 })
    expect(created[0]).toHaveProperty("kind", "actual")
  })

  it("does not rename an existing plan as a side effect of an import", async () => {
    const { db, create } = stubDb([plan({ id: "existing", name: "Keep me" })])
    await resolveImportPlan(db, {
      organizationId: "org1",
      year: 2026,
      name: "Something else entirely",
    })
    expect(create).not.toHaveBeenCalled()
  })

  it("uses the canonical label when no name is supplied", async () => {
    const { db, created } = stubDb([])
    await resolveImportPlan(db, {
      organizationId: "org1",
      year: 2027,
      kind: "budget",
    })
    expect(created[0]).toHaveProperty("name", canonicalPlanName(2027, "budget"))
  })
})

describe("findDuplicateImportPlans", () => {
  it("reports a year split across two live actual plans", async () => {
    const { db } = stubDb([
      plan({ id: "a", name: "Azərşəkər 2026 Actuals" }),
      plan({
        id: "b",
        name: "AI-Imported 2026 Budget",
        createdAt: new Date("2026-06-01T00:00:00Z"),
      }),
    ])
    const dupes = await findDuplicateImportPlans(db, "org1")
    expect(dupes).toHaveLength(1)
    expect(dupes[0]).toMatchObject({ year: 2026, kind: "actual" })
    expect(dupes[0].plans.map((p) => p.id)).toEqual(["a", "b"])
  })

  it("does not flag one actual plan alongside one budget plan", async () => {
    const { db } = stubDb([
      plan({ id: "a", kind: "actual" }),
      plan({ id: "b", kind: "budget" }),
    ])
    expect(await findDuplicateImportPlans(db, "org1")).toEqual([])
  })

  it("does not flag the same year across different kinds or years", async () => {
    const { db } = stubDb([
      plan({ id: "a", year: 2025 }),
      plan({ id: "b", year: 2026 }),
    ])
    expect(await findDuplicateImportPlans(db, "org1")).toEqual([])
  })
})
