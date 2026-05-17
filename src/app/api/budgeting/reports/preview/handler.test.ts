// @vitest-environment node
/**
 * Handler test for `/api/budgeting/reports/preview` (POST + GET).
 *
 * Report-builder runtime endpoint. Locks input normalization (entity vs
 * entityType), entity-allowlist, limit cap, and report-engine
 * delegation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

const { executeBudgetReportMock } = vi.hoisted(() => ({
  executeBudgetReportMock: vi.fn(),
}))
vi.mock("@/lib/budgeting/report-engine", async () => {
  const actual = await vi.importActual<typeof import("@/lib/budgeting/report-engine")>(
    "@/lib/budgeting/report-engine",
  )
  return {
    ...actual,
    executeBudgetReport: executeBudgetReportMock,
  }
})

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  executeBudgetReportMock.mockReset().mockResolvedValue({
    type: "flat",
    data: [],
    total: 0,
  })
})

describe("GET /api/budgeting/reports/preview", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/reports/preview"))
    expect(res.status).toBe(401)
  })

  it("200 with entity catalog + flattened fields", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/reports/preview"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    // Each entry has key/label/fields/hasPlanId
    const sample = body.data[0]
    expect(sample).toHaveProperty("key")
    expect(sample).toHaveProperty("fields")
    expect(Array.isArray(sample.fields)).toBe(true)
  })
})

describe("POST /api/budgeting/reports/preview", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/reports/preview", {
        method: "POST",
        json: { entityType: "budgetLines" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 missing entityType (neither entity nor entityType)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/reports/preview", {
        method: "POST",
        json: { columns: [] },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("accepts `entity` as alias of `entityType` (normalization)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/reports/preview", {
        method: "POST",
        json: { entity: "budgetLines", columns: [{ field: "category" }] },
      }),
    )
    expect(res.status).toBe(200)
    expect(executeBudgetReportMock).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ entityType: "budgetLines" }),
    )
  })

  it("400 unknown entity returns 400 + lists available", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/reports/preview", {
        method: "POST",
        json: { entityType: "fakeEntity" },
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(Array.isArray(body.available)).toBe(true)
  })

  it("auto-fills columns from entity fields when none specified", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    await POST(
      makeRequest("/api/budgeting/reports/preview", {
        method: "POST",
        json: { entityType: "budgetLines" }, // no columns
      }),
    )
    const call = executeBudgetReportMock.mock.calls[0][1]
    expect(call.columns.length).toBeGreaterThan(0)
  })

  it("limit caps at 10000", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    await POST(
      makeRequest("/api/budgeting/reports/preview", {
        method: "POST",
        json: { entityType: "budgetLines", limit: 999999 },
      }),
    )
    const call = executeBudgetReportMock.mock.calls[0][1]
    expect(call.limit).toBe(10000)
  })

  it("500 on report execution error", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    executeBudgetReportMock.mockRejectedValue(new Error("DB connection refused"))
    const res = await POST(
      makeRequest("/api/budgeting/reports/preview", {
        method: "POST",
        json: { entityType: "budgetLines" },
      }),
    )
    expect(res.status).toBe(500)
  })
})
