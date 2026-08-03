// @vitest-environment node
/**
 * Handler test for `/api/admin/source-registry` (GET + PUT + DELETE).
 *
 * The production route persists deployment-wide registry metadata in
 * PostgreSQL. Tests use a small in-memory Prisma surface so no database or
 * filesystem state leaks into the suite.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const { prismaMock, rows } = vi.hoisted(() => {
  type Row = {
    companyCode: string
    xlsx: string
    sheet: string | null
    period: string
  }
  const rows = new Map<string, Row>()
  const prismaMock = {
    sourceRegistryEntry: {
      findMany: vi.fn(async () => [...rows.values()].sort((a, b) => a.companyCode.localeCompare(b.companyCode))),
      upsert: vi.fn(async ({ create, update, where }: {
        create: Row
        update: Omit<Row, "companyCode">
        where: { companyCode: string }
      }) => {
        const existing = rows.get(where.companyCode)
        const row = existing
          ? { ...existing, ...update }
          : { ...create }
        rows.set(where.companyCode, row)
        return row
      }),
      deleteMany: vi.fn(async ({ where }: { where: { companyCode: string } }) => {
        const deleted = rows.delete(where.companyCode)
        return { count: deleted ? 1 : 0 }
      }),
    },
  }
  return { prismaMock, rows }
})

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/db/prisma-admin", () => ({ prismaAdmin: prismaMock }))

import { makeRequest, mockSession } from "@/test/api-harness"
import { DELETE, GET, PUT } from "./route"

beforeEach(() => {
  rows.clear()
  vi.clearAllMocks()
})

describe("GET /api/admin/source-registry", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/admin/source-registry"))
    expect(res.status).toBe(401)
  })

  it("403 non-admin", async () => {
    await mockSession({ orgId: "org_demo", userId: "u1", role: "manager" })
    const res = await GET(makeRequest("/api/admin/source-registry"))
    expect(res.status).toBe(403)
  })

  it("200 returns persisted entries", async () => {
    rows.set("B", { companyCode: "B", xlsx: "b.xlsx", sheet: null, period: "2026" })
    rows.set("A", { companyCode: "A", xlsx: "a.xlsx", sheet: "Main", period: "2025" })
    await mockSession({ orgId: "org_demo", userId: "u1", role: "admin" })
    const res = await GET(makeRequest("/api/admin/source-registry"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      entries: {
        A: { xlsx: "a.xlsx", sheet: "Main", period: "2025" },
        B: { xlsx: "b.xlsx", sheet: null, period: "2026" },
      },
    })
  })
})

describe("PUT /api/admin/source-registry", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await PUT(makeRequest("/api/admin/source-registry", {
      method: "PUT",
      json: { companyCode: "TEST-X", xlsx: "tmp/x.xlsx", sheet: null, period: "2026-Q1" },
    }))
    expect(res.status).toBe(401)
  })

  it.each([
    [{ xlsx: "tmp/x.xlsx", period: "2026-Q1" }, "companyCode required"],
    [{ companyCode: "TEST-X", period: "2026-Q1" }, "xlsx path required"],
    [{ companyCode: "TEST-X", xlsx: "tmp/x.xlsx" }, "period required"],
  ])("400 validates required fields", async (json, error) => {
    await mockSession({ orgId: "org_demo", userId: "u1", role: "admin" })
    const res = await PUT(makeRequest("/api/admin/source-registry", { method: "PUT", json }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error })
  })

  it("200 upserts an entry", async () => {
    await mockSession({ orgId: "org_demo", userId: "u1", role: "admin" })
    const res = await PUT(makeRequest("/api/admin/source-registry", {
      method: "PUT",
      json: { companyCode: "TEST-PUT", xlsx: "tmp/test.xlsx", sheet: "Sheet1", period: "2026-Q1" },
    }))
    expect(res.status).toBe(200)
    expect((await res.json()).entry).toEqual({ xlsx: "tmp/test.xlsx", sheet: "Sheet1", period: "2026-Q1" })
    expect(rows.has("TEST-PUT")).toBe(true)
  })
})

describe("DELETE /api/admin/source-registry", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await DELETE(makeRequest("/api/admin/source-registry?companyCode=X", { method: "DELETE" }))
    expect(res.status).toBe(401)
  })

  it("400 missing companyCode", async () => {
    await mockSession({ orgId: "org_demo", userId: "u1", role: "admin" })
    const res = await DELETE(makeRequest("/api/admin/source-registry", { method: "DELETE" }))
    expect(res.status).toBe(400)
  })

  it("404 entry not found", async () => {
    await mockSession({ orgId: "org_demo", userId: "u1", role: "admin" })
    const res = await DELETE(makeRequest("/api/admin/source-registry?companyCode=MISSING", { method: "DELETE" }))
    expect(res.status).toBe(404)
  })

  it("200 removes an existing entry", async () => {
    rows.set("TEST-DELETE", {
      companyCode: "TEST-DELETE",
      xlsx: "tmp/test.xlsx",
      sheet: null,
      period: "2026-Q1",
    })
    await mockSession({ orgId: "org_demo", userId: "u1", role: "admin" })
    const res = await DELETE(makeRequest("/api/admin/source-registry?companyCode=TEST-DELETE", { method: "DELETE" }))
    expect(res.status).toBe(200)
    expect(rows.has("TEST-DELETE")).toBe(false)
  })
})
