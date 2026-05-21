// @vitest-environment node
/**
 * Phase 7.G Turn LXVIII — handler tests for `/api/budgeting/forecast` POST.
 *
 * Locks Phase 4.2 multi-plan period-lock gate. The forecast route accepts
 * a bulk `entries` array spanning N planIds; if ANY of those plans' periods
 * is locked, the entire batch must reject with 423 (atomic semantics — no
 * partial commits).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetForecastEntry: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    budgetPlan: { findMany: vi.fn() },
    organization: { findUnique: vi.fn() },
    // Phase 5.2 Stage 2 — withOrgScope wraps budget_forecast_entries + budget_plans reads/writes.
    $transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
    ),
    $executeRawUnsafe: vi.fn(async () => 1),
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
  logBudgetChange: vi.fn(),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

// Phase 5.2 — withOrgScope validates 20-32 char cuid-shaped orgId.
const ORG_ID = "cm3rlsforecast000001abc"
const validEntry = {
  planId: "p1",
  month: 1,
  year: 2026,
  category: "Sales",
  forecastAmount: 1000,
}

beforeEach(() => {
  prismaMock.budgetForecastEntry.findUnique.mockReset().mockResolvedValue(null)
  prismaMock.budgetForecastEntry.upsert.mockReset().mockResolvedValue({ id: "f1", forecastAmount: 1000 })
  prismaMock.budgetPlan.findMany.mockReset().mockResolvedValue([
    { id: "p1", status: "draft", periodType: "annual", year: 2026, month: null, quarter: null },
  ])
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
})

describe("POST /api/budgeting/forecast — period lock (Turn LXVIII)", () => {
  it("returns 401 unauth", async () => {
    await mockSession(null)
    const res = await POST(makeRequest("/api/budgeting/forecast", { method: "POST", json: validEntry }))
    expect(res.status).toBe(401)
    expect(prismaMock.budgetForecastEntry.upsert).not.toHaveBeenCalled()
  })

  it("returns 423 Locked + does NOT upsert when ANY plan in bulk is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    // Bulk: 2 plans, only the second is locked (Q2)
    prismaMock.budgetPlan.findMany.mockResolvedValue([
      { id: "p1", status: "draft", periodType: "quarterly", year: 2026, month: null, quarter: 1 },
      { id: "p2", status: "draft", periodType: "quarterly", year: 2026, month: null, quarter: 2 },
    ])
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [
        { period: "2026-Q2", lockedAt: "2026-07-01T00:00:00Z", lockedBy: "u_admin", reason: "Q2 close" },
      ],
    })
    const res = await POST(
      makeRequest("/api/budgeting/forecast", {
        method: "POST",
        json: {
          entries: [
            { ...validEntry, planId: "p1" },
            { ...validEntry, planId: "p2", month: 4 },
          ],
        },
      }),
    )
    expect(res.status).toBe(423)
    const body = await res.json()
    expect(body.lock.period).toBe("2026-Q2")
    expect(prismaMock.budgetForecastEntry.upsert).not.toHaveBeenCalled()
  })

  it("returns 201 happy path when no plan period is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(makeRequest("/api/budgeting/forecast", { method: "POST", json: validEntry }))
    expect(res.status).toBe(201)
    expect(prismaMock.budgetForecastEntry.upsert).toHaveBeenCalledTimes(1)
  })

  it("uses SINGLE org read regardless of N plans (perf contract)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetPlan.findMany.mockResolvedValue([
      { id: "p1", status: "draft", periodType: "monthly", year: 2026, month: 1, quarter: null },
      { id: "p2", status: "draft", periodType: "monthly", year: 2026, month: 2, quarter: null },
      { id: "p3", status: "draft", periodType: "monthly", year: 2026, month: 3, quarter: null },
    ])
    await POST(
      makeRequest("/api/budgeting/forecast", {
        method: "POST",
        json: {
          entries: [
            { ...validEntry, planId: "p1" },
            { ...validEntry, planId: "p2", month: 2 },
            { ...validEntry, planId: "p3", month: 3 },
          ],
        },
      }),
    )
    expect(prismaMock.organization.findUnique).toHaveBeenCalledTimes(1)
  })
})
