// @vitest-environment node
/**
 * Handler test for `/api/budgeting/plans/[id]/purge` (DELETE).
 *
 * Locks the destruction safety envelope:
 * - admin-only (same as soft-delete bar)
 * - refuses to purge a LIVE plan (not soft-deleted)
 * - period-lock gate (cannot purge actuals from a closed period)
 * - 12-table $transaction cascade
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn(), delete: vi.fn() },
    budgetForecastEntry: { deleteMany: vi.fn() },
    rollingForecastMonth: { deleteMany: vi.fn() },
    budgetActual: { deleteMany: vi.fn() },
    budgetLine: { deleteMany: vi.fn() },
    salesBudgetLine: { deleteMany: vi.fn() },
    cOGSBudgetLine: { deleteMany: vi.fn() },
    cOGSCostDetail: { deleteMany: vi.fn() },
    balanceSheetLine: { deleteMany: vi.fn() },
    budgetAssumption: { deleteMany: vi.fn() },
    budgetApprovalComment: { deleteMany: vi.fn() },
    savedBudgetReport: { deleteMany: vi.fn() },
    budgetChangeLog: { deleteMany: vi.fn() },
    organization: { findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { DELETE } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({
    id: "p1",
    periodType: "annual",
    year: 2026,
    month: null,
    quarter: null,
  })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
  prismaMock.$transaction.mockReset().mockResolvedValue([])
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
})

describe("DELETE /api/budgeting/plans/[id]/purge", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await DELETE(
      makeRequest("/api/budgeting/plans/p1/purge", { method: "DELETE" }),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(401)
  })

  it("403 below admin (manager rejected — same bar as soft-delete)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await DELETE(
      makeRequest("/api/budgeting/plans/p1/purge", { method: "DELETE" }),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(403)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it("404 plan not found OR not soft-deleted (live plans refused)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null)
    const res = await DELETE(
      makeRequest("/api/budgeting/plans/p1/purge", { method: "DELETE" }),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(404)
    // No destructive call fired
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it("plan lookup filters deletedAt: not null (refuse live plans)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    await DELETE(
      makeRequest("/api/budgeting/plans/p1/purge", { method: "DELETE" }),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(prismaMock.budgetPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "p1",
          organizationId: ORG_ID,
          deletedAt: { not: null },
        },
      }),
    )
  })

  it("200 happy path runs the cascade deletes sequentially in the scope tx", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    const res = await DELETE(
      makeRequest("/api/budgeting/plans/p1/purge", { method: "DELETE" }),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(200)
    // Stage 3 RLS — the former $transaction([array]) is now a sequential
    // deleteMany chain inside withOrgScope, ending with the plan delete.
    expect(prismaMock.budgetForecastEntry.deleteMany).toHaveBeenCalledWith({ where: { planId: "p1" } })
    expect(prismaMock.budgetLine.deleteMany).toHaveBeenCalledWith({ where: { planId: "p1" } })
    expect(prismaMock.budgetChangeLog.deleteMany).toHaveBeenCalledWith({ where: { planId: "p1" } })
    expect(prismaMock.budgetPlan.delete).toHaveBeenCalledWith({ where: { id: "p1" } })
  })
})
