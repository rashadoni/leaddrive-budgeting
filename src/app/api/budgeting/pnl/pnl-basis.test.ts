// @vitest-environment node
/**
 * 2026-08-18 — the P&L says WHICH number it is showing.
 *
 * #133 taught this route to decide whether the group's intragroup
 * eliminations belong in a query. It did not teach it to say what it decided,
 * so a consolidated total and a bare sum of companies — two numbers that
 * differ by the whole group's intercompany reversal — reached the screen
 * looking equally authoritative. The balance sheet has disclosed this since
 * 14.8; the P&L could not.
 *
 * Two things are pinned here, and the second matters more than the first:
 *
 *   1. `basis` states the kind of aggregate on every path, including the
 *      empty one — a caller reading it unconditionally must never get
 *      `undefined` on the one response that carries no rows.
 *   2. The WHERE agrees with the label. A response that says
 *      `sum_of_entities` while the query admitted elimination rows would be
 *      worse than saying nothing, so the assertions read the actual filter
 *      the route sent to Prisma rather than trusting the word.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, companyFilterMock, scopeMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn() },
    budgetLine: { findMany: vi.fn() },
    salesBudgetLine: { findMany: vi.fn() },
    cOGSBudgetLine: { findMany: vi.fn() },
    budgetActual: { findMany: vi.fn() },
    user: { findFirst: vi.fn().mockResolvedValue({ allowedSubGroupIds: [] }) },
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
function budgetLineWhere(): Record<string, unknown> {
  const call = prismaMock.budgetLine.findMany.mock.calls[0]?.[0] as
    | { where?: Record<string, unknown> }
    | undefined
  return call?.where ?? {}
}

beforeEach(() => {
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({ year: 2026 })
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.salesBudgetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.cOGSBudgetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetActual.findMany.mockReset().mockResolvedValue([])
  companyFilterMock.resolveCompanyFilter.mockReset().mockResolvedValue({ kind: "all" })
  // Unrestricted by default — an admin looking at the whole group.
  scopeMock.getCompanyScope.mockReset().mockResolvedValue({ ids: null, bypassed: true })
})

describe("P&L consolidation basis", () => {
  it("an unrestricted org-wide read is a consolidation, and admits the eliminations", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const res = await GET(makeRequest("/api/budgeting/pnl?planId=p1"))
    const body = (await res.json()) as Record<string, unknown>

    expect(body.basis).toBe("consolidated_computed")
    // No `isElimination` filter at all: null-company rows are in scope, which
    // is what makes this a consolidation rather than a sum.
    expect(budgetLineWhere()).not.toHaveProperty("isElimination")
  })

  it("a restricted view is a sum of entities, and the query says so too", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u2", role: "viewer" })
    scopeMock.getCompanyScope.mockResolvedValue({ ids: new Set(["c_a"]), bypassed: false })

    const res = await GET(makeRequest("/api/budgeting/pnl?planId=p1"))
    const body = (await res.json()) as Record<string, unknown>

    expect(body.basis).toBe("sum_of_entities")
    // The client's EJE block nets across ALL entities, so a subset must not
    // carry it — the label and the filter have to agree.
    expect(budgetLineWhere().isElimination).toBe(false)
  })

  it("a single company is its own result, never the group's", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    companyFilterMock.resolveCompanyFilter.mockResolvedValue({
      kind: "single",
      companyIds: ["c_a"],
      resolvedFromLevel: 2,
    })

    const res = await GET(makeRequest("/api/budgeting/pnl?planId=p1&companyId=c_a"))
    const body = (await res.json()) as Record<string, unknown>

    expect(body.basis).toBe("single_entity")
    expect(budgetLineWhere().isElimination).toBe(false)
  })

  it("states a basis even on the empty sub-group path", async () => {
    // The one response that carries no rows still has to answer the question,
    // or a caller reading `basis` unconditionally gets `undefined` exactly
    // where it has least context to handle it.
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    companyFilterMock.resolveCompanyFilter.mockResolvedValue({
      kind: "single",
      companyIds: [],
      resolvedFromLevel: 1,
    })

    const res = await GET(makeRequest("/api/budgeting/pnl?planId=p1&companyId=sub"))
    const body = (await res.json()) as Record<string, unknown>

    expect(body._emptyReason).toBe("subgroup_no_children")
    expect(body.basis).toBe("single_entity")
  })
})
