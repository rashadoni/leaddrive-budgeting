// @vitest-environment node
/**
 * Phase 7.G Turn LXIX — handler tests for `/api/budgeting/rolling/auto-forecast` POST.
 * Locks Phase 4.2 period-lock gate. auto-forecast upserts forecast rows
 * into N forecast months — gate must check plan period + each forecast
 * month's containers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn() },
    budgetActual: { findMany: vi.fn() },
    rollingForecastMonth: { findMany: vi.fn() },
    budgetForecastEntry: { upsert: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"
const validBody = { planId: "p1" }

beforeEach(() => {
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({
    id: "p1",
    organizationId: ORG_ID,
    periodType: "monthly",
    year: 2026,
    month: 1,
    quarter: null,
  })
  prismaMock.budgetActual.findMany.mockReset().mockResolvedValue([])
  prismaMock.rollingForecastMonth.findMany.mockReset().mockResolvedValue([
    { year: 2026, month: 7, status: "forecast" },
  ])
  prismaMock.budgetForecastEntry.upsert.mockReset().mockResolvedValue({})
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
})

describe("POST /api/budgeting/rolling/auto-forecast — period lock (Turn LXIX)", () => {
  it("returns 423 when forecast month's container is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026-Q3", lockedAt: "x", lockedBy: "y" }],
    })
    const res = await POST(makeRequest("/api/budgeting/rolling/auto-forecast", { method: "POST", json: validBody }))
    expect(res.status).toBe(423)
    expect(prismaMock.budgetForecastEntry.upsert).not.toHaveBeenCalled()
  })

  it("returns 200 happy path when no lock", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(makeRequest("/api/budgeting/rolling/auto-forecast", { method: "POST", json: validBody }))
    expect(res.status).toBe(200)
  })
})
