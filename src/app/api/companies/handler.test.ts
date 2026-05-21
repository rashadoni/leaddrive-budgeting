// @vitest-environment node
/**
 * Handler test for `/api/companies` (GET list + POST create).
 *
 * Locks:
 * - Org-scoped GET with 3-level holding-tree include (root + level 1
 *   + level 2) — Phase 7.H AZMADE 3-deep tree depended on this.
 * - Cache-Control: private, max-age=10 header (architect Round-1
 *   anti-thundering-herd fix).
 * - POST validation: manager+ role / required code + name / level=1|2 /
 *   level=1 must not have parentCompanyId (level=2 + null parent IS
 *   allowed per Turn 14 reframe for direct-org-child op-cos) / parent
 *   must belong to same org (404 on cross-tenant parent id).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    company: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    // Phase 5.2 Stage 2 Tier 4 — withOrgScope wraps companies reads/writes.
    $transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
    ),
    $executeRawUnsafe: vi.fn(async () => 1),
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

// Phase 5.2 — withOrgScope validates 20-32 char cuid-shaped orgId.
const ORG_ID = "cm3rlscompany000001abc"

beforeEach(() => {
  prismaMock.company.findMany.mockReset().mockResolvedValue([])
  prismaMock.company.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.company.create.mockReset().mockResolvedValue({ id: "new" })
})

describe("GET /api/companies", () => {
  it("401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/companies"))
    expect(res.status).toBe(401)
    expect(prismaMock.company.findMany).not.toHaveBeenCalled()
  })

  it("200 with 3-level holding tree (root + 2 child levels)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.company.findMany.mockResolvedValue([
      {
        id: "azmade",
        children: [
          { id: "aac", children: [{ id: "aac-main" }] },
        ],
      },
    ])
    const res = await GET(makeRequest("/api/companies"))
    expect(res.status).toBe(200)
    // Verify Prisma query asks for 3-level depth + org-scope + root-only
    expect(prismaMock.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, parentCompanyId: null },
        include: expect.objectContaining({
          children: expect.objectContaining({
            include: expect.objectContaining({
              children: expect.anything(),
            }),
          }),
        }),
      }),
    )
  })

  it("sets Cache-Control: private, max-age=10 (anti-thundering-herd)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/companies"))
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=10")
  })
})

describe("POST /api/companies", () => {
  it("401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/companies", {
        method: "POST",
        json: { code: "C1", name: "Co 1" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("403 when role is below manager", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/companies", {
        method: "POST",
        json: { code: "C1", name: "Co 1" },
      }),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.company.create).not.toHaveBeenCalled()
  })

  it("400 when code is missing", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/companies", {
        method: "POST",
        json: { name: "Co 1" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 when name is missing", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/companies", {
        method: "POST",
        json: { code: "C1" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 when level is not 1 or 2", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/companies", {
        method: "POST",
        json: { code: "C1", name: "Co 1", level: 3 },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 when level=1 + parentCompanyId set (invariant violation)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/companies", {
        method: "POST",
        json: { code: "C1", name: "Co 1", level: 1, parentCompanyId: "parent1" },
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/level=1/)
  })

  it("400 when parentCompanyId is set but parent doesn't belong to this org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue(null) // parent not found in org
    const res = await POST(
      makeRequest("/api/companies", {
        method: "POST",
        json: { code: "C1", name: "Co 1", parentCompanyId: "p-other-org" },
      }),
    )
    expect(res.status).toBe(400)
    expect(prismaMock.company.create).not.toHaveBeenCalled()
  })

  it("201 happy path: level inferred from parentCompanyId presence", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue({ id: "parent1" })
    prismaMock.company.create.mockResolvedValue({
      id: "new1",
      code: "C1",
      name: "Co 1",
      level: 2,
    })
    const res = await POST(
      makeRequest("/api/companies", {
        method: "POST",
        json: { code: "C1", name: "Co 1", parentCompanyId: "parent1" },
      }),
    )
    expect(res.status).toBe(201)
    // level=2 inferred because parentCompanyId provided
    expect(prismaMock.company.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          parentCompanyId: "parent1",
          level: 2,
        }),
      }),
    )
  })

  it("201 level=2 + parentCompanyId=null allowed (Turn 14 reframe — direct-org-child)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/companies", {
        method: "POST",
        json: { code: "AAC", name: "AAC", level: 2 }, // no parent
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.company.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ level: 2, parentCompanyId: null }),
      }),
    )
  })
})
