// @vitest-environment node
/**
 * Handler test for `/api/budgeting/sales-budget` (GET + POST).
 *
 * Same shape as balance-sheet (24353cc) — period-lock gate + cross-
 * tenant plan guard + single/array variants. Sales-budget POST uses
 * `upsert` (composite key: planId+productLine+year+month) so bulk
 * variants are idempotent.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    salesBudgetLine: {
      findMany: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
    budgetPlan: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.salesBudgetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.salesBudgetLine.create.mockReset().mockResolvedValue({ id: "sb1" })
  prismaMock.salesBudgetLine.upsert.mockReset().mockResolvedValue({ id: "sb1" })
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({
    id: "p1",
    periodType: "annual",
    year: 2026,
    month: null,
    quarter: null,
  })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
})

describe("GET /api/budgeting/sales-budget", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/sales-budget?planId=p1"))
    expect(res.status).toBe(401)
  })

  it("400 missing planId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/sales-budget"))
    expect(res.status).toBe(400)
  })

  it("200 org-scoped + productLine include + ordered by sortOrder+month", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.salesBudgetLine.findMany.mockResolvedValue([
      { id: "1", month: 1, productLine: { name: "A", sortOrder: 1 } },
    ])
    const res = await GET(makeRequest("/api/budgeting/sales-budget?planId=p1"))
    expect(res.status).toBe(200)
    expect(prismaMock.salesBudgetLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, planId: "p1" },
        include: { productLine: true },
        orderBy: expect.arrayContaining([
          { productLine: { sortOrder: "asc" } },
          { month: "asc" },
        ]),
      }),
    )
  })
})

describe("POST /api/budgeting/sales-budget", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/sales-budget", {
        method: "POST",
        json: { planId: "p1", productLineId: "pl1", year: 2026, month: 1 },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 missing planId in body", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/sales-budget", {
        method: "POST",
        json: { productLineId: "pl1", year: 2026, month: 1 },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 array with mixed planIds", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/sales-budget", {
        method: "POST",
        json: [
          { planId: "p1", productLineId: "pl1", year: 2026, month: 1 },
          { planId: "p2", productLineId: "pl1", year: 2026, month: 1 },
        ],
      }),
    )
    expect(res.status).toBe(400)
  })

  it("404 cross-tenant plan id", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null)
    const res = await POST(
      makeRequest("/api/budgeting/sales-budget", {
        method: "POST",
        json: { planId: "p-other", productLineId: "pl1", year: 2026, month: 1 },
      }),
    )
    expect(res.status).toBe(404)
  })

  it("201 single line happy path", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/sales-budget", {
        method: "POST",
        json: {
          planId: "p1",
          productLineId: "pl1",
          year: 2026,
          month: 1,
          quantity: 100,
          unitPrice: 10,
          amount: 1000,
        },
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.salesBudgetLine.create).toHaveBeenCalled()
  })

  it("201 array → upsert per row (composite key idempotent)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/sales-budget", {
        method: "POST",
        json: [
          { planId: "p1", productLineId: "pl1", year: 2026, month: 1, quantity: 100, unitPrice: 10, amount: 1000 },
          { planId: "p1", productLineId: "pl1", year: 2026, month: 2, quantity: 110, unitPrice: 10, amount: 1100 },
        ],
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.salesBudgetLine.upsert).toHaveBeenCalledTimes(2)
  })
})
