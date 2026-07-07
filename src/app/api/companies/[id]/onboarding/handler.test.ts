// @vitest-environment node
/**
 * Handler test for `/api/companies/[id]/onboarding` (GET).
 *
 * Per-company completeness report. Locks:
 * - cross-tenant 404 (existence-leak guard)
 * - sub-group RBAC 403 when out of scope
 * - 500 wrapping on checker errors
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findFirst: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
// Stage 3 RLS — the route wraps DB access in withOrgScope; hand it the prismaMock as tx.
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))

const { getCompanyScopeMock, checkOnboardingMock } = vi.hoisted(() => ({
  getCompanyScopeMock: vi.fn(),
  checkOnboardingMock: vi.fn(),
}))
vi.mock("@/lib/rbac/company-scope", () => ({
  getCompanyScope: getCompanyScopeMock,
}))
vi.mock("@/lib/onboarding/completeness-checker", () => ({
  checkOnboardingCompleteness: checkOnboardingMock,
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.company.findFirst.mockReset().mockResolvedValue({ id: "c1" })
  getCompanyScopeMock.mockReset().mockResolvedValue({ ids: null, bypassed: true })
  checkOnboardingMock.mockReset().mockResolvedValue({
    sections: [],
    completeness: 0.5,
  })
})

describe("GET /api/companies/[id]/onboarding", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(
      makeRequest("/api/companies/c1/onboarding"),
      { params: Promise.resolve({ id: "c1" }) },
    )
    expect(res.status).toBe(401)
  })

  it("404 cross-tenant id (existence-leak guard)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.company.findFirst.mockResolvedValue(null)
    const res = await GET(
      makeRequest("/api/companies/c-other/onboarding"),
      { params: Promise.resolve({ id: "c-other" }) },
    )
    expect(res.status).toBe(404) // NOT 403 — never leak existence
  })

  it("403 out-of-scope company (sub-group RBAC)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    getCompanyScopeMock.mockResolvedValue({
      ids: new Set(["c-other"]),
      bypassed: false,
    })
    const res = await GET(
      makeRequest("/api/companies/c1/onboarding"),
      { params: Promise.resolve({ id: "c1" }) },
    )
    expect(res.status).toBe(403)
    expect(checkOnboardingMock).not.toHaveBeenCalled()
  })

  it("200 admin (scope bypass) returns completeness report", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    const res = await GET(
      makeRequest("/api/companies/c1/onboarding"),
      { params: Promise.resolve({ id: "c1" }) },
    )
    expect(res.status).toBe(200)
    expect(checkOnboardingMock).toHaveBeenCalledWith(prismaMock, "c1", "2026")
  })

  it("?period= query parameter passes through to checker", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(
      makeRequest("/api/companies/c1/onboarding?period=2025-Q3"),
      { params: Promise.resolve({ id: "c1" }) },
    )
    expect(checkOnboardingMock).toHaveBeenCalledWith(prismaMock, "c1", "2025-Q3")
  })

  it("500 wrapping on checker exception", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    checkOnboardingMock.mockRejectedValue(new Error("DB explosion"))
    const res = await GET(
      makeRequest("/api/companies/c1/onboarding"),
      { params: Promise.resolve({ id: "c1" }) },
    )
    expect(res.status).toBe(500)
  })
})
