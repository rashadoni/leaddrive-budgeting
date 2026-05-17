// @vitest-environment node
/**
 * Handler test for `/api/budgeting/csv-template` (GET).
 *
 * Locks the CSV template generation including:
 * - auth + planId required
 * - cross-tenant plan guard
 * - CSV formula-injection prevention (leading =, +, -, @, \t, \r)
 * - Content-Disposition attachment with sanitized filename
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn() },
    budgetLine: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({ name: "FY2026" })
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([])
})

describe("GET /api/budgeting/csv-template", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/csv-template?planId=p1"))
    expect(res.status).toBe(401)
  })

  it("400 missing planId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/csv-template"))
    expect(res.status).toBe(400)
  })

  it("404 cross-tenant planId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null)
    const res = await GET(makeRequest("/api/budgeting/csv-template?planId=p-other"))
    expect(res.status).toBe(404)
  })

  it("200 with CSV content-type + attachment header", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/csv-template?planId=p1"))
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("text/csv")
    expect(res.headers.get("Content-Disposition")).toContain("attachment")
    expect(res.headers.get("Content-Disposition")).toContain("FY2026")
  })

  it("CSV header has 6 columns: category,department,amount,date,description,lineType", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/csv-template?planId=p1"))
    const text = await res.text()
    const header = text.split("\n")[0]
    expect(header).toBe("category,department,amount,date,description,lineType")
  })

  it("CSV formula-injection guard: leading = gets prefixed with apostrophe", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetLine.findMany.mockResolvedValue([
      { category: "=SUM(A1)", department: null, lineType: "expense" },
    ])
    const res = await GET(makeRequest("/api/budgeting/csv-template?planId=p1"))
    const text = await res.text()
    // Row should be prefixed with apostrophe to defuse the formula
    expect(text).toContain("'=SUM(A1)")
  })

  it("CSV quoting: commas in category get wrapped in double-quotes", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetLine.findMany.mockResolvedValue([
      { category: "Rent, Office", department: null, lineType: "expense" },
    ])
    const res = await GET(makeRequest("/api/budgeting/csv-template?planId=p1"))
    const text = await res.text()
    expect(text).toContain('"Rent, Office"')
  })

  it("filename sanitizes non-alphanumerics (spaces + parens replaced)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({ name: "FY 2026 (Imported)" })
    const res = await GET(makeRequest("/api/budgeting/csv-template?planId=p1"))
    const disp = res.headers.get("Content-Disposition") ?? ""
    // Extract just the filename="..." part — the leading "attachment; "
    // is part of Content-Disposition spec syntax (space is allowed there).
    const fileMatch = disp.match(/filename="([^"]+)"/)
    expect(fileMatch).toBeTruthy()
    const filename = fileMatch![1]
    expect(filename).toContain("FY_2026__Imported_")
    expect(filename).not.toContain(" ")
    expect(filename).not.toContain("(")
    expect(filename).not.toContain(")")
  })
})
