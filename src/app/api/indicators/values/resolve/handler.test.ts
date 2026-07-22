// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, scopeMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findFirst: vi.fn() },
    indicatorDefinition: { findFirst: vi.fn() },
    indicatorValue: { findUnique: vi.fn() },
    user: { findFirst: vi.fn().mockResolvedValue({ allowedSubGroupIds: [] }) },
  },
  scopeMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
// Stage 3 RLS — hand the mock straight to the scope callback.
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
}))
vi.mock("@/lib/rbac/company-scope", () => ({ getCompanyScope: scopeMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG = "org_demo"

beforeEach(() => {
  prismaMock.company.findFirst.mockReset().mockResolvedValue({ id: "comp_aac" })
  prismaMock.indicatorDefinition.findFirst.mockReset().mockResolvedValue({ id: "ind_rev_growth" })
  prismaMock.indicatorValue.findUnique.mockReset().mockResolvedValue({ id: "iv_xyz" })
  scopeMock.mockReset().mockResolvedValue({ ids: null, bypassed: false })
})

const url = (q: Record<string, string> = {}) => {
  const sp = new URLSearchParams({ company: "AAC", indicator: "REV_GROWTH", period: "2026", ...q })
  return `/api/indicators/values/resolve?${sp}`
}

const companyIdUrl = (companyId = "comp_aac") => {
  const sp = new URLSearchParams({ companyId, indicator: "REV_GROWTH", period: "2026" })
  return `/api/indicators/values/resolve?${sp}`
}

describe("GET /api/indicators/values/resolve — auth", () => {
  it("401 unauth", async () => {
    await mockSession(null)
    const res = await GET(makeRequest(url()))
    expect(res.status).toBe(401)
  })

  it("rejects when user has no org (401 or 403)", async () => {
    await mockSession({ orgId: "", userId: "u1", role: "viewer" })
    const res = await GET(makeRequest(url()))
    // Auth harness with empty orgId → 401 from requireAuth (not 403)
    expect([401, 403]).toContain(res.status)
  })
})

describe("GET — Zod validation", () => {
  beforeEach(async () => {
    await mockSession({ orgId: ORG, userId: "u1", role: "viewer" })
  })

  it("400 missing company", async () => {
    const res = await GET(makeRequest(url({ company: "" })))
    expect(res.status).toBe(400)
  })

  it("400 missing indicator", async () => {
    const res = await GET(makeRequest(url({ indicator: "" })))
    expect(res.status).toBe(400)
  })

  it("400 when both company code and companyId are supplied", async () => {
    const res = await GET(makeRequest(url({ companyId: "comp_aac" })))
    expect(res.status).toBe(400)
  })

  it("400 invalid period format", async () => {
    const res = await GET(makeRequest(url({ period: "not-a-period" })))
    expect(res.status).toBe(400)
  })

  it("accepts annual period (YYYY)", async () => {
    const res = await GET(makeRequest(url({ period: "2026" })))
    expect(res.status).toBe(200)
  })

  it("accepts quarterly (YYYY-Q[1-4])", async () => {
    const res = await GET(makeRequest(url({ period: "2026-Q3" })))
    expect(res.status).toBe(200)
  })

  it("accepts monthly (YYYY-MM)", async () => {
    const res = await GET(makeRequest(url({ period: "2026-04" })))
    expect(res.status).toBe(200)
  })
})

describe("GET — resolution path", () => {
  beforeEach(async () => {
    await mockSession({ orgId: ORG, userId: "u1", role: "viewer" })
  })

  it("happy path — returns indicatorValueId + companyId + indicatorId", async () => {
    const res = await GET(makeRequest(url()))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      indicatorValueId: "iv_xyz",
      companyId: "comp_aac",
      indicatorId: "ind_rev_growth",
    })
    // Cross-tenant guard: company query scoped to session.orgId
    expect(prismaMock.company.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORG,
          code: "AAC",
        },
      }),
    )
  })

  it("accepts a stable company id from an AlertEvent deep link", async () => {
    const res = await GET(makeRequest(companyIdUrl()))
    expect(res.status).toBe(200)
    expect(prismaMock.company.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORG,
          id: "comp_aac",
        },
      }),
    )
  })

  it("companyId is deterministic even when another company code collides", async () => {
    prismaMock.company.findFirst.mockImplementation(({ where }: { where: { id?: string; code?: string } }) =>
      Promise.resolve(where.id ? { id: "comp_aac" } : { id: "wrong_company" }),
    )
    const res = await GET(makeRequest(companyIdUrl("comp_aac")))
    expect(res.status).toBe(200)
    expect((await res.json()).companyId).toBe("comp_aac")
    expect(prismaMock.company.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG, id: "comp_aac" } }),
    )
  })

  it("404 when a stable company id is outside subgroup scope", async () => {
    scopeMock.mockResolvedValue({ ids: new Set(["different_company"]), bypassed: false })
    const res = await GET(makeRequest(companyIdUrl()))
    expect(res.status).toBe(404)
    expect(prismaMock.indicatorDefinition.findFirst).not.toHaveBeenCalled()
  })

  it("404 when company code not in org", async () => {
    prismaMock.company.findFirst.mockResolvedValue(null)
    const res = await GET(makeRequest(url({ company: "GHOST" })))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/Company not found/)
    // Did not proceed to indicator lookup
    expect(prismaMock.indicatorDefinition.findFirst).not.toHaveBeenCalled()
  })

  it("404 when indicator code not in org or global", async () => {
    prismaMock.indicatorDefinition.findFirst.mockResolvedValue(null)
    const res = await GET(makeRequest(url({ indicator: "GHOST_IND" })))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/Indicator not found/)
    expect(prismaMock.indicatorValue.findUnique).not.toHaveBeenCalled()
  })

  it("404 when no IV computed for triplet", async () => {
    prismaMock.indicatorValue.findUnique.mockResolvedValue(null)
    const res = await GET(makeRequest(url()))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/No IndicatorValue/)
  })

  it("indicator lookup includes both org-specific + global (OR clause)", async () => {
    await GET(makeRequest(url()))
    const callArgs = prismaMock.indicatorDefinition.findFirst.mock.calls[0][0]
    expect(callArgs.where.OR).toEqual([
      { organizationId: ORG },
      { organizationId: null },
    ])
  })
})
