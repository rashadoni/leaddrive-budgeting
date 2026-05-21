// @vitest-environment node
/**
 * Phase 7.G Turn LXIX — handler tests for `/api/budgeting/import-csv` POST.
 * Locks Phase 4.2 period-lock gate on bulk-CSV-import path.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn() },
    budgetActual: { create: vi.fn() },
    accountingImport: { create: vi.fn(), updateMany: vi.fn() },
    accountingIntegration: { findFirst: vi.fn(), updateMany: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
  logBudgetChange: vi.fn(),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"
const validBody = {
  planId: "p1",
  rows: [{ category: "Sales", amount: "100" }],
}

beforeEach(() => {
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({
    id: "p1",
    periodType: "annual",
    year: 2026,
    month: null,
    quarter: null,
  })
  prismaMock.budgetActual.create.mockReset().mockResolvedValue({ id: "a1" })
  prismaMock.accountingImport.create.mockReset().mockResolvedValue({ id: "imp1" })
  prismaMock.accountingImport.updateMany.mockReset().mockResolvedValue({ count: 1 })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
})

describe("POST /api/budgeting/import-csv — period lock (Turn LXIX)", () => {
  it("returns 423 when plan period is locked + does NOT create actuals or import record", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedAt: "x", lockedBy: "y", reason: "FY26" }],
    })
    const res = await POST(makeRequest("/api/budgeting/import-csv", { method: "POST", json: validBody }))
    expect(res.status).toBe(423)
    expect(prismaMock.budgetActual.create).not.toHaveBeenCalled()
    expect(prismaMock.accountingImport.create).not.toHaveBeenCalled()
  })

  it("returns 200 happy path when no lock", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(makeRequest("/api/budgeting/import-csv", { method: "POST", json: validBody }))
    expect(res.status).toBe(200)
    expect(prismaMock.budgetActual.create).toHaveBeenCalledTimes(1)
  })

  it("stamps Deprecation / Sunset / Link headers on 200 response", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(makeRequest("/api/budgeting/import-csv", { method: "POST", json: validBody }))
    expect(res.status).toBe(200)
    expect(res.headers.get("Deprecation")).toBe("true")
    expect(res.headers.get("Sunset")).toBe("Thu, 21 May 2026 00:00:00 GMT")
    expect(res.headers.get("Link")).toContain("successor-version")
    expect(res.headers.get("X-Replaced-By")).toBe("/api/import/ai-auto-multi")
  })
})
