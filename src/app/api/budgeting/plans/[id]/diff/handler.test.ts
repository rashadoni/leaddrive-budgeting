// @vitest-environment node
/**
 * Handler test for `/api/budgeting/plans/[id]/diff` (GET).
 *
 * Locks plan-vs-plan diff math: added/removed/changed/unchanged
 * classification, abs(delta) < 0.01 → unchanged tolerance, and
 * cross-org isolation via org-scoped findMany.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetLine: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([])
})

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe("GET /api/budgeting/plans/[id]/diff", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(
      makeRequest("/api/budgeting/plans/p1/diff?compareWith=p2"),
      makeParams("p1"),
    )
    expect(res.status).toBe(401)
  })

  it("400 missing compareWith query param", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(
      makeRequest("/api/budgeting/plans/p1/diff"),
      makeParams("p1"),
    )
    expect(res.status).toBe(400)
  })

  it("200 happy path: added / removed / changed / unchanged classification", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    // Phase 2.1 session 3: diff route now keys by `account.code`
    // (not the dropped `category` String). Mock returns via the
    // FK relation shape used by include: { account: { select: ... } }.
    prismaMock.budgetLine.findMany
      .mockResolvedValueOnce([
        // planA
        { account: { code: "Same" }, department: null, lineType: "expense", plannedAmount: 100 },
        { account: { code: "Removed" }, department: null, lineType: "expense", plannedAmount: 50 },
        { account: { code: "Changed" }, department: null, lineType: "expense", plannedAmount: 200 },
      ])
      .mockResolvedValueOnce([
        // planB
        { account: { code: "Same" }, department: null, lineType: "expense", plannedAmount: 100 },
        { account: { code: "Added" }, department: null, lineType: "expense", plannedAmount: 75 },
        { account: { code: "Changed" }, department: null, lineType: "expense", plannedAmount: 250 },
      ])

    const res = await GET(
      makeRequest("/api/budgeting/plans/p1/diff?compareWith=p2"),
      makeParams("p1"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.planA).toBe("p1")
    expect(body.planB).toBe("p2")

    const statuses = body.diff.map((d: { status: string }) => d.status)
    expect(statuses).toContain("added")
    expect(statuses).toContain("removed")
    expect(statuses).toContain("changed")
    expect(statuses).toContain("unchanged")
    expect(body.totalChanges).toBe(3) // not counting unchanged
  })

  it("delta < 0.01 → unchanged (tolerance for IEEE-754 noise)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetLine.findMany
      .mockResolvedValueOnce([{ account: { code: "X" }, department: null, lineType: "expense", plannedAmount: 100 }])
      .mockResolvedValueOnce([{ account: { code: "X" }, department: null, lineType: "expense", plannedAmount: 100.005 }])
    const res = await GET(
      makeRequest("/api/budgeting/plans/p1/diff?compareWith=p2"),
      makeParams("p1"),
    )
    const body = await res.json()
    expect(body.diff[0].status).toBe("unchanged")
  })

  it("org-scoped findMany (both plans filtered by orgId)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(
      makeRequest("/api/budgeting/plans/p1/diff?compareWith=p2"),
      makeParams("p1"),
    )
    const calls = prismaMock.budgetLine.findMany.mock.calls
    expect(calls[0][0].where).toMatchObject({ planId: "p1", organizationId: ORG_ID })
    expect(calls[1][0].where).toMatchObject({ planId: "p2", organizationId: ORG_ID })
  })
})
