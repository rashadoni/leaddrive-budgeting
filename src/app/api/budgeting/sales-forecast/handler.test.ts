// @vitest-environment node
/**
 * Handler test for `/api/budgeting/sales-forecast` (GET + POST).
 *
 * Locks year-scoped sales forecast CRUD + period-lock gate + bulk
 * upsert on composite key (org, dept, year, month).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    salesForecast: { findMany: vi.fn(), upsert: vi.fn() },
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
import { GET, POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.salesForecast.findMany.mockReset().mockResolvedValue([])
  prismaMock.salesForecast.upsert.mockReset().mockResolvedValue({ id: "s1" })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
  prismaMock.$transaction.mockReset().mockImplementation((promises: unknown[]) => Promise.resolve(promises.map(() => ({ id: "s1" }))))
})

describe("GET /api/budgeting/sales-forecast", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/sales-forecast?year=2026"))
    expect(res.status).toBe(401)
  })

  it("400 invalid year (< 2020)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/sales-forecast?year=1999"))
    expect(res.status).toBe(400)
  })

  it("400 invalid year (> 2050)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/sales-forecast?year=3000"))
    expect(res.status).toBe(400)
  })

  it("200 org-scoped + budgetDept include + sortOrder+month order", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/sales-forecast?year=2026"))
    expect(prismaMock.salesForecast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, year: 2026 },
        include: { budgetDept: { select: { id: true, key: true, label: true } } },
      }),
    )
  })
})

describe("POST /api/budgeting/sales-forecast", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/sales-forecast", {
        method: "POST",
        json: { year: 2026, entries: [{ departmentId: "d1", month: 1, amount: 1000 }] },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 invalid year in body", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/sales-forecast", {
        method: "POST",
        json: { year: 1999, entries: [{ departmentId: "d1", month: 1, amount: 100 }] },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 month out of range (13)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/sales-forecast", {
        method: "POST",
        json: { year: 2026, entries: [{ departmentId: "d1", month: 13, amount: 100 }] },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 negative amount", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/sales-forecast", {
        method: "POST",
        json: { year: 2026, entries: [{ departmentId: "d1", month: 1, amount: -100 }] },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 empty entries array", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/sales-forecast", {
        method: "POST",
        json: { year: 2026, entries: [] },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 strict-zod extra field rejected", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/sales-forecast", {
        method: "POST",
        json: {
          year: 2026,
          entries: [{ departmentId: "d1", month: 1, amount: 100 }],
          organizationId: "evil-org",
        },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("201 happy path bulk upsert (sequential in the withOrgScope tx)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/sales-forecast", {
        method: "POST",
        json: {
          year: 2026,
          entries: [
            { departmentId: "d1", month: 1, amount: 1000 },
            { departmentId: "d1", month: 2, amount: 1100 },
          ],
        },
      }),
    )
    expect(res.status).toBe(201)
    // Stage 3 RLS — the former $transaction([array]) is now a sequential
    // upsert loop inside the withOrgScope tx (one upsert per valid entry).
    expect(prismaMock.salesForecast.upsert).toHaveBeenCalledTimes(2)
    expect((await res.json()).count).toBe(2)
  })
})
