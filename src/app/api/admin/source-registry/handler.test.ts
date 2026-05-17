// @vitest-environment node
/**
 * Handler test for `/api/admin/source-registry` (GET + PUT + DELETE).
 *
 * Truth-infra L4 — file-backed source registry CRUD. Locks admin-only
 * gate, validation envelopes, and 404 on missing entries.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { promises as fs } from "fs"
import path from "path"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, PUT, DELETE } from "./route"

const REGISTRY_PATH = path.join(process.cwd(), "data", "onboarding-source-registry.json")
let backup: string | null = null

beforeEach(async () => {
  try {
    backup = await fs.readFile(REGISTRY_PATH, "utf-8")
  } catch {
    backup = null
  }
})

afterEach(async () => {
  if (backup === null) {
    try {
      await fs.unlink(REGISTRY_PATH)
    } catch {}
  } else {
    await fs.writeFile(REGISTRY_PATH, backup, "utf-8")
  }
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

  it("200 returns entries", async () => {
    await mockSession({ orgId: "org_demo", userId: "u1", role: "admin" })
    const res = await GET(makeRequest("/api/admin/source-registry"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty("entries")
    expect(typeof body.entries).toBe("object")
  })
})

describe("PUT /api/admin/source-registry", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await PUT(
      makeRequest("/api/admin/source-registry", {
        method: "PUT",
        json: { companyCode: "TEST-X", xlsx: "tmp/x.xlsx", sheet: null, period: "2026-Q1" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 missing companyCode", async () => {
    await mockSession({ orgId: "org_demo", userId: "u1", role: "admin" })
    const res = await PUT(
      makeRequest("/api/admin/source-registry", {
        method: "PUT",
        json: { xlsx: "tmp/x.xlsx", period: "2026-Q1" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 missing xlsx path", async () => {
    await mockSession({ orgId: "org_demo", userId: "u1", role: "admin" })
    const res = await PUT(
      makeRequest("/api/admin/source-registry", {
        method: "PUT",
        json: { companyCode: "TEST-X", period: "2026-Q1" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 missing period", async () => {
    await mockSession({ orgId: "org_demo", userId: "u1", role: "admin" })
    const res = await PUT(
      makeRequest("/api/admin/source-registry", {
        method: "PUT",
        json: { companyCode: "TEST-X", xlsx: "tmp/x.xlsx" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("200 writes new entry", async () => {
    await mockSession({ orgId: "org_demo", userId: "u1", role: "admin" })
    const res = await PUT(
      makeRequest("/api/admin/source-registry", {
        method: "PUT",
        json: { companyCode: "TEST-PUT", xlsx: "tmp/test.xlsx", sheet: "Sheet1", period: "2026-Q1" },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.entry).toMatchObject({ xlsx: "tmp/test.xlsx", period: "2026-Q1" })
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
    const res = await DELETE(
      makeRequest("/api/admin/source-registry?companyCode=NONEXISTENT-FAKE-XYZ", { method: "DELETE" }),
    )
    expect(res.status).toBe(404)
  })

  it("200 removes existing entry", async () => {
    await mockSession({ orgId: "org_demo", userId: "u1", role: "admin" })
    await PUT(
      makeRequest("/api/admin/source-registry", {
        method: "PUT",
        json: { companyCode: "TEST-DELETE", xlsx: "tmp/test.xlsx", sheet: null, period: "2026-Q1" },
      }),
    )
    const res = await DELETE(
      makeRequest("/api/admin/source-registry?companyCode=TEST-DELETE", { method: "DELETE" }),
    )
    expect(res.status).toBe(200)
  })
})
