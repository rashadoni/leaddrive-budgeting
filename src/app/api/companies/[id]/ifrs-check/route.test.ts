// @vitest-environment node
/**
 * Phase 7.N — handler tests for GET /api/companies/[id]/ifrs-check.
 * Covers the auth + tenant-scope + sub-group RBAC contract and the
 * end-to-end shaping → report wiring (deep rule behaviour lives in
 * src/lib/audit/ifrs-checks.test.ts).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findFirst: vi.fn() },
    balanceSheetLine: { findMany: vi.fn() },
    budgetLine: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"
const COMPANY_ID = "c_azseker_malt"

function buildParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  for (const fn of [
    prismaMock.company.findFirst,
    prismaMock.company.findMany,
    prismaMock.user.findFirst,
    prismaMock.balanceSheetLine.findMany,
    prismaMock.budgetLine.findMany,
  ]) {
    fn.mockReset()
  }
  prismaMock.company.findFirst.mockResolvedValue({ id: COMPANY_ID, code: "AZSEKER-MALT", name: "Malt" })
  prismaMock.user.findFirst.mockResolvedValue({ allowedSubGroupIds: [] })
  prismaMock.balanceSheetLine.findMany.mockResolvedValue([])
  prismaMock.budgetLine.findMany.mockResolvedValue([])
})

describe("GET /api/companies/[id]/ifrs-check", () => {
  it("runs the checks against a balanced, fully-classified company → 200 pass", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    // Two periods; only the latest (2026-03) is used for the balance check.
    prismaMock.balanceSheetLine.findMany.mockResolvedValue([
      { lineType: "asset", amount: 999, year: 2025, month: 12 }, // older period — ignored
      { lineType: "asset", amount: 326066365, year: 2026, month: 3 },
      { lineType: "liability", amount: -128398951, year: 2026, month: 3 },
      { lineType: "equity", amount: -197667414, year: 2026, month: 3 },
    ])
    prismaMock.budgetLine.findMany.mockResolvedValue([
      { plannedAmount: 5000, accountId: "r1", account: { accountType: "revenue", category: null, name: "Sales", nameRu: null, nameAz: null, nameEn: null } },
      { plannedAmount: 2000, accountId: "c1", account: { accountType: "cogs", category: null, name: "Raw materials", nameRu: null, nameAz: null, nameEn: null } },
      { plannedAmount: 800, accountId: "e1", account: { accountType: "expense", category: "staff", name: "Salaries", nameRu: null, nameAz: null, nameEn: null } },
      { plannedAmount: 300, accountId: "e2", account: { accountType: "expense", category: "depreciation", name: "Depreciation", nameRu: null, nameAz: null, nameEn: null } },
    ])

    const res = await GET(makeRequest(`/api/companies/${COMPANY_ID}/ifrs-check`), buildParams(COMPANY_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.company.code).toBe("AZSEKER-MALT")
    expect(body.period).toBe("2026-03")
    expect(body.report.summary.fail).toBe(0)
    expect(body.report.summary.score).toBe(100)
    const bal = body.report.checks.find((c: { code: string }) => c.code === "bs_balances")
    expect(bal.status).toBe("pass")
    expect(bal.values.residual).toBe(0)
  })

  it("skips the BS checks when only a P&L was imported (no fabricated fail)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.balanceSheetLine.findMany.mockResolvedValue([]) // FARM: P&L only
    prismaMock.budgetLine.findMany.mockResolvedValue([
      { plannedAmount: 5000, accountId: "r1", account: { accountType: "revenue", category: null, name: "Sales", nameRu: null, nameAz: null, nameEn: null } },
    ])
    const res = await GET(makeRequest(`/api/companies/${COMPANY_ID}/ifrs-check`), buildParams(COMPANY_ID))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.period).toBeNull()
    const bal = body.report.checks.find((c: { code: string }) => c.code === "bs_balances")
    expect(bal.status).toBe("skip")
  })

  it("detects an Azerbaijani-named depreciation account via the name fallback", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.budgetLine.findMany.mockResolvedValue([
      { plannedAmount: 100, accountId: "x1", account: { accountType: "cogs", category: null, name: "Amortizasiya", nameRu: null, nameAz: "Amortizasiya xərcləri", nameEn: null } },
    ])
    const res = await GET(makeRequest(`/api/companies/${COMPANY_ID}/ifrs-check`), buildParams(COMPANY_ID))
    const body = await res.json()
    const dep = body.report.checks.find((c: { code: string }) => c.code === "pnl_depreciation")
    expect(dep.status).toBe("pass")
  })

  it("returns 404 for a company in another tenant (no existence leak)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.company.findFirst.mockResolvedValue(null)
    const res = await GET(makeRequest(`/api/companies/other/ifrs-check`), buildParams("other"))
    expect(res.status).toBe(404)
  })

  it("returns 403 when a sub-group-scoped manager probes a company outside scope", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_mgr", role: "manager" })
    prismaMock.user.findFirst.mockResolvedValue({ allowedSubGroupIds: ["sg_other"] })
    prismaMock.company.findMany.mockResolvedValue([]) // no companies in that sub-group
    const res = await GET(makeRequest(`/api/companies/${COMPANY_ID}/ifrs-check`), buildParams(COMPANY_ID))
    expect(res.status).toBe(403)
  })
})
