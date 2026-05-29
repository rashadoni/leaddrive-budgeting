// @vitest-environment node
/**
 * Handler test for `/api/budgeting/matrix-seed` (POST).
 *
 * Auto-generates BudgetLines via costTypes × departments cartesian
 * matrix + OpEx expense groups. Locks plan cross-tenant 404,
 * strict-zod, "no costTypes/departments" 400, and the $transaction
 * line-creation envelope.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, resolvePatternForDeptMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn() },
    budgetCostType: { findMany: vi.fn() },
    budgetDepartment: { findMany: vi.fn() },
    budgetLine: { create: vi.fn() },
    chartOfAccount: { upsert: vi.fn() },
    organization: { findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  resolvePatternForDeptMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/budgeting/cost-model-map", () => ({
  resolvePatternForDept: resolvePatternForDeptMock,
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.budgetCostType.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetDepartment.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetLine.create.mockReset().mockResolvedValue({ id: "bl1" })
  // resolveOrCreateAccountId (real, not mocked) upserts the CoA FK inside
  // the tx; the mock returns a stable id so accountId is populated.
  prismaMock.chartOfAccount.upsert.mockReset().mockResolvedValue({ id: "acc_x" })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
  resolvePatternForDeptMock.mockReset().mockReturnValue("deptCosts.X")
  // Default $transaction implementation: run the callback with a tx that
  // delegates back to prismaMock. Includes chartOfAccount.upsert because
  // line creation now resolves a NOT-NULL accountId FK inside the tx.
  prismaMock.$transaction.mockReset().mockImplementation(async (fn: any) => {
    return fn({
      budgetLine: { create: prismaMock.budgetLine.create },
      chartOfAccount: { upsert: prismaMock.chartOfAccount.upsert },
    })
  })
})

describe("POST /api/budgeting/matrix-seed", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/matrix-seed", {
        method: "POST",
        json: { planId: "p1" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 strict-zod rejects extra field", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/matrix-seed", {
        method: "POST",
        json: { planId: "p1", organizationId: "evil" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 missing planId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/matrix-seed", {
        method: "POST",
        json: {},
      }),
    )
    expect(res.status).toBe(400)
  })

  it("404 plan not in caller's org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null)
    const res = await POST(
      makeRequest("/api/budgeting/matrix-seed", {
        method: "POST",
        json: { planId: "p1" },
      }),
    )
    expect(res.status).toBe(404)
  })

  it("400 errorKey=matrixNoCostTypes when no costTypes seeded", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({ id: "p1", year: 2026 })
    prismaMock.budgetCostType.findMany.mockResolvedValue([])
    prismaMock.budgetDepartment.findMany.mockResolvedValue([{ id: "d1" }])
    const res = await POST(
      makeRequest("/api/budgeting/matrix-seed", {
        method: "POST",
        json: { planId: "p1" },
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errorKey).toBe("matrixNoCostTypes")
  })

  it("400 errorKey=matrixNoDepartments when no departments seeded", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({ id: "p1", year: 2026 })
    prismaMock.budgetCostType.findMany.mockResolvedValue([{ id: "ct1", isShared: true }])
    prismaMock.budgetDepartment.findMany.mockResolvedValue([])
    const res = await POST(
      makeRequest("/api/budgeting/matrix-seed", {
        method: "POST",
        json: { planId: "p1" },
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errorKey).toBe("matrixNoDepartments")
  })

  it("201 happy path — shared costType creates 1 cogs line, non-shared cross dept", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({ id: "p1", year: 2026 })
    prismaMock.budgetCostType.findMany.mockResolvedValue([
      { id: "ct_shared", label: "Shared", isShared: true, costModelPattern: null },
      { id: "ct_dept",   label: "DeptCT", isShared: false, costModelPattern: "deptCosts.{dept}" },
    ])
    prismaMock.budgetDepartment.findMany.mockResolvedValue([
      { id: "d1", label: "IT", serviceKey: "IT", hasRevenue: false },
      { id: "d2", label: "InfoSec", serviceKey: "InfoSec", hasRevenue: false },
    ])
    const res = await POST(
      makeRequest("/api/budgeting/matrix-seed", {
        method: "POST",
        json: { planId: "p1", includeRevenue: false, includeExpenses: false },
      }),
    )
    expect(res.status).toBe(201)
    // 1 (shared) + 2 (deptCT × 2 depts) = 3 cogs lines
    expect(prismaMock.budgetLine.create).toHaveBeenCalledTimes(3)

    // Phase 2.1 schema-drift regression guard: every created line must
    // carry the NOT-NULL `accountId` FK and must NOT carry the dropped
    // `category` column (Prisma would 500 on either drift at runtime).
    for (const call of prismaMock.budgetLine.create.mock.calls) {
      const { data } = call[0] as { data: Record<string, unknown> }
      expect(data.accountId).toBe("acc_x")
      expect(data).not.toHaveProperty("category")
    }
  })
})
