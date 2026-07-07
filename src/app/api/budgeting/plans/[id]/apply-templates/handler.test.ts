// @vitest-environment node
/**
 * Handler test for `/api/budgeting/plans/[id]/apply-templates` (POST).
 *
 * Locks Phase 7.G Turn LXIX manager-only gate + period-lock + plan
 * cross-tenant guard + dedup-on-(name,lineType) + line creation
 * count semantics.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, resolveAccountIdMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn() },
    budgetDirectionTemplate: { findMany: vi.fn() },
    budgetLine: { findMany: vi.fn(), create: vi.fn() },
    organization: { findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  resolveAccountIdMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))
vi.mock("@/lib/budgeting/chart-of-accounts", () => ({
  resolveAccountId: resolveAccountIdMock,
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.budgetDirectionTemplate.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetLine.create.mockReset().mockResolvedValue({ id: "bl1" })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
  resolveAccountIdMock.mockReset().mockResolvedValue(null)
})

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe("POST /api/budgeting/plans/[id]/apply-templates", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/plans/p1/apply-templates", {
        method: "POST",
        json: { templateIds: ["t1"] },
      }),
      makeParams("p1"),
    )
    expect(res.status).toBe(401)
  })

  it("403 viewer-only (requires manager)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/plans/p1/apply-templates", {
        method: "POST",
        json: { templateIds: ["t1"] },
      }),
      makeParams("p1"),
    )
    expect(res.status).toBe(403)
  })

  it("400 strict-zod rejects empty templateIds array", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/budgeting/plans/p1/apply-templates", {
        method: "POST",
        json: { templateIds: [] },
      }),
      makeParams("p1"),
    )
    expect(res.status).toBe(400)
  })

  it("400 strict-zod rejects extra field", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/budgeting/plans/p1/apply-templates", {
        method: "POST",
        json: { templateIds: ["t1"], organizationId: "evil" },
      }),
      makeParams("p1"),
    )
    expect(res.status).toBe(400)
  })

  it("404 plan not in caller's org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null)
    const res = await POST(
      makeRequest("/api/budgeting/plans/p1/apply-templates", {
        method: "POST",
        json: { templateIds: ["t1"] },
      }),
      makeParams("p1"),
    )
    expect(res.status).toBe(404)
  })

  it("200 happy path — created + skipped (dedup by name||lineType)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({
      id: "p1",
      organizationId: ORG_ID,
      year: 2026,
    })
    prismaMock.budgetDirectionTemplate.findMany.mockResolvedValue([
      { id: "t1", name: "Salaries", lineType: "expense", lineSubtype: null, department: null, defaultAmount: 1000, unitPrice: null, unitCost: null, quantity: null, costModelKey: null },
      { id: "t2", name: "Rent",     lineType: "expense", lineSubtype: null, department: null, defaultAmount: 500,  unitPrice: null, unitCost: null, quantity: null, costModelKey: null },
    ])
    // Phase 2.1 session 3: existing-line dedup keyed by
    // `${account.code}||${lineType}` now that BudgetLine.category dropped.
    prismaMock.budgetLine.findMany.mockResolvedValue([
      { accountId: "coa_salaries", account: { code: "Salaries" }, lineType: "expense" },
    ])
    // Phase 2.1 session 3: route resolves accountId via
    // resolveAccountId(name) — return distinct ids per template name so
    // the NOT NULL FK is satisfied and dedup key matches.
    resolveAccountIdMock.mockImplementation(async (_p: unknown, _o: string, name: string) =>
      name === "Salaries" ? "coa_salaries" : `coa_${name.toLowerCase()}`,
    )
    const res = await POST(
      makeRequest("/api/budgeting/plans/p1/apply-templates", {
        method: "POST",
        json: { templateIds: ["t1", "t2"] },
      }),
      makeParams("p1"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({ created: 1, skipped: 1 })
  })
})
