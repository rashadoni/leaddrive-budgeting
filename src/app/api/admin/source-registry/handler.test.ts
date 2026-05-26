// @vitest-environment node
/**
 * Handler test for `/api/admin/source-registry` (GET + PUT + DELETE).
 *
 * Truth-infra L4 — file-backed source registry CRUD. Locks admin-only
 * gate, validation envelopes, and 404 on missing entries.
 *
 * Filesystem: the route writes to `data/onboarding-source-registry.json`
 * via `fs.promises`. Tests use an in-memory vi.mock("fs") store so the
 * suite is hermetic (no real disk I/O, no sandbox EPERM, CI-safe).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

// ── in-memory fs mock ──────────────────────────────────────────────────
// Shared via vi.hoisted so the mock factory can reference the store
// before imports are resolved.
const { fsMock } = vi.hoisted(() => {
  const store: Record<string, string> = {}
  const fsMock = {
    readFile: vi.fn(async (p: string): Promise<string> => {
      if (Object.prototype.hasOwnProperty.call(store, p)) return store[p]
      const err = Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: "ENOENT" })
      throw err
    }),
    writeFile: vi.fn(async (p: string, content: string): Promise<void> => {
      store[p] = content
    }),
    rename: vi.fn(async (src: string, dst: string): Promise<void> => {
      store[dst] = store[src]
      delete store[src]
    }),
    unlink: vi.fn(async (p: string): Promise<void> => {
      delete store[p]
    }),
    _store: store,
    _reset() { for (const k of Object.keys(store)) delete store[k] },
  }
  return { fsMock }
})

vi.mock("fs", () => ({
  promises: {
    readFile: fsMock.readFile,
    writeFile: fsMock.writeFile,
    rename: fsMock.rename,
    unlink: fsMock.unlink,
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, PUT, DELETE } from "./route"

beforeEach(() => {
  fsMock._reset()
  fsMock.readFile.mockClear()
  fsMock.writeFile.mockClear()
  fsMock.rename.mockClear()
  fsMock.unlink.mockClear()
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

  it("200 returns entries (empty when no file)", async () => {
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

  it("200 writes new entry (in-memory store, no real I/O)", async () => {
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

  it("200 removes existing entry (in-memory store, no real I/O)", async () => {
    await mockSession({ orgId: "org_demo", userId: "u1", role: "admin" })
    // First PUT an entry into the in-memory store
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
