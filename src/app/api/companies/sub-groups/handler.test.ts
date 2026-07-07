// @vitest-environment node
/**
 * Handler test for `/api/companies/sub-groups` (GET).
 *
 * Phase 7.F sub-group RBAC admin v2 — list level-1 sub-groups for the
 * access picker. Admin-only.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
// Stage 3 RLS — the route wraps DB access in withOrgScope; hand it the prismaMock as tx.
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.company.findMany.mockReset().mockResolvedValue([])
})

describe("GET /api/companies/sub-groups", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/companies/sub-groups"))
    expect(res.status).toBe(401)
    expect(prismaMock.company.findMany).not.toHaveBeenCalled()
  })

  it("403 when below admin (manager rejected)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await GET(makeRequest("/api/companies/sub-groups"))
    expect(res.status).toBe(403)
  })

  it("200 with org-scoped + parentCompanyId=null + isActive filter", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    await GET(makeRequest("/api/companies/sub-groups"))
    expect(prismaMock.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORG_ID,
          parentCompanyId: null,
          isActive: true,
        },
        orderBy: { sortOrder: "asc" },
      }),
    )
  })

  it("flattens _count.children → childCount in response shape", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.company.findMany.mockResolvedValue([
      { id: "g1", code: "AAC", name: "AAC Holdings", _count: { children: 5 } },
      { id: "g2", code: "ATL", name: "ATL Group", _count: { children: 4 } },
    ])
    const res = await GET(makeRequest("/api/companies/sub-groups"))
    const body = await res.json()
    expect(body.subGroups).toEqual([
      { id: "g1", code: "AAC", name: "AAC Holdings", childCount: 5 },
      { id: "g2", code: "ATL", name: "ATL Group", childCount: 4 },
    ])
  })
})
