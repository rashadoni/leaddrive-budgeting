// @vitest-environment node
/**
 * Handler test for `/api/budgeting/reports/export` (POST).
 *
 * Locks CSV + xlsx export with entityType alias, format validation,
 * no-data 404, and the executeBudgetReport delegation envelope.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { executeBudgetReportMock, getEntityFieldsMock } = vi.hoisted(() => ({
  executeBudgetReportMock: vi.fn(),
  getEntityFieldsMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/budgeting/report-engine", async () => {
  // Partial mock: the route now also validates the entity against the real
  // catalog and maps `ReportConfigError` to 400, so those two have to be the
  // genuine articles or the test stops exercising the route it claims to.
  const actual = await vi.importActual<typeof import("@/lib/budgeting/report-engine")>(
    "@/lib/budgeting/report-engine",
  )
  return {
    ...actual,
    executeBudgetReport: executeBudgetReportMock,
    getEntityFields: getEntityFieldsMock,
  }
})

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  executeBudgetReportMock.mockReset().mockResolvedValue({ data: [], total: 0 })
  getEntityFieldsMock.mockReset().mockReturnValue([
    { name: "category", label: "Category", type: "string" },
    { name: "plannedAmount", label: "Planned", type: "number" },
  ])
})

describe("POST /api/budgeting/reports/export", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/reports/export", {
        method: "POST",
        json: { entityType: "budgetLines" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 invalid JSON body", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const req = new Request("http://localhost/api/budgeting/reports/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
  })

  it("400 unknown format", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/reports/export", {
        method: "POST",
        json: { format: "pdf", entityType: "budgetLines" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 missing entityType / entity", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/reports/export", {
        method: "POST",
        json: { format: "csv" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("404 when no rows to export", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    executeBudgetReportMock.mockResolvedValue({ data: [], total: 0 })
    const res = await POST(
      makeRequest("/api/budgeting/reports/export", {
        method: "POST",
        json: { format: "csv", entityType: "budgetLines" },
      }),
    )
    expect(res.status).toBe(404)
  })

  it("200 CSV — accepts 'entity' alias for entityType", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    executeBudgetReportMock.mockResolvedValue({
      data: [{ category: "Salaries", plannedAmount: 1000 }],
      total: 1,
    })
    const res = await POST(
      makeRequest("/api/budgeting/reports/export", {
        method: "POST",
        json: { format: "csv", entity: "budgetLines" },
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("text/csv")
    expect(res.headers.get("Content-Disposition") || "").toContain("budgetLines_report.csv")
    const text = await res.text()
    expect(text).toContain("Salaries")
  })

  it("200 XLSX content-type + non-empty buffer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    executeBudgetReportMock.mockResolvedValue({
      data: [{ category: "Wages", plannedAmount: 5000 }],
      total: 1,
    })
    const res = await POST(
      makeRequest("/api/budgeting/reports/export", {
        method: "POST",
        json: { format: "xlsx", entityType: "budgetLines" },
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml")
    const buf = await res.arrayBuffer()
    expect(buf.byteLength).toBeGreaterThan(1000)
  })

  it("exportLimit caps at 10000", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    executeBudgetReportMock.mockResolvedValue({ data: [{ category: "x" }], total: 1 })
    await POST(
      makeRequest("/api/budgeting/reports/export", {
        method: "POST",
        json: { format: "csv", entityType: "budgetLines", exportLimit: 999999 },
      }),
    )
    expect(executeBudgetReportMock.mock.calls[0][1].limit).toBe(10000)
  })

  it("ignores the preview page size the client sends as `limit`", async () => {
    // The page spreads its preview config into the export request, so `limit`
    // arrived as 100 and every export was truncated to a page of the screen.
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    executeBudgetReportMock.mockResolvedValue({ data: [{ category: "x" }], total: 1 })
    await POST(
      makeRequest("/api/budgeting/reports/export", {
        method: "POST",
        json: { format: "csv", entityType: "budgetLines", limit: 100 },
      }),
    )
    expect(executeBudgetReportMock.mock.calls[0][1].limit).toBe(10000)
  })

  it("500 on report engine error", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    executeBudgetReportMock.mockRejectedValue(new Error("DB refused"))
    const res = await POST(
      makeRequest("/api/budgeting/reports/export", {
        method: "POST",
        json: { format: "csv", entityType: "budgetLines" },
      }),
    )
    expect(res.status).toBe(500)
  })
})
