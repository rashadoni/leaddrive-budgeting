// @vitest-environment node
/**
 * Phase 7.G Turn LXIX — handler tests for `/api/budgeting/rolling` POST + PATCH.
 * Locks Phase 4.2 period-lock gate. POST creates 12 monthly entries —
 * gate must check ALL 12 months' containers. PATCH operates on a
 * specific year/month — gate checks just those containers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    budgetLine: { findMany: vi.fn(), create: vi.fn() },
    budgetForecastEntry: { createMany: vi.fn(), deleteMany: vi.fn() },
    rollingForecastMonth: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    organization: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))
vi.mock("@/lib/cost-model/db", () => ({
  loadAndCompute: vi.fn().mockResolvedValue({ serviceRevenues: {}, serviceDetails: {} }),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST, PATCH } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({
    id: "p1",
    organizationId: ORG_ID,
    isRolling: true,
    periodType: "monthly",
    year: 2026,
    month: 1,
  })
  prismaMock.budgetPlan.create.mockReset().mockResolvedValue({ id: "p_new" })
  prismaMock.budgetPlan.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetLine.create.mockReset().mockResolvedValue({ id: "ln1" })
  prismaMock.budgetForecastEntry.createMany.mockReset().mockResolvedValue({ count: 0 })
  prismaMock.budgetForecastEntry.deleteMany.mockReset()
  prismaMock.rollingForecastMonth.createMany.mockReset().mockResolvedValue({ count: 0 })
  prismaMock.rollingForecastMonth.findMany.mockReset().mockResolvedValue([
    { year: 2026, month: 1, status: "forecast" },
    { year: 2026, month: 2, status: "forecast" },
  ])
  prismaMock.rollingForecastMonth.findUnique.mockReset().mockResolvedValue(null)
  prismaMock.rollingForecastMonth.create.mockReset()
  prismaMock.rollingForecastMonth.delete.mockReset()
  prismaMock.rollingForecastMonth.update.mockReset().mockResolvedValue({ year: 2026, month: 1, status: "actual" })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
})

describe("POST /api/budgeting/rolling — period lock (Turn LXIX)", () => {
  it("returns 403 below manager before creating financial state", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/rolling", {
        method: "POST",
        json: { name: "Rolling FY26", startYear: 2026, startMonth: 1 },
      }),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.budgetPlan.create).not.toHaveBeenCalled()
  })

  it("returns 423 when ANY of the 12 target months falls in a locked container", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    // Lock 2026-Q2; rolling plan starts Jan 2026 → covers Q1+Q2+Q3+Q4 → Q2 hit
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026-Q2", lockedAt: "x", lockedBy: "y" }],
    })
    const res = await POST(
      makeRequest("/api/budgeting/rolling", {
        method: "POST",
        json: { name: "Rolling FY26", startYear: 2026, startMonth: 1 },
      }),
    )
    expect(res.status).toBe(423)
    expect(prismaMock.budgetPlan.create).not.toHaveBeenCalled()
  })

  it("returns 201 happy path when all 12 months clear", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/budgeting/rolling", {
        method: "POST",
        json: { name: "Rolling FY26", startYear: 2026, startMonth: 1 },
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.budgetPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "budget" }) }),
    )
  })
})

describe("PATCH /api/budgeting/rolling — period lock (Turn LXIX)", () => {
  it("returns 423 when target month's container is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026-Q1", lockedAt: "x", lockedBy: "y" }],
    })
    const res = await PATCH(
      makeRequest("/api/budgeting/rolling", {
        method: "PATCH",
        json: { planId: "p1", year: 2026, month: 2, action: "close" },
      }),
    )
    expect(res.status).toBe(423)
    expect(prismaMock.rollingForecastMonth.update).not.toHaveBeenCalled()
  })
})
