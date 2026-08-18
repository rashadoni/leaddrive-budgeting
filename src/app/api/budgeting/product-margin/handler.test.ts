// @vitest-environment node
/**
 * 2026-08-19 — `/api/budgeting/product-margin` (GET).
 *
 * What is worth locking here is not the arithmetic (that is pinned in
 * `product-margin-accounts.test.ts` against the client's own figures) but the
 * three ways this route can report a true number about the wrong population:
 * an elimination row swept into a single company's margin, a restricted caller
 * seeing companies they may not, and the 0-based `monthIndex` reported as if
 * it were the calendar month.
 *
 * `resolvePnlEliminationScope` is deliberately NOT mocked — it is the pure
 * decision this route exists to share with the P&L page, and a mock of it
 * would assert only that the mock was called.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, scopeMock } = vi.hoisted(() => ({
  scopeMock: {
    getCompanyScope: vi.fn(
      async (): Promise<{ ids: Set<string> | null; bypassed: boolean }> => ({
        ids: null,
        bypassed: true,
      }),
    ),
  },
  prismaMock: {
    budgetPlan: { findFirst: vi.fn() },
    budgetLine: { groupBy: vi.fn() },
    chartOfAccount: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/rbac/company-scope", () => scopeMock)
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))
vi.mock("@/lib/budgeting/company-filter", () => ({ resolveCompanyFilter: vi.fn() }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { resolveCompanyFilter } from "@/lib/budgeting/company-filter"
import { GET } from "./route"

const ORG_ID = "org_demo"
const PLAN = { id: "plan_1", name: "Azərşəkər 2026 Actuals", year: 2026, kind: "actual" }

/** Cotton and wheat as the client's chart states them. */
const ACCOUNTS = [
  { id: "a1", code: "PLF.01.01.05", name: "Revenue from Sale of Cotton" },
  { id: "a2", code: "PLF.02.01.05", name: "Cotton Costs" },
  { id: "a3", code: "PLF.01.01.01", name: "Revenue from Sale of Wheat" },
  { id: "a4", code: "PLF.02.01.01", name: "Wheat Costs" },
]
const TOTALS = [
  { accountId: "a1", _sum: { plannedAmount: 1_387_524 } },
  { accountId: "a2", _sum: { plannedAmount: 1_371_625 } },
  { accountId: "a3", _sum: { plannedAmount: 47_006 } },
  { accountId: "a4", _sum: { plannedAmount: 34_635 } },
]

function stubHappyPath(monthIndexes = [0, 1, 2, 3, 4]) {
  prismaMock.budgetPlan.findFirst.mockResolvedValue(PLAN)
  prismaMock.chartOfAccount.findMany.mockResolvedValue(ACCOUNTS)
  prismaMock.budgetLine.groupBy.mockImplementation(async (args: { by: string[] }) =>
    args.by.includes("monthIndex")
      ? monthIndexes.map((monthIndex) => ({ monthIndex }))
      : TOTALS,
  )
}

/** The `where` the per-account aggregation actually ran with. */
function totalsWhere() {
  const calls = prismaMock.budgetLine.groupBy.mock.calls as Array<[{ by: string[]; where: unknown }]>
  return calls.find((call) => call[0].by.includes("accountId"))?.[0].where
}

beforeEach(() => {
  vi.clearAllMocks()
  scopeMock.getCompanyScope.mockResolvedValue({ ids: null, bypassed: true })
  ;(resolveCompanyFilter as ReturnType<typeof vi.fn>).mockResolvedValue({ kind: "all" })
})

describe("GET /api/budgeting/product-margin", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("http://x/api/budgeting/product-margin?planId=plan_1"))
    expect(res.status).toBe(401)
  })

  it("400 without a plan", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const res = await GET(makeRequest("http://x/api/budgeting/product-margin"))
    expect(res.status).toBe(400)
  })

  it("404 for a plan outside the caller's org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null)
    const res = await GET(makeRequest("http://x/api/budgeting/product-margin?planId=nope"))
    expect(res.status).toBe(404)
  })

  it("returns each product's margin and the months it covers", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    stubHappyPath()
    const res = await GET(makeRequest("http://x/api/budgeting/product-margin?planId=plan_1"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.products.map((p: { productName: string }) => p.productName)).toEqual([
      "Revenue from Sale of Cotton",
      "Revenue from Sale of Wheat",
    ])
    expect(body.products[0].marginPct).toBeCloseTo(1.1, 1)
    expect(body.products[1].marginPct).toBeCloseTo(26.3, 1)
    // Stored 0-based; January–May must not be reported as February–June.
    expect(body.monthsCovered).toEqual([1, 2, 3, 4, 5])
  })

  it("keeps intragroup eliminations out of a single company's margin", async () => {
    // The elimination block nets across ALL entities at once, so applying it
    // to one of them subtracts trades with companies that are not on screen.
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    ;(resolveCompanyFilter as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: "single",
      companyIds: ["co_1"],
    })
    stubHappyPath()
    const res = await GET(
      makeRequest("http://x/api/budgeting/product-margin?planId=plan_1&companyId=co_1"),
    )
    const body = await res.json()

    expect(totalsWhere()).toMatchObject({ isElimination: false, companyId: { in: ["co_1"] } })
    expect(body.basis).toBe("single_entity")
  })

  it("includes eliminations only for an unrestricted whole-group read", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    stubHappyPath()
    const res = await GET(makeRequest("http://x/api/budgeting/product-margin?planId=plan_1"))
    const body = await res.json()

    // No isElimination clause at all — the null-company rows are already in
    // scope for a query that carries no company filter.
    expect(totalsWhere()).not.toHaveProperty("isElimination")
    expect(body.basis).toBe("consolidated_computed")
  })

  it("narrows a restricted caller to their companies and drops eliminations", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    scopeMock.getCompanyScope.mockResolvedValue({ ids: new Set(["co_1"]), bypassed: false })
    stubHappyPath()
    await GET(makeRequest("http://x/api/budgeting/product-margin?planId=plan_1"))

    expect(totalsWhere()).toMatchObject({
      companyId: { in: ["co_1"] },
      isElimination: false,
    })
  })

  it("404s a company the caller may not see", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    scopeMock.getCompanyScope.mockResolvedValue({ ids: new Set(["co_1"]), bypassed: false })
    ;(resolveCompanyFilter as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: "single",
      companyIds: ["co_other"],
    })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(PLAN)
    const res = await GET(
      makeRequest("http://x/api/budgeting/product-margin?planId=plan_1&companyId=co_other"),
    )
    expect(res.status).toBe(404)
  })
})
