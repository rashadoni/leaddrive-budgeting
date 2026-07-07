// @vitest-environment node
/**
 * Handler test for `/api/terminal/layouts` (GET + POST).
 *
 * Phase 7.D terminal layout persistence. Locks per-user org-scoped
 * read + upsert semantics on (userId, name) + validation envelope.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    userLayoutPreference: {
      findMany: vi.fn(),
      upsert: vi.fn(),
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
vi.mock("@prisma/client", () => ({ Prisma: {} }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_demo"
const USER_ID = "u_editor"

const VALID_SIZES = {
  outer: { "row-top": 50, "row-bottom": 50 },
  top: { p1: 50, p2: 50 },
  bottom: { p3: 50, p4: 50 },
}

beforeEach(() => {
  prismaMock.userLayoutPreference.findMany.mockReset().mockResolvedValue([])
  prismaMock.userLayoutPreference.upsert.mockReset().mockResolvedValue({
    id: "l1",
    name: "default",
    sizes: VALID_SIZES,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
})

describe("GET /api/terminal/layouts", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/terminal/layouts"))
    expect(res.status).toBe(401)
  })

  it("200 with per-user org-scoped layouts", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
    prismaMock.userLayoutPreference.findMany.mockResolvedValue([
      { id: "l1", name: "default", sizes: VALID_SIZES, createdAt: new Date(), updatedAt: new Date() },
    ])
    const res = await GET(makeRequest("/api/terminal/layouts"))
    expect(res.status).toBe(200)
    expect(prismaMock.userLayoutPreference.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID, organizationId: ORG_ID },
        orderBy: { updatedAt: "desc" },
      }),
    )
    const body = await res.json()
    expect(body.layouts).toHaveLength(1)
  })
})

describe("POST /api/terminal/layouts", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/terminal/layouts", {
        method: "POST",
        json: { name: "default", sizes: VALID_SIZES },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 invalid name (empty)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
    const res = await POST(
      makeRequest("/api/terminal/layouts", {
        method: "POST",
        json: { name: "", sizes: VALID_SIZES },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 invalid name (BEL control char rejected, via JS escape)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
    // Use JS string escape \x07 (BEL, ASCII 7) — keeps the SOURCE file
    // pure-text so git diff treats this commit as text, not binary.
    // The validator's regex `[-...]` rejects the BEL char.
    const nameWithBel = "has" + "\x07" + "bell"
    const res = await POST(
      makeRequest("/api/terminal/layouts", {
        method: "POST",
        json: { name: nameWithBel, sizes: VALID_SIZES },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 invalid sizes (empty object)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
    const res = await POST(
      makeRequest("/api/terminal/layouts", {
        method: "POST",
        json: { name: "default", sizes: {} },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 invalid sizes (panel-id map sums != 100)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
    const badSizes = {
      outer: { "row-top": 30, "row-bottom": 30 }, // sums to 60, not 100
      top: { p1: 50, p2: 50 },
      bottom: { p3: 50, p4: 50 },
    }
    const res = await POST(
      makeRequest("/api/terminal/layouts", {
        method: "POST",
        json: { name: "default", sizes: badSizes },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("200 happy path → upsert on (userId, name) composite key", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
    const res = await POST(
      makeRequest("/api/terminal/layouts", {
        method: "POST",
        json: { name: "default", sizes: VALID_SIZES },
      }),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.userLayoutPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_name: { userId: USER_ID, name: "default" } },
        create: expect.objectContaining({
          organizationId: ORG_ID,
          userId: USER_ID,
          name: "default",
        }),
      }),
    )
  })
})
