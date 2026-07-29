// @vitest-environment node
/**
 * Phase 7.G Turn LXIX — handler tests for `/api/budgeting/import-csv` POST.
 * Locks Phase 4.2 period-lock gate on bulk-CSV-import path.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn() },
    // 2026-07-29 — the route now buffers rows so it can infer the file's
    // cost-sign convention before writing, then does one createMany.
    budgetActual: { create: vi.fn(), createMany: vi.fn() },
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
  prismaMock.budgetActual.createMany.mockReset().mockResolvedValue({ count: 1 })
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
    expect(prismaMock.budgetActual.createMany).not.toHaveBeenCalled()
    expect(prismaMock.accountingImport.create).not.toHaveBeenCalled()
  })

  it("returns 200 happy path when no lock", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(makeRequest("/api/budgeting/import-csv", { method: "POST", json: validBody }))
    expect(res.status).toBe(200)
    expect(prismaMock.budgetActual.createMany).toHaveBeenCalledTimes(1)
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

// ─── 2026-07-29 — sign, zeros, provenance, status ───────────────────────
//
// This route was missed by the tree-wide Math.abs sweep in e217ce91: it is a
// second live BudgetActual writer, outside src/lib/onboarding.
describe("POST /api/budgeting/import-csv — amount handling", () => {
  async function post(rows: Array<Record<string, string>>) {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    return POST(
      makeRequest("/api/budgeting/import-csv", {
        method: "POST",
        json: { planId: "p1", rows },
      }),
    )
  }

  function written() {
    const [arg] = prismaMock.budgetActual.createMany.mock.calls[0] as unknown as [
      { data: Array<Record<string, unknown>> },
    ]
    return arg.data
  }

  it("KEEPS an explicit zero instead of counting it as a failed row", async () => {
    await post([
      { category: "Rent", amount: "0" },
      { category: "Fuel", amount: "100" },
    ])
    expect(written()).toHaveLength(2)
    expect(written().some((r) => r.actualAmount === 0)).toBe(true)
  })

  it("keeps a credit note NEGATIVE in a charge-positive file", async () => {
    // Math.abs used to turn -500 into +500, ADDING to the actual it should
    // reduce.
    await post([
      { category: "Fuel", amount: "1000" },
      { category: "Fuel", amount: "800" },
      { category: "Fuel", amount: "-500" },
    ])
    expect(written().map((r) => r.actualAmount)).toEqual([1000, 800, -500])
  })

  it("normalizes a charge-negative file rather than flipping every actual", async () => {
    // Dropping Math.abs alone would have made every one of these negative.
    await post([
      { category: "Fuel", amount: "-1000" },
      { category: "Fuel", amount: "-800" },
      { category: "Fuel", amount: "500" },
    ])
    expect(written().map((r) => r.actualAmount)).toEqual([1000, 800, -500])
  })

  it("stamps provenance so a reset can reach these rows", async () => {
    // Without `source` the rows read as hand-entered, which the Phase 11.1b
    // reset deliberately refuses to touch — so every re-import accumulated a
    // layer no UI path could remove.
    await post([{ category: "Fuel", amount: "100" }])
    expect(String(written()[0].source)).toMatch(/^csv-import:/)
  })

  it("reports a PARTIAL run instead of calling it completed", async () => {
    // `errors.length > 0 ? "completed" : "completed"` — both arms were
    // identical, so a partial failure looked like a clean run in the history.
    await post([
      { category: "Fuel", amount: "100" },
      { category: "Fuel", amount: "abc" },
    ])
    const call = prismaMock.accountingImport.updateMany.mock.calls.at(
      -1,
    ) as unknown as [{ data: Record<string, unknown> }]
    expect(call[0].data.status).toBe("partial")
  })
})
