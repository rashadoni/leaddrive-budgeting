// @vitest-environment node
/**
 * Handler test for `/api/budgeting/assumptions` (GET + POST).
 *
 * Mirrors balance-sheet / sales-budget shape: period-lock gate +
 * cross-tenant plan guard + single/array variants.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetAssumption: {
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },
    budgetPlan: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetAssumption.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetAssumption.create.mockReset().mockResolvedValue({ id: "a1" })
  prismaMock.budgetAssumption.createMany.mockReset().mockResolvedValue({ count: 2 })
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({
    id: "p1", periodType: "annual", year: 2026, month: null, quarter: null,
  })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "ae1" })
})

describe("GET /api/budgeting/assumptions", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/assumptions?planId=p1"))
    expect(res.status).toBe(401)
  })

  it("400 missing planId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/assumptions"))
    expect(res.status).toBe(400)
  })

  it("200 org-scoped + category+sortOrder orderBy", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/assumptions?planId=p1"))
    expect(prismaMock.budgetAssumption.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, planId: "p1" },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
    })
  })
})

describe("POST /api/budgeting/assumptions", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/assumptions", {
        method: "POST",
        json: { planId: "p1", category: "growth", key: "y1", value: "0.05" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 missing planId in body", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/assumptions", {
        method: "POST",
        json: { category: "growth" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 array with mixed planIds", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/assumptions", {
        method: "POST",
        json: [
          { planId: "p1", category: "g", key: "y1", value: "0.05" },
          { planId: "p2", category: "g", key: "y2", value: "0.06" },
        ],
      }),
    )
    expect(res.status).toBe(400)
  })

  it("404 cross-tenant planId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null)
    const res = await POST(
      makeRequest("/api/budgeting/assumptions", {
        method: "POST",
        json: { planId: "p-other", category: "g", key: "y1", value: "0.05" },
      }),
    )
    expect(res.status).toBe(404)
  })

  it("201 single happy path", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/assumptions", {
        method: "POST",
        json: { planId: "p1", category: "growth", key: "y1", value: "0.05" },
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.budgetAssumption.create).toHaveBeenCalled()
  })

  it("201 array createMany happy path", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/assumptions", {
        method: "POST",
        json: [
          { planId: "p1", category: "g", key: "y1", value: "0.05" },
          { planId: "p1", category: "g", key: "y2", value: "0.06" },
        ],
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.budgetAssumption.createMany).toHaveBeenCalled()
  })
})
