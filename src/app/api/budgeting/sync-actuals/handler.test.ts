// @vitest-environment node
/**
 * Phase 7.G Turn LXIX — handler tests for `/api/budgeting/sync-actuals` POST.
 * Locks Phase 4.2 period-lock gate. sync-actuals writes to the CURRENT
 * Baku month — gate must check both plan period + current month containers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn() },
    budgetLine: { findMany: vi.fn() },
    budgetActual: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))
vi.mock("@/lib/cost-model/db", () => ({
  loadAndCompute: vi.fn().mockResolvedValue({}),
}))
vi.mock("@/lib/budgeting/cost-model-map", () => ({
  resolveCostModelKey: vi.fn().mockReturnValue(0),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"
const validBody = { planId: "p1" }

beforeEach(() => {
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({
    id: "p1",
    organizationId: ORG_ID,
    periodType: "annual",
    year: 2026,
    month: null,
    quarter: null,
  })
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetActual.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.budgetActual.create.mockReset()
  prismaMock.budgetActual.update.mockReset()
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
})

describe("POST /api/budgeting/sync-actuals — period lock (Turn LXIX)", () => {
  it("returns 423 when plan period is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetLine.findMany.mockResolvedValue([
      { id: "ln1", category: "Sales", lineType: "expense", costModelKey: "x", department: null },
    ])
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedAt: "x", lockedBy: "y" }],
    })
    const res = await POST(makeRequest("/api/budgeting/sync-actuals", { method: "POST", json: validBody }))
    expect(res.status).toBe(423)
    expect(prismaMock.budgetActual.create).not.toHaveBeenCalled()
    expect(prismaMock.budgetActual.update).not.toHaveBeenCalled()
  })

  it("happy path returns 200 (no lines → synced=0)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(makeRequest("/api/budgeting/sync-actuals", { method: "POST", json: validBody }))
    expect(res.status).toBe(200)
  })
})
