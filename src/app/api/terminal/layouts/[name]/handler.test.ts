// @vitest-environment node
/**
 * Handler test for `/api/terminal/layouts/[name]` (GET + DELETE).
 *
 * Phase 7.D — single-layout read + delete. Locks user-scoped lookup,
 * decoded-name validation, deleteMany cross-user defense-in-depth,
 * and 404 on missing.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    userLayoutPreference: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
// Stage 3 RLS — hand the mock straight to the scope callback.
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, DELETE } from "./route"

const ORG_ID = "org_demo"
const USER_ID = "u_editor"

beforeEach(() => {
  prismaMock.userLayoutPreference.findUnique.mockReset().mockResolvedValue(null)
  prismaMock.userLayoutPreference.deleteMany.mockReset().mockResolvedValue({ count: 0 })
})

const makeParams = (name: string) => ({ params: Promise.resolve({ name }) })

describe("GET /api/terminal/layouts/[name]", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/terminal/layouts/default"), makeParams("default"))
    expect(res.status).toBe(401)
  })

  it("400 invalid layout name (BEL control byte)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
    const badName = "has" + "\x07" + "bell"
    const res = await GET(
      makeRequest(`/api/terminal/layouts/${encodeURIComponent(badName)}`),
      makeParams(encodeURIComponent(badName)),
    )
    expect(res.status).toBe(400)
  })

  it("404 layout not found", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
    const res = await GET(makeRequest("/api/terminal/layouts/missing"), makeParams("missing"))
    expect(res.status).toBe(404)
  })

  it("200 happy path — user-scoped findUnique", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
    prismaMock.userLayoutPreference.findUnique.mockResolvedValue({
      id: "l1",
      name: "default",
      sizes: { outer: { "row-top": 50, "row-bottom": 50 } },
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const res = await GET(makeRequest("/api/terminal/layouts/default"), makeParams("default"))
    expect(res.status).toBe(200)
    expect(prismaMock.userLayoutPreference.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_name: { userId: USER_ID, name: "default" } },
      }),
    )
  })
})

describe("DELETE /api/terminal/layouts/[name]", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await DELETE(makeRequest("/api/terminal/layouts/default", { method: "DELETE" }), makeParams("default"))
    expect(res.status).toBe(401)
  })

  it("400 invalid layout name", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
    const res = await DELETE(
      makeRequest("/api/terminal/layouts/", { method: "DELETE" }),
      makeParams(""),
    )
    expect(res.status).toBe(400)
  })

  it("404 when no rows affected", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
    prismaMock.userLayoutPreference.deleteMany.mockResolvedValue({ count: 0 })
    const res = await DELETE(
      makeRequest("/api/terminal/layouts/missing", { method: "DELETE" }),
      makeParams("missing"),
    )
    expect(res.status).toBe(404)
  })

  it("200 + (userId, orgId, name) scope on delete", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
    prismaMock.userLayoutPreference.deleteMany.mockResolvedValue({ count: 1 })
    const res = await DELETE(
      makeRequest("/api/terminal/layouts/default", { method: "DELETE" }),
      makeParams("default"),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.userLayoutPreference.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID, organizationId: ORG_ID, name: "default" },
      }),
    )
  })
})
