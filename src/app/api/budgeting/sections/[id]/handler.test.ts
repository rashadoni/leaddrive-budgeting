// @vitest-environment node
/**
 * Phase 7.G Turn LXIII — handler tests for `/api/budgeting/sections/[id]`.
 *
 * Closes Turn-LXII Tier 2 H1. Locks role-gate (Turn LXII M2) + cross-tenant
 * 404 + Zod + org-scoped updateMany/deleteMany.
 *
 * Note: PUT uses `updateMany` then `findFirst` (not `update`) so cross-tenant
 * id leak resolves to count=0 → 404. DELETE uses `deleteMany`. Tests assert
 * the org-isolation contract.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetSection: {
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
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
import { PUT, DELETE } from "./route"

const ORG_ID = "org_demo"

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  prismaMock.budgetSection.updateMany.mockReset()
  prismaMock.budgetSection.deleteMany.mockReset()
  // findFirst is called for: (1) lock-check section lookup, (2) lock-check plan
  // lookup (via budgetPlan), (3) post-update section read. Default the section
  // findFirst to return a section with a planId so the lock-check chain can
  // walk to plan + lockedPeriods (both default to "no lock").
  prismaMock.budgetSection.findFirst
    .mockReset()
    .mockResolvedValue({ id: "s1", organizationId: ORG_ID, planId: "p1", name: "Renamed" })
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({
    id: "p1",
    periodType: "annual",
    year: 2026,
    month: null,
    quarter: null,
  })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
})

describe("PUT /api/budgeting/sections/[id] — role gate (Turn LXII M2)", () => {
  it("returns 403 when viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await PUT(
      makeRequest("/api/budgeting/sections/s1", {
        method: "PUT",
        json: { name: "Renamed" },
      }),
      paramsFor("s1"),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.budgetSection.updateMany).not.toHaveBeenCalled()
  })

  it("returns 404 when cross-tenant id (updateMany count=0)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetSection.updateMany.mockResolvedValue({ count: 0 })
    const res = await PUT(
      makeRequest("/api/budgeting/sections/s_other_org", {
        method: "PUT",
        json: { name: "Renamed" },
      }),
      paramsFor("s_other_org"),
    )
    expect(res.status).toBe(404)
    // org filter must be applied
    const updateArg = prismaMock.budgetSection.updateMany.mock.calls[0][0]
    expect(updateArg.where.organizationId).toBe(ORG_ID)
  })

  it("returns 200 + org-scoped findFirst on happy manager path", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetSection.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.budgetSection.findFirst.mockResolvedValue({
      id: "s1",
      organizationId: ORG_ID,
      name: "Renamed",
    })
    const res = await PUT(
      makeRequest("/api/budgeting/sections/s1", {
        method: "PUT",
        json: { name: "Renamed" },
      }),
      paramsFor("s1"),
    )
    expect(res.status).toBe(200)
    expect(
      prismaMock.budgetSection.findFirst.mock.calls[0][0].where.organizationId,
    ).toBe(ORG_ID)
  })
})

describe("DELETE /api/budgeting/sections/[id] — role gate", () => {
  it("returns 403 when viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await DELETE(
      makeRequest("/api/budgeting/sections/s1", { method: "DELETE" }),
      paramsFor("s1"),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.budgetSection.deleteMany).not.toHaveBeenCalled()
  })

  it("returns 200 + filters by org for manager (deleteMany cross-tenant safe)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetSection.deleteMany.mockResolvedValue({ count: 1 })
    const res = await DELETE(
      makeRequest("/api/budgeting/sections/s1", { method: "DELETE" }),
      paramsFor("s1"),
    )
    expect(res.status).toBe(200)
    const deleteArg = prismaMock.budgetSection.deleteMany.mock.calls[0][0]
    expect(deleteArg.where.organizationId).toBe(ORG_ID)
  })
})

describe("PUT/DELETE /api/budgeting/sections/[id] — Phase 4.2 period lock (Turn LXVIII follow-up)", () => {
  it("PUT returns 423 when section's plan period is locked + does NOT updateMany", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedAt: "2027-01-01T00:00:00Z", lockedBy: "u_admin", reason: "FY26" }],
    })
    const res = await PUT(
      makeRequest("/api/budgeting/sections/s1", { method: "PUT", json: { name: "X" } }),
      paramsFor("s1"),
    )
    expect(res.status).toBe(423)
    expect(prismaMock.budgetSection.updateMany).not.toHaveBeenCalled()
  })

  it("DELETE returns 423 when section's plan period is locked + does NOT deleteMany", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedAt: "2027-01-01T00:00:00Z", lockedBy: "u_admin" }],
    })
    const res = await DELETE(
      makeRequest("/api/budgeting/sections/s1", { method: "DELETE" }),
      paramsFor("s1"),
    )
    expect(res.status).toBe(423)
    expect(prismaMock.budgetSection.deleteMany).not.toHaveBeenCalled()
  })
})
