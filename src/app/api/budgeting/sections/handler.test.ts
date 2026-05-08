// @vitest-environment node
/**
 * Phase 7.G Turn LXIII — handler tests for `/api/budgeting/sections`.
 *
 * Closes Turn-LXII Tier 2 H1. Locks role-gate (Turn LXII M2) + planId
 * required + Zod + org-scoped queries.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetSection: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    budgetPlan: {
      findFirst: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetSection.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetSection.create.mockReset()
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({
    id: "p1",
    periodType: "annual",
    year: 2026,
    month: null,
    quarter: null,
  })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
})

describe("GET /api/budgeting/sections", () => {
  it("returns 401 unauth", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/sections?planId=p1"))
    expect(res.status).toBe(401)
  })

  it("returns 400 when planId missing", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/sections"))
    expect(res.status).toBe(400)
  })

  it("returns 200 + filters by planId + organizationId for viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/sections?planId=p1"))
    expect(res.status).toBe(200)
    const calledWhere = prismaMock.budgetSection.findMany.mock.calls[0][0].where
    expect(calledWhere.organizationId).toBe(ORG_ID)
    expect(calledWhere.planId).toBe("p1")
  })
})

describe("POST /api/budgeting/sections — role gate (Turn LXII M2)", () => {
  const validBody = { planId: "p1", name: "Revenue" }

  it("returns 403 when viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/sections", { method: "POST", json: validBody }),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.budgetSection.create).not.toHaveBeenCalled()
  })

  it("returns 400 on Zod .strict() — unknown key", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/budgeting/sections", {
        method: "POST",
        json: { ...validBody, organizationId: "evil_org" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 201 + applies sectionType default for manager", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetSection.create.mockResolvedValue({
      id: "s1",
      organizationId: ORG_ID,
      planId: "p1",
      name: "Revenue",
      sectionType: "expense",
    })
    const res = await POST(
      makeRequest("/api/budgeting/sections", { method: "POST", json: validBody }),
    )
    expect(res.status).toBe(201)
    const createArg = prismaMock.budgetSection.create.mock.calls[0][0]
    expect(createArg.data.organizationId).toBe(ORG_ID)
    expect(createArg.data.sectionType).toBe("expense") // default applied
  })
})

describe("POST /api/budgeting/sections — Phase 4.2 period lock (Turn LXVIII)", () => {
  const validBody = { planId: "p1", name: "Revenue" }

  it("returns 404 when plan not found in org (cross-tenant guard)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null)
    const res = await POST(
      makeRequest("/api/budgeting/sections", { method: "POST", json: validBody }),
    )
    expect(res.status).toBe(404)
    expect(prismaMock.budgetSection.create).not.toHaveBeenCalled()
  })

  it("returns 423 Locked when plan period is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [
        { period: "2026", lockedAt: "2027-01-01T00:00:00Z", lockedBy: "u_admin", reason: "FY26 close" },
      ],
    })
    const res = await POST(
      makeRequest("/api/budgeting/sections", { method: "POST", json: validBody }),
    )
    expect(res.status).toBe(423)
    const body = await res.json()
    expect(body.error).toMatch(/Period locked/i)
    expect(body.lock.period).toBe("2026")
    expect(body.lock.reason).toBe("FY26 close")
    expect(prismaMock.budgetSection.create).not.toHaveBeenCalled()
  })
})
