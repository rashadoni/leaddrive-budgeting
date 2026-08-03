// @vitest-environment node
/**
 * Handler test for `/api/budgeting/export` (GET).
 *
 * Full-plan xlsx export. Locks auth, missing planId 400, cross-tenant
 * 404, content-type + xlsx body non-empty.
 *
 * Note: deep formatting + section semantics are exercised in the
 * Phase 7.G visual smoke; here we lock the API contract surface.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, loadAndComputeMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn() },
    budgetLine: { findMany: vi.fn() },
    budgetActual: { findMany: vi.fn() },
    budgetForecastEntry: { findMany: vi.fn() },
  },
  loadAndComputeMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))
vi.mock("@/lib/cost-model/db", () => ({
  loadAndCompute: loadAndComputeMock,
}))

import ExcelJS from "exceljs"
import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetActual.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetForecastEntry.findMany.mockReset().mockResolvedValue([])
  loadAndComputeMock.mockReset().mockResolvedValue(null)
})

describe("GET /api/budgeting/export", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/export?planId=p1"))
    expect(res.status).toBe(401)
  })

  it("400 missing planId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/export"))
    expect(res.status).toBe(400)
  })

  it("404 cross-tenant plan", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null)
    const res = await GET(makeRequest("/api/budgeting/export?planId=p_evil"))
    expect(res.status).toBe(404)
  })

  it("200 xlsx content-type + non-empty body", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({
      id: "p1", name: "Plan A", year: 2026, periodType: "annual", quarter: null, month: null,
      organizationId: ORG_ID,
    })
    prismaMock.budgetLine.findMany.mockResolvedValue([
      { id: "L1", category: "Salaries", lineType: "expense", plannedAmount: 1000, forecastAmount: null, sortOrder: 0 },
      { id: "L2", category: "Revenue1", lineType: "revenue", plannedAmount: 5000, forecastAmount: null, sortOrder: 1 },
    ])
    const res = await GET(makeRequest("/api/budgeting/export?planId=p1"))
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml")
    const buf = await res.arrayBuffer()
    expect(buf.byteLength).toBeGreaterThan(1000)
  })

  /**
   * Phase 14.5 — the file leaves the company, so it has to say what is in it.
   *
   * Reads the produced workbook back with ExcelJS rather than asserting on the
   * code that wrote it: the whole point of this feature is what a recipient
   * opens, and a test of the writer would pass just as happily if the cell
   * were written to a sheet nobody looks at.
   */
  async function exportAndRead(lines: unknown[]) {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({
      id: "p1", name: "Plan A", year: 2026, periodType: "annual", quarter: null, month: null,
      organizationId: ORG_ID, status: "active",
    })
    prismaMock.budgetLine.findMany.mockResolvedValue(lines)
    const res = await GET(makeRequest("/api/budgeting/export?planId=p1"))
    expect(res.status).toBe(200)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    return wb
  }

  /** 1-based positions of the two 14.5 columns on the Budget Lines tab. */
  const CORRECTION_COL = 9
  const REASON_COL = 10

  const plainLine = {
    id: "L1", category: "Salaries", lineType: "expense", plannedAmount: 1000,
    forecastAmount: null, sortOrder: 0, origin: null,
  }
  const correctionLine = {
    id: "L2", category: "Shareholders' expense", lineType: "expense",
    plannedAmount: -40_000, forecastAmount: null, sortOrder: 1,
    origin: "manual_correction",
    correctionReason: "PLF.09.01 missing from the 2026 budget sheet",
    correctionReviewAt: null,
  }

  it("declares hand-entered rows on the Dashboard", async () => {
    const wb = await exportAndRead([plainLine, correctionLine])
    const a3 = String(wb.getWorksheet("Dashboard")!.getCell("A3").value ?? "")
    expect(a3).toMatch(/1 MANUAL CORRECTION/)
    expect(a3).toMatch(/-40,000\.00 ₼/)
    expect(a3).toMatch(/not present in the source workbook/)
  })

  it("says nothing at all when the plan has no corrections", async () => {
    // And must not shift the KPI grid: row 3 stays empty, row 4 is KEY METRICS.
    const ws = (await exportAndRead([plainLine])).getWorksheet("Dashboard")!
    expect(ws.getCell("A3").value ?? "").toBe("")
    expect(String(ws.getCell("A4").value ?? "")).toBe("KEY METRICS")
  })

  it("keeps the KPI grid where it was even when it does speak", async () => {
    const ws = (await exportAndRead([plainLine, correctionLine])).getWorksheet("Dashboard")!
    expect(String(ws.getCell("A4").value ?? "")).toBe("KEY METRICS")
  })

  it("marks WHICH row it was, with the reason, on the Budget Lines tab", async () => {
    // "Somewhere in 2,340 lines" is not a disclosure anyone can act on.
    const ws = (await exportAndRead([plainLine, correctionLine])).getWorksheet("Budget Lines")!
    const header = ws.getRow(1).values as unknown[]
    expect(header).toContain("Manual correction")
    expect(header).toContain("Correction reason")
    // Column KEYS do not survive a round-trip through the file — ExcelJS keeps
    // them only on the in-memory definition — so index by position, which is
    // also what a recipient's Excel shows.
    expect(header.indexOf("Manual correction")).toBe(CORRECTION_COL)
    // Row 1 is the header; the two lines follow in sortOrder.
    expect(ws.getRow(2).getCell(CORRECTION_COL).value ?? "").toBe("")
    expect(ws.getRow(3).getCell(CORRECTION_COL).value).toBe("Yes")
    expect(String(ws.getRow(3).getCell(REASON_COL).value)).toMatch(/PLF\.09\.01/)
  })

  it("flags a correction a later import may have invalidated", async () => {
    const ws = (
      await exportAndRead([
        plainLine,
        { ...correctionLine, correctionReviewAt: new Date("2026-08-03T00:00:00Z") },
      ])
    ).getWorksheet("Budget Lines")!
    expect(ws.getRow(3).getCell(CORRECTION_COL).value).toBe("Yes — needs review")
    const a3 = String(
      (await exportAndRead([
        plainLine,
        { ...correctionLine, correctionReviewAt: new Date("2026-08-03T00:00:00Z") },
      ]))
        .getWorksheet("Dashboard")!
        .getCell("A3").value ?? "",
    )
    expect(a3).toMatch(/double-count/)
  })

  it("org-scoped findFirst (planId + orgId)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({
      id: "p1", name: "Plan A", year: 2026, periodType: "annual", quarter: null, month: null,
      organizationId: ORG_ID,
    })
    await GET(makeRequest("/api/budgeting/export?planId=p1"))
    expect(prismaMock.budgetPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1", organizationId: ORG_ID } }),
    )
  })
})
