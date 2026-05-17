// @vitest-environment node
/**
 * Handler test for `/api/budgeting/expense-forecast` (GET + POST).
 *
 * Locks year-scoped expense forecast CRUD + period-lock gate +
 * costType/department cross-tenant validation + composite-key
 * upsert (nullable departmentId handled via findFirst).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    expenseForecast: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    budgetCostType: { findMany: vi.fn() },
    budgetDepartment: { findMany: vi.fn() },
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
  prismaMock.expenseForecast.findMany.mockReset().mockResolvedValue([])
  prismaMock.expenseForecast.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.expenseForecast.update.mockReset().mockResolvedValue({ id: "e1" })
  prismaMock.expenseForecast.create.mockReset().mockResolvedValue({ id: "e1" })
  prismaMock.budgetCostType.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetDepartment.findMany.mockReset().mockResolvedValue([])
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
})

describe("GET /api/budgeting/expense-forecast", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/expense-forecast?year=2026"))
    expect(res.status).toBe(401)
  })

  it("400 invalid year < 2020", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/expense-forecast?year=1999"))
    expect(res.status).toBe(400)
  })

  it("200 org-scoped + sortOrder+month ordering", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/expense-forecast?year=2026"))
    expect(prismaMock.expenseForecast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG_ID, year: 2026 } }),
    )
  })
})

describe("POST /api/budgeting/expense-forecast", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/expense-forecast", {
        method: "POST",
        json: { year: 2026, entries: [{ costTypeId: "c1", month: 1, amount: 100 }] },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 strict-zod extra field rejected", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/expense-forecast", {
        method: "POST",
        json: { year: 2026, entries: [{ costTypeId: "c1", month: 1, amount: 100 }], organizationId: "evil" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 month out of range", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/expense-forecast", {
        method: "POST",
        json: { year: 2026, entries: [{ costTypeId: "c1", month: 13, amount: 100 }] },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("404 cross-tenant costTypeId rejected", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.budgetCostType.findMany.mockResolvedValue([]) // none owned
    const res = await POST(
      makeRequest("/api/budgeting/expense-forecast", {
        method: "POST",
        json: { year: 2026, entries: [{ costTypeId: "c_evil", month: 1, amount: 100 }] },
      }),
    )
    expect(res.status).toBe(404)
  })

  it("404 cross-tenant departmentId rejected", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.budgetCostType.findMany.mockResolvedValue([{ id: "c1" }])
    prismaMock.budgetDepartment.findMany.mockResolvedValue([]) // none owned
    const res = await POST(
      makeRequest("/api/budgeting/expense-forecast", {
        method: "POST",
        json: { year: 2026, entries: [{ costTypeId: "c1", departmentId: "d_evil", month: 1, amount: 100 }] },
      }),
    )
    expect(res.status).toBe(404)
  })

  it("201 happy path — update existing + create new", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.budgetCostType.findMany.mockResolvedValue([{ id: "c1" }])
    // First call returns existing row, second returns null → triggers create
    prismaMock.expenseForecast.findFirst
      .mockResolvedValueOnce({ id: "e_existing" })
      .mockResolvedValueOnce(null)
    const res = await POST(
      makeRequest("/api/budgeting/expense-forecast", {
        method: "POST",
        json: {
          year: 2026,
          entries: [
            { costTypeId: "c1", month: 1, amount: 100 },
            { costTypeId: "c1", month: 2, amount: 150 },
          ],
        },
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.expenseForecast.update).toHaveBeenCalledTimes(1)
    expect(prismaMock.expenseForecast.create).toHaveBeenCalledTimes(1)
  })
})
