// @vitest-environment node
/**
 * Phase 10 / B1 shadow slice — handler tests for
 * GET /api/companies/[id]/statement-controls.
 *
 * Covers the auth + tenant-scope + sub-group RBAC contract (mirroring
 * ifrs-check/route.test.ts), the shadow-envelope pinning (shadow:true,
 * decisionGrade:false, provisional policy, banner — the label can never
 * silently disappear), period validation, read-only tx-method recording and
 * org scoping of every captured where. Deep control behaviour lives in
 * src/lib/risk/statement-controls-adapter.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, recordedCalls } = vi.hoisted(() => {
  const recordedCalls: Array<{ method: string; args?: { where?: Record<string, unknown> } }> = []
  const results: Record<string, unknown> = {}
  const record =
    (method: string) =>
    async (args?: { where?: Record<string, unknown> }) => {
      recordedCalls.push({ method, args })
      const value = results[method]
      return typeof value === "function" ? (value as (a?: unknown) => unknown)(args) : value
    }
  const model = (name: string, methods: string[]) =>
    Object.fromEntries(methods.map((m) => [m, record(`${name}.${m}`)]))
  const prismaMock = {
    // Every model exposes ONLY read methods; a create/update/delete/upsert
    // call would throw a TypeError — the read-only surface is structural.
    company: model("company", ["findFirst", "findMany"]),
    user: model("user", ["findFirst"]),
    balanceSheetLine: model("balanceSheetLine", ["findMany"]),
    cashFlowEntry: model("cashFlowEntry", ["findMany", "findFirst"]),
    budgetLine: model("budgetLine", ["findMany"]),
    currencyRateHistory: model("currencyRateHistory", ["findMany"]),
    __results: results,
  }
  return { prismaMock, recordedCalls }
})

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import * as routeModule from "./route"

const { GET } = routeModule

const ORG_ID = "org_demo"
const COMPANY_ID = "c_azseker_malt"

function buildParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function setResult(method: string, value: unknown) {
  ;(prismaMock.__results as Record<string, unknown>)[method] = value
}

beforeEach(() => {
  recordedCalls.length = 0
  for (const key of Object.keys(prismaMock.__results as Record<string, unknown>)) {
    delete (prismaMock.__results as Record<string, unknown>)[key]
  }
  setResult("company.findFirst", { id: COMPANY_ID, code: "AZSEKER-MALT", name: "Malt" })
  setResult("user.findFirst", { allowedSubGroupIds: [] })
  setResult("company.findMany", [])
  setResult("balanceSheetLine.findMany", [])
  setResult("cashFlowEntry.findMany", [])
  setResult("cashFlowEntry.findFirst", null)
  setResult("budgetLine.findMany", [])
  setResult("currencyRateHistory.findMany", [])
})

const RICH_BS = [
  { lineType: "asset", amount: 1_000, year: 2026, month: 3, account: { name: "Fixed assets", nameEn: null, nameRu: null, nameAz: null } },
  { lineType: "liability", amount: -400, year: 2026, month: 3, account: { name: "Loans", nameEn: null, nameRu: null, nameAz: null } },
  { lineType: "equity", amount: -600, year: 2026, month: 3, account: { name: "Share capital", nameEn: null, nameRu: null, nameAz: null } },
]

describe("GET /api/companies/[id]/statement-controls", () => {
  it("returns 401 for an unauthenticated caller", async () => {
    await mockSession(null)
    const res = await GET(makeRequest(`/api/companies/${COMPANY_ID}/statement-controls`), buildParams(COMPANY_ID))
    expect(res.status).toBe(401)
  })

  it("rejects a session without an organization (401 via requireAuth's org gate)", async () => {
    // getSession treats an authenticated user without organizationId as
    // unauthenticated (api-auth.ts), so the rejection surfaces as 401 before
    // the route's own defensive 403 branch can fire.
    await mockSession({ orgId: "", userId: "u_admin", role: "admin" })
    const res = await GET(makeRequest(`/api/companies/${COMPANY_ID}/statement-controls`), buildParams(COMPANY_ID))
    expect(res.status).toBe(401)
  })

  it("returns 404 for a company in another tenant (no existence leak)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    setResult("company.findFirst", null)
    const res = await GET(makeRequest(`/api/companies/other/statement-controls`), buildParams("other"))
    expect(res.status).toBe(404)
  })

  it("returns 403 when a sub-group-scoped manager probes a company outside scope", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_mgr", role: "manager" })
    setResult("user.findFirst", { allowedSubGroupIds: ["sg_other"] })
    setResult("company.findMany", []) // no companies in that sub-group
    const res = await GET(makeRequest(`/api/companies/${COMPANY_ID}/statement-controls`), buildParams(COMPANY_ID))
    expect(res.status).toBe(403)
  })

  it.each(["2026-13", "26-01", "junk"])("returns 400 for invalid period %s", async (period) => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    const res = await GET(
      makeRequest(`/api/companies/${COMPANY_ID}/statement-controls?period=${period}`),
      buildParams(COMPANY_ID),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Invalid period; expected YYYY-MM")
  })

  it("returns 200 noStatements for a company with no statements at all", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    const res = await GET(makeRequest(`/api/companies/${COMPANY_ID}/statement-controls`), buildParams(COMPANY_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      shadow: true,
      decisionGrade: false,
      noStatements: true,
      period: null,
      controls: [],
    })
  })

  it("returns the pinned shadow envelope with all six codes, never pass/fail", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    setResult("balanceSheetLine.findMany", RICH_BS)
    setResult("cashFlowEntry.findMany", [
      { activityType: "operating", entryType: "inflow", amount: 100 },
      { activityType: "operating", entryType: "outflow", amount: 40 },
    ])
    const res = await GET(makeRequest(`/api/companies/${COMPANY_ID}/statement-controls`), buildParams(COMPANY_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    // The shadow label is pinned so it can never silently disappear.
    expect(body.shadow).toBe(true)
    expect(body.decisionGrade).toBe(false)
    expect(body.banner).toBe("SHADOW / PROVISIONAL — NOT DECISION-GRADE")
    expect(body.policy.approval).toBe("provisional")
    expect(body.policy.id).toBe("t1-option-a-shape-shadow-v1")
    expect(body.company.code).toBe("AZSEKER-MALT")
    expect(body.period).toBe("2026-03")
    expect(body.openingPeriod).toBe("2026-02")
    expect(body.basis).toBe("plan")
    expect(body.currency).toBe("AZN")
    expect(body.bsSignConvention.detected).toBe("trial_balance")
    expect(typeof body.generatedAt).toBe("string")
    const codes = body.controls.map((c: { code: string }) => c.code)
    for (const code of [
      "balance_sheet",
      "cash_flow_sum",
      "cash_to_balance_sheet",
      "retained_earnings",
      "net_income_link",
      "fx_translation",
    ]) {
      expect(codes).toContain(code)
    }
    for (const control of body.controls) {
      if (control.kind === "evaluated") {
        expect(["provisional", "blocked"]).toContain(control.result.decisionStatus)
      }
    }
    const balance = body.controls.find((c: { code: string }) => c.code === "balance_sheet")
    expect(balance.result.decisionStatus).toBe("provisional")
    expect(balance.result.signedDelta).toBe(0) // 1000 = 400 + 600 after normalization
  })

  it("honours an explicit ?period=YYYY-MM", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    setResult("balanceSheetLine.findMany", RICH_BS)
    const res = await GET(
      makeRequest(`/api/companies/${COMPANY_ID}/statement-controls?period=2026-01`),
      buildParams(COMPANY_ID),
    )
    const body = await res.json()
    expect(body.period).toBe("2026-01")
    expect(body.openingPeriod).toBe("2025-12")
  })

  it("only ever invokes read methods, and scopes every where to the org + company", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    setResult("balanceSheetLine.findMany", RICH_BS)
    const res = await GET(makeRequest(`/api/companies/${COMPANY_ID}/statement-controls`), buildParams(COMPANY_ID))
    expect(res.status).toBe(200)
    expect(recordedCalls.length).toBeGreaterThan(0)
    for (const call of recordedCalls) {
      // Read-only surface: nothing but findFirst/findMany may ever run.
      expect(call.method).toMatch(/\.(findFirst|findMany)$/)
      const where = call.args?.where ?? {}
      expect(where.organizationId).toBe(ORG_ID)
      if (call.method === "company.findFirst") {
        expect(where.id).toBe(COMPANY_ID)
      } else if (
        call.method.startsWith("balanceSheetLine.") ||
        call.method.startsWith("cashFlowEntry.") ||
        call.method.startsWith("budgetLine.")
      ) {
        expect(where.companyId).toBe(COMPANY_ID)
      }
    }
  })

  it("exports GET as the module's only HTTP method", () => {
    const httpExports = Object.keys(routeModule).filter((k) =>
      ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(k),
    )
    expect(httpExports).toEqual(["GET"])
  })
})
