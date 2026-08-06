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
    company: { findMany: vi.fn() },
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
  prismaMock.company.findMany.mockReset().mockResolvedValue([{ id: "cmp_sugar" }])
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

  it("200 org-scoped + category+sortOrder orderBy + company join", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/assumptions?planId=p1"))
    expect(prismaMock.budgetAssumption.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, planId: "p1" },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
      // Phase 7.Q — the company name labels an override row in the tab.
      include: { company: { select: { id: true, name: true, code: true } } },
    })
  })

  it("returns BOTH tiers — no server-side companyId filter", async () => {
    // The client resolves precedence and must be able to show the plan-level
    // default that a company override is shadowing. Filtering here would hide
    // the layering the whole feature exists to make visible.
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/assumptions?planId=p1&companyId=cmp_sugar"))
    const where = prismaMock.budgetAssumption.findMany.mock.calls[0][0].where
    expect(where).toEqual({ organizationId: ORG_ID, planId: "p1" })
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

// ── Phase 7.Q — allow-list + company-scope guards on POST ──────────────
describe("POST /api/budgeting/assumptions — write allow-list", () => {
  it("ignores client-supplied id / organizationId / timestamps", async () => {
    // The old handler spread the body into `create`, so any of these was
    // writable — organizationId most seriously, createdAt subtly (it is the
    // resolver's oldest-wins tie-break).
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/assumptions", {
        method: "POST",
        json: {
          planId: "p1",
          category: "fx",
          key: "import_share",
          value: 0.7,
          id: "attacker-chosen",
          organizationId: "org_other",
          createdAt: "1999-01-01T00:00:00Z",
          updatedAt: "1999-01-01T00:00:00Z",
        },
      }),
    )
    expect(res.status).toBe(201)
    const data = prismaMock.budgetAssumption.create.mock.calls[0][0].data
    expect(data.id).toBeUndefined()
    expect(data.createdAt).toBeUndefined()
    expect(data.updatedAt).toBeUndefined()
    expect(data.organizationId).toBe(ORG_ID)
  })

  it("planId comes from the org-verified plan, not from the item body", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    await POST(
      makeRequest("/api/budgeting/assumptions", {
        method: "POST",
        json: { planId: "p1", category: "fx", key: "import_share", value: 0.7 },
      }),
    )
    expect(prismaMock.budgetAssumption.create.mock.calls[0][0].data.planId).toBe("p1")
  })

  it("400 on a non-finite value", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/assumptions", {
        method: "POST",
        json: { planId: "p1", category: "fx", key: "import_share", value: "not-a-number" },
      }),
    )
    expect(res.status).toBe(400)
    expect(prismaMock.budgetAssumption.create).not.toHaveBeenCalled()
  })

  it("400 names the offending index in an array payload", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/assumptions", {
        method: "POST",
        json: [
          { planId: "p1", category: "fx", key: "a", value: 1 },
          { planId: "p1", category: "fx", key: "", value: 2 },
        ],
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("Item 1")
    expect(prismaMock.budgetAssumption.createMany).not.toHaveBeenCalled()
  })

  it("404 when companyId belongs to another tenant", async () => {
    // RLS keeps the foreign company out of the findMany result, so it comes
    // back as unknown rather than as a row this org may attach to.
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.company.findMany.mockResolvedValue([])
    const res = await POST(
      makeRequest("/api/budgeting/assumptions", {
        method: "POST",
        json: {
          planId: "p1",
          category: "fx",
          key: "import_share",
          value: 0.7,
          companyId: "cmp_other_tenant",
        },
      }),
    )
    expect(res.status).toBe(404)
    expect(prismaMock.budgetAssumption.create).not.toHaveBeenCalled()
  })

  it("201 with an in-org companyId — one lookup for the whole batch", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/assumptions", {
        method: "POST",
        json: [
          { planId: "p1", category: "fx", key: "a", value: 1, companyId: "cmp_sugar" },
          { planId: "p1", category: "fx", key: "b", value: 2, companyId: "cmp_sugar" },
        ],
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.company.findMany).toHaveBeenCalledTimes(1)
  })

  it("a plan-level row needs no company lookup at all", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    await POST(
      makeRequest("/api/budgeting/assumptions", {
        method: "POST",
        json: { planId: "p1", category: "fx", key: "inflation", value: 0.06 },
      }),
    )
    expect(prismaMock.company.findMany).not.toHaveBeenCalled()
  })
})
