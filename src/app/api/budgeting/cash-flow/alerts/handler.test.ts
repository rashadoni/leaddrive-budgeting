// @vitest-environment node
/**
 * Handler test for `/api/budgeting/cash-flow/alerts` (GET + POST).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    cashFlowAlert: { findMany: vi.fn(), updateMany: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.cashFlowAlert.findMany.mockReset().mockResolvedValue([])
  prismaMock.cashFlowAlert.updateMany.mockReset().mockResolvedValue({ count: 1 })
})

describe("GET /api/budgeting/cash-flow/alerts", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/cash-flow/alerts"))
    expect(res.status).toBe(401)
  })

  it("200 with org-scoped + isResolved=false filter (default current year)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/cash-flow/alerts"))
    expect(prismaMock.cashFlowAlert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG_ID,
          isResolved: false,
        }),
      }),
    )
  })

  it("respects ?year=2025 query parameter", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/cash-flow/alerts?year=2025"))
    expect(prismaMock.cashFlowAlert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ year: 2025 }),
      }),
    )
  })
})

describe("POST /api/budgeting/cash-flow/alerts", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow/alerts", {
        method: "POST",
        json: { alertId: "a1" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 missing alertId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow/alerts", {
        method: "POST",
        json: {},
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 strict zod: extra fields rejected", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow/alerts", {
        method: "POST",
        json: { alertId: "a1", extra: "bonus" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("200 marks alert resolved + org-scoped (cross-tenant safe)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow/alerts", {
        method: "POST",
        json: { alertId: "a1" },
      }),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.cashFlowAlert.updateMany).toHaveBeenCalledWith({
      where: { id: "a1", organizationId: ORG_ID },
      data: { isResolved: true },
    })
  })
})
