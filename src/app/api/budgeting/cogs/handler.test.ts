// @vitest-environment node
/**
 * Phase 7.G Turn LXVIII — handler tests for `/api/budgeting/cogs` POST.
 *
 * Locks Phase 4.2 period-lock gate on the cogs mutation route. Bulk array
 * + single-object both supported by the route; period gate applies to BOTH.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    cOGSBudgetLine: {
      upsert: vi.fn(),
      create: vi.fn(),
    },
    budgetPlan: { findMany: vi.fn() },
    organization: { findUnique: vi.fn() },
    // Phase 8 D3 final — accountId is a required CoA FK since Phase 2.1, so
    // the route resolves it via chartOfAccount.findUnique before writing.
    chartOfAccount: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"
const validBody = {
  planId: "p1",
  productLineId: "pl1",
  year: 2026,
  month: 1,
  productionQty: 100,
  totalCost: 5000,
  // SAP-style code so resolveAccountId() maps it to a CoA row (the FK is
  // required since Phase 2.1; unmatched codes now 400).
  accountCode: "601-01-02",
}

beforeEach(() => {
  prismaMock.cOGSBudgetLine.upsert.mockReset().mockResolvedValue({ id: "c1" })
  prismaMock.cOGSBudgetLine.create.mockReset().mockResolvedValue({ id: "c1" })
  prismaMock.budgetPlan.findMany.mockReset().mockResolvedValue([
    { id: "p1", periodType: "annual", year: 2026, month: null, quarter: null },
  ])
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
  prismaMock.chartOfAccount.findUnique.mockReset().mockResolvedValue({ id: "acc1" })
})

describe("POST /api/budgeting/cogs — period lock (Turn LXVIII)", () => {
  it("returns 401 unauth", async () => {
    await mockSession(null)
    const res = await POST(makeRequest("/api/budgeting/cogs", { method: "POST", json: validBody }))
    expect(res.status).toBe(401)
    expect(prismaMock.cOGSBudgetLine.create).not.toHaveBeenCalled()
    expect(prismaMock.cOGSBudgetLine.upsert).not.toHaveBeenCalled()
  })

  it("returns 423 Locked for single-object body when plan period is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [
        { period: "2026", lockedAt: "2027-01-01T00:00:00Z", lockedBy: "u_admin", reason: "FY26 close" },
      ],
    })
    const res = await POST(makeRequest("/api/budgeting/cogs", { method: "POST", json: validBody }))
    expect(res.status).toBe(423)
    expect(prismaMock.cOGSBudgetLine.create).not.toHaveBeenCalled()
  })

  it("returns 423 Locked for bulk array when ANY plan period is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetPlan.findMany.mockResolvedValue([
      { id: "p1", periodType: "monthly", year: 2026, month: 1, quarter: null },
      { id: "p2", periodType: "monthly", year: 2026, month: 2, quarter: null },
    ])
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [
        { period: "2026-02", lockedAt: "2026-03-01T00:00:00Z", lockedBy: "u_admin" },
      ],
    })
    const res = await POST(
      makeRequest("/api/budgeting/cogs", {
        method: "POST",
        json: [
          { ...validBody, planId: "p1" },
          { ...validBody, planId: "p2", month: 2 },
        ],
      }),
    )
    expect(res.status).toBe(423)
    expect(prismaMock.cOGSBudgetLine.upsert).not.toHaveBeenCalled()
  })

  it("returns 404 when planId references a plan not in caller's org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetPlan.findMany.mockResolvedValue([]) // plan absent
    const res = await POST(makeRequest("/api/budgeting/cogs", { method: "POST", json: validBody }))
    expect(res.status).toBe(404)
    expect(prismaMock.cOGSBudgetLine.create).not.toHaveBeenCalled()
  })

  it("returns 201 happy path when no plan period is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(makeRequest("/api/budgeting/cogs", { method: "POST", json: validBody }))
    expect(res.status).toBe(201)
    expect(prismaMock.cOGSBudgetLine.create).toHaveBeenCalledTimes(1)
  })
})
