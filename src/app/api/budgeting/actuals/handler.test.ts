// @vitest-environment node
/**
 * Phase 7.G Turn LXVIII — handler tests for `/api/budgeting/actuals` POST.
 *
 * Locks Phase 4.2 period-lock gate on the actuals mutation route. Smoke
 * coverage on auth + lock-respect + happy path. Currency conversion +
 * department access tested elsewhere — this file is for the lock contract.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetActual: { create: vi.fn() },
    budgetPlan: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    currencyRate: { findFirst: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
  logBudgetChange: vi.fn(),
}))
vi.mock("@/lib/budgeting/currency", () => ({
  processCurrencyFields: vi.fn().mockResolvedValue({
    plannedAmount: 100,
    currencyCode: "AZN",
    exchangeRate: 1,
    originalAmount: 100,
  }),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"
const validBody = { planId: "p1", category: "Sales", actualAmount: 100 }

beforeEach(() => {
  prismaMock.budgetActual.create.mockReset().mockResolvedValue({ id: "a1" })
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({
    id: "p1",
    status: "draft",
    periodType: "annual",
    year: 2026,
    month: null,
    quarter: null,
  })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
})

describe("POST /api/budgeting/actuals — period lock (Turn LXVIII)", () => {
  it("returns 401 unauth", async () => {
    await mockSession(null)
    const res = await POST(makeRequest("/api/budgeting/actuals", { method: "POST", json: validBody }))
    expect(res.status).toBe(401)
    expect(prismaMock.budgetActual.create).not.toHaveBeenCalled()
  })

  it("returns 423 Locked when plan period is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [
        { period: "2026", lockedAt: "2027-01-01T00:00:00Z", lockedBy: "u_admin", reason: "FY26 close" },
      ],
    })
    const res = await POST(makeRequest("/api/budgeting/actuals", { method: "POST", json: validBody }))
    expect(res.status).toBe(423)
    const body = await res.json()
    expect(body.error).toMatch(/Period locked/i)
    expect(body.lock.period).toBe("2026")
    expect(prismaMock.budgetActual.create).not.toHaveBeenCalled()
  })

  it("returns 201 happy path when no lock is set", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(makeRequest("/api/budgeting/actuals", { method: "POST", json: validBody }))
    expect(res.status).toBe(201)
    expect(prismaMock.budgetActual.create).toHaveBeenCalledTimes(1)
  })

  it("403 approved-status fires BEFORE 423 lock check (existing gate stays in front)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({
      id: "p1",
      status: "approved",
      periodType: "annual",
      year: 2026,
      month: null,
      quarter: null,
    })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedAt: "x", lockedBy: "y" }],
    })
    const res = await POST(makeRequest("/api/budgeting/actuals", { method: "POST", json: validBody }))
    expect(res.status).toBe(403) // approved gate wins
  })
})
