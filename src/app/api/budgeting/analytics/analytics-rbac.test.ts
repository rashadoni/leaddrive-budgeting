// @vitest-environment node
/**
 * 2026-08-18 — analytics honours the caller's company scope.
 *
 * This route checked the organisation and nothing else. A user restricted to
 * one sub-group saw org-wide totals here while every sibling surface honoured
 * their scope — so the narrowing worked everywhere except the screen that
 * shows the biggest numbers.
 *
 * The reason recorded for skipping it was tx-hold time. Measured on the
 * production database before changing anything:
 *
 *   getCompanyScope user lookup     0.045 ms  (index)
 *   getCompanyScope company lookup  0.064 ms  (index, 7 rows)
 *   the aggregation this tx holds   ~40 ms    (the route's own note)
 *
 * and both go to zero tx-hold once the call sits above `withOrgScope`, which
 * is where `company-scope.ts` says it belongs. The identity was already being
 * resolved too: `getOrgId` called `getSession` and threw away everything but
 * the org id. So the objection cost nothing to remove, and the tests below
 * pin what removing it bought.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, companyFilterMock, scopeMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn() },
    budgetLine: { findMany: vi.fn() },
    budgetActual: { findMany: vi.fn() },
    budgetCostType: { findMany: vi.fn() },
    budgetDepartment: { findMany: vi.fn() },
    budgetForecastEntry: { findMany: vi.fn() },
    salesForecast: { findMany: vi.fn() },
    expenseForecast: { findMany: vi.fn() },
  },
  companyFilterMock: { resolveCompanyFilter: vi.fn() },
  scopeMock: { getCompanyScope: vi.fn() },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))
vi.mock("@/lib/budgeting/company-filter", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/budgeting/company-filter")
  >("@/lib/budgeting/company-filter")
  return { ...actual, ...companyFilterMock }
})
vi.mock("@/lib/rbac/company-scope", () => scopeMock)

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

/** The `where` the route sent when it read budget lines. */
function lineWhere(): Record<string, unknown> {
  const call = prismaMock.budgetLine.findMany.mock.calls[0]?.[0] as
    | { where?: Record<string, unknown> }
    | undefined
  return call?.where ?? {}
}

beforeEach(() => {
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({ id: "p1", year: 2026 })
  for (const model of [
    prismaMock.budgetLine,
    prismaMock.budgetActual,
    prismaMock.budgetCostType,
    prismaMock.budgetDepartment,
    prismaMock.budgetForecastEntry,
    prismaMock.salesForecast,
    prismaMock.expenseForecast,
  ]) {
    model.findMany.mockReset().mockResolvedValue([])
  }
  companyFilterMock.resolveCompanyFilter.mockReset().mockResolvedValue({ kind: "all" })
  scopeMock.getCompanyScope.mockReset().mockResolvedValue({ ids: null, bypassed: true })
})

describe("analytics honours the caller's company scope", () => {
  it("narrows an org-wide read to the companies the caller may see", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u2", role: "viewer" })
    scopeMock.getCompanyScope.mockResolvedValue({
      ids: new Set(["c_a", "c_b"]),
      bypassed: false,
    })

    await GET(makeRequest("/api/budgeting/analytics?planId=p1"))

    expect(lineWhere().companyId).toEqual({ in: ["c_a", "c_b"] })
  })

  it("leaves an unrestricted caller org-wide, as before", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })

    await GET(makeRequest("/api/budgeting/analytics?planId=p1"))

    expect(lineWhere()).not.toHaveProperty("companyId")
  })

  it("404s a company outside the scope rather than returning an empty total", async () => {
    // Indistinguishable from a company that does not exist — the same answer
    // `pnl/route.ts` gives, so the two cannot be told apart by probing.
    await mockSession({ orgId: ORG_ID, userId: "u2", role: "viewer" })
    scopeMock.getCompanyScope.mockResolvedValue({ ids: new Set(["c_a"]), bypassed: false })
    companyFilterMock.resolveCompanyFilter.mockResolvedValue({
      kind: "single",
      companyIds: ["c_forbidden"],
      resolvedFromLevel: 2,
    })

    const res = await GET(makeRequest("/api/budgeting/analytics?planId=p1&companyId=c_forbidden"))

    expect(res.status).toBe(404)
    expect(prismaMock.budgetLine.findMany).not.toHaveBeenCalled()
  })

  it("keeps the companies a partially-permitted sub-group may see", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u2", role: "viewer" })
    scopeMock.getCompanyScope.mockResolvedValue({ ids: new Set(["c_a"]), bypassed: false })
    companyFilterMock.resolveCompanyFilter.mockResolvedValue({
      kind: "single",
      companyIds: ["c_a", "c_forbidden"],
      resolvedFromLevel: 1,
    })

    await GET(makeRequest("/api/budgeting/analytics?planId=p1&companyId=sub"))

    expect(lineWhere().companyId).toEqual({ in: ["c_a"] })
  })

  it("tells a restricted caller the total is a sum, not a consolidation", async () => {
    // The elimination rule from #133/#135, now that this route can tell a
    // restricted caller from an unrestricted one. Its `restricted: false` was
    // a stand-in for not knowing; it is an answer now.
    await mockSession({ orgId: ORG_ID, userId: "u2", role: "viewer" })
    scopeMock.getCompanyScope.mockResolvedValue({ ids: new Set(["c_a"]), bypassed: false })

    const res = await GET(makeRequest("/api/budgeting/analytics?planId=p1"))
    const body = (await res.json()) as { data?: Record<string, unknown> }

    expect(body.data?.basis).toBe("sum_of_entities")
    expect(lineWhere().isElimination).toBe(false)
  })

  it("resolves the scope BEFORE opening the transaction", async () => {
    // The whole objection was tx-hold time. The call has to happen outside
    // the closure for that answer to hold, so this pins the ordering rather
    // than trusting the comment.
    const order: string[] = []
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    scopeMock.getCompanyScope.mockImplementation(async () => {
      order.push("scope")
      return { ids: null, bypassed: true }
    })
    prismaMock.budgetPlan.findFirst.mockImplementation(async () => {
      order.push("tx-read")
      return { id: "p1", year: 2026 }
    })

    await GET(makeRequest("/api/budgeting/analytics?planId=p1"))

    expect(order[0]).toBe("scope")
  })
})
