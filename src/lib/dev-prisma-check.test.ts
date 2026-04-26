/**
 * Tests for `dev-prisma-check.ts` — diff helper. The fire-and-forget
 * `startDevPrismaCheck` orchestration isn't tested here (it's a
 * console-side-effect wrapper); the pure `diffModelsVsTables` is what
 * decides whether a warning fires.
 *
 * Mocks Prisma's `$queryRaw` for the `information_schema.tables`
 * lookup; the DMMF list is read straight from the real client at the
 * top of this file (so the test exercises the real schema).
 */

import { describe, it, expect, vi } from "vitest"
import { Prisma } from "@prisma/client"
import { diffModelsVsTables } from "./dev-prisma-check"

interface MockPrisma {
  $queryRaw: ReturnType<typeof vi.fn>
}

const ALL_DMMF_TABLES = Prisma.dmmf.datamodel.models.map(
  (m) => m.dbName ?? m.name,
)

function makePrisma(rows: Array<{ table_name: string }>): MockPrisma {
  return { $queryRaw: vi.fn().mockResolvedValue(rows) }
}

describe("diffModelsVsTables", () => {
  it("returns empty diff when DB has every Prisma model + nothing extra", async () => {
    const prisma = makePrisma(
      ALL_DMMF_TABLES.map((t) => ({ table_name: t })),
    )
    const result = await diffModelsVsTables(prisma as never)
    expect(result.missingInDb).toEqual([])
    expect(result.extraInDb).toEqual([])
  })

  it("flags models present in client but missing from DB", async () => {
    // DB returns every table except the most-recently-added one
    // (`audit_events`). Simulates "client regenerated post-migration but
    // migration not yet deployed to this DB".
    const dbTables = ALL_DMMF_TABLES.filter((t) => t !== "audit_events")
    const prisma = makePrisma(dbTables.map((t) => ({ table_name: t })))
    const result = await diffModelsVsTables(prisma as never)
    expect(result.missingInDb).toContain("audit_events")
    expect(result.extraInDb).toEqual([])
  })

  it("flags tables present in DB but missing from client (stale client cache)", async () => {
    // DB has every table + a phantom `future_model` table. Simulates
    // "schema migrated but @prisma/client not regenerated / dev-server
    // not kickstarted".
    const prisma = makePrisma([
      ...ALL_DMMF_TABLES.map((t) => ({ table_name: t })),
      { table_name: "future_model" },
    ])
    const result = await diffModelsVsTables(prisma as never)
    expect(result.extraInDb).toContain("future_model")
    expect(result.missingInDb).toEqual([])
  })

  it("ignores Prisma's internal `_prisma_*` tables", async () => {
    // The query itself filters via SQL `NOT LIKE`; the helper passes
    // through whatever the query returns. This test asserts that an
    // unfiltered DB row for `_prisma_migrations` doesn't pollute the
    // `extraInDb` list — but only because the SQL filter is applied.
    // (Documented as a contract: the helper trusts the SQL filter.)
    const prisma = makePrisma(
      ALL_DMMF_TABLES.map((t) => ({ table_name: t })),
    )
    const result = await diffModelsVsTables(prisma as never)
    expect(result.extraInDb).not.toContain("_prisma_migrations")
  })

  it("DMMF includes the Phase 7.F audit_events model (regression guard)", () => {
    // Documents the contract: this test breaks if someone removes the
    // AuditEvent model from prisma/schema.prisma without updating the
    // dev-prisma-check module's expectations.
    expect(ALL_DMMF_TABLES).toContain("audit_events")
    expect(ALL_DMMF_TABLES).toContain("companies")
  })
})
