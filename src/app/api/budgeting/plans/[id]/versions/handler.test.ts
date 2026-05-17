// @vitest-environment node
/**
 * Handler test for `/api/budgeting/plans/[id]/versions` (GET).
 *
 * Locks plan-version chain resolution:
 * - If plan is the root → list root + all amendments
 * - If plan is an amendment → list root (via amendmentOf) + siblings
 * - Org-scoped throughout
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.budgetPlan.findMany.mockReset().mockResolvedValue([])
})

describe("GET /api/budgeting/plans/[id]/versions", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/plans/p1/versions"), {
      params: Promise.resolve({ id: "p1" }),
    })
    expect(res.status).toBe(401)
  })

  it("404 plan not found in org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null)
    const res = await GET(makeRequest("/api/budgeting/plans/p1/versions"), {
      params: Promise.resolve({ id: "p1" }),
    })
    expect(res.status).toBe(404)
  })

  it("200: when plan IS the root, uses plan.id as rootId for version chain", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({
      id: "root-1",
      amendmentOf: null,
      name: "FY2026",
    })
    prismaMock.budgetPlan.findMany.mockResolvedValue([
      { id: "root-1", version: 1, versionLabel: null },
      { id: "amend-1", version: 2, versionLabel: "rev 1", amendmentOf: "root-1" },
    ])
    const res = await GET(makeRequest("/api/budgeting/plans/root-1/versions"), {
      params: Promise.resolve({ id: "root-1" }),
    })
    expect(res.status).toBe(200)
    expect(prismaMock.budgetPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORG_ID,
          OR: [{ id: "root-1" }, { amendmentOf: "root-1" }],
        },
        orderBy: { version: "asc" },
      }),
    )
    const body = await res.json()
    expect(body).toHaveLength(2)
  })

  it("200: when plan IS an amendment, uses amendmentOf as rootId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({
      id: "amend-2",
      amendmentOf: "root-1", // child of root-1
    })
    await GET(makeRequest("/api/budgeting/plans/amend-2/versions"), {
      params: Promise.resolve({ id: "amend-2" }),
    })
    // Version chain query uses amendmentOf=root-1, not the amendment id
    expect(prismaMock.budgetPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORG_ID,
          OR: [{ id: "root-1" }, { amendmentOf: "root-1" }],
        },
      }),
    )
  })
})
