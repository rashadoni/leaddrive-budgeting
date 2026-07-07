// @vitest-environment node
/**
 * Handler test for `/api/budgeting/plans/[id]/companies` (GET).
 *
 * Phase 7.G — narrows dropdown to companies that actually have lines
 * in the plan. Locks distinct-companyId query + parent/grandparent
 * walk + cross-tenant 404 guard.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn() },
    budgetLine: { findMany: vi.fn() },
    company: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.company.findMany.mockReset().mockResolvedValue([])
})

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe("GET /api/budgeting/plans/[id]/companies", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(
      makeRequest("/api/budgeting/plans/p1/companies"),
      makeParams("p1"),
    )
    expect(res.status).toBe(401)
  })

  it("404 plan not in caller's org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null)
    const res = await GET(
      makeRequest("/api/budgeting/plans/p1/companies"),
      makeParams("p1"),
    )
    expect(res.status).toBe(404)
  })

  it("200 empty when plan has no company-scoped lines", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({ id: "p1" })
    prismaMock.budgetLine.findMany.mockResolvedValue([])
    const res = await GET(
      makeRequest("/api/budgeting/plans/p1/companies"),
      makeParams("p1"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.companyIds).toEqual([])
  })

  it("200 walks parent + grandparent chain (3-level holding tree)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({ id: "p1" })
    prismaMock.budgetLine.findMany.mockResolvedValue([
      { companyId: "AZSEKER-EDEN" },
      { companyId: "AZSEKER-AZSF" },
    ])
    // First findMany call → parents
    prismaMock.company.findMany.mockResolvedValueOnce([
      { parentCompanyId: "AZSEKER" },
      { parentCompanyId: "AZSEKER" },
    ])
    // Second findMany call → grandparents
    prismaMock.company.findMany.mockResolvedValueOnce([
      { parentCompanyId: "FO-HOLDING" },
    ])
    const res = await GET(
      makeRequest("/api/budgeting/plans/p1/companies"),
      makeParams("p1"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.companyIds).toEqual(
      expect.arrayContaining(["AZSEKER-EDEN", "AZSEKER-AZSF", "AZSEKER", "FO-HOLDING"]),
    )
  })

  it("filters null companyIds (legacy lines)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({ id: "p1" })
    prismaMock.budgetLine.findMany.mockResolvedValue([
      { companyId: "AZSEKER-EDEN" },
      { companyId: null }, // legacy line, must be dropped
    ])
    const res = await GET(
      makeRequest("/api/budgeting/plans/p1/companies"),
      makeParams("p1"),
    )
    const body = await res.json()
    expect(body.companyIds).toContain("AZSEKER-EDEN")
    expect(body.companyIds).not.toContain(null)
  })
})
