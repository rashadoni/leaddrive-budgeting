/**
 * Phase 7.N — handler tests for PATCH/GET /api/companies/[id]/risk-tags.
 *
 * Covers: auth gate, 404 on cross-tenant, merge behavior (existing
 * industry settings preserved), tag validation, audit emission.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findFirst: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
    user: { findFirst: vi.fn().mockResolvedValue({ allowedSubGroupIds: [] }) },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

const { rateLimitMock } = vi.hoisted(() => ({
  rateLimitMock: {
    enforceRateLimit: vi.fn().mockReturnValue(null),
    getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
  },
}))
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit")
  return { ...actual, ...rateLimitMock }
})

import { mockSession, makeRequest } from "@/test/api-harness"
import { PATCH, GET } from "./route"

const CO_ID = "co_eden"
const ORG_ID = "org_az"

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) }
}

const baseCompany = {
  id: CO_ID,
  code: "AZSEKER-EDEN",
  industry: "agro_crops",
  settings: { hectaresPlanted: 4000, region: "salyan" },
}

beforeEach(() => {
  prismaMock.company.findFirst.mockReset()
  prismaMock.company.update.mockReset().mockResolvedValue({})
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
  rateLimitMock.enforceRateLimit.mockReturnValue(null)
})

describe("PATCH /api/companies/[id]/risk-tags", () => {
  it("returns 401 when unauthenticated", async () => {
    await mockSession(null)
    const req = makeRequest(`/api/companies/${CO_ID}/risk-tags`, {
      method: "PATCH",
      json: { riskTags: [] },
    })
    const res = await PATCH(req, paramsFor(CO_ID))
    expect(res.status).toBe(401)
  })

  it("returns 404 when company belongs to different org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue(null)
    const req = makeRequest(`/api/companies/${CO_ID}/risk-tags`, {
      method: "PATCH",
      json: { riskTags: ["data_absence"] },
    })
    const res = await PATCH(req, paramsFor(CO_ID))
    expect(res.status).toBe(404)
  })

  it("returns 400 for invalid tag", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue(baseCompany)
    const req = makeRequest(`/api/companies/${CO_ID}/risk-tags`, {
      method: "PATCH",
      json: { riskTags: ["bad_tag"] },
    })
    const res = await PATCH(req, paramsFor(CO_ID))
    expect(res.status).toBe(400)
    expect(prismaMock.company.update).not.toHaveBeenCalled()
  })

  it("merges riskTags without wiping existing industry settings", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue(baseCompany)
    const req = makeRequest(`/api/companies/${CO_ID}/risk-tags`, {
      method: "PATCH",
      json: { riskTags: ["subsidy_dependency", "data_absence"] },
    })
    const res = await PATCH(req, paramsFor(CO_ID))
    expect(res.status).toBe(200)

    const updateCall = prismaMock.company.update.mock.calls[0][0]
    const written = updateCall.data.settings
    // Existing industry fields preserved
    expect(written.hectaresPlanted).toBe(4000)
    expect(written.region).toBe("salyan")
    // riskTags merged
    expect(written.riskTags).toEqual(["subsidy_dependency", "data_absence"])
  })

  it("clears riskTags when empty array sent", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue({
      ...baseCompany,
      settings: { ...baseCompany.settings, riskTags: ["data_absence"] },
    })
    const req = makeRequest(`/api/companies/${CO_ID}/risk-tags`, {
      method: "PATCH",
      json: { riskTags: [] },
    })
    const res = await PATCH(req, paramsFor(CO_ID))
    expect(res.status).toBe(200)
    const written = prismaMock.company.update.mock.calls[0][0].data.settings
    expect(written.riskTags).toEqual([])
  })

  it("emits company_settings_update audit event with keysChanged=[riskTags]", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_cfo", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue(baseCompany)
    const req = makeRequest(`/api/companies/${CO_ID}/risk-tags`, {
      method: "PATCH",
      json: { riskTags: ["non_transparent_structure"] },
    })
    await PATCH(req, paramsFor(CO_ID))
    await Promise.resolve()
    await Promise.resolve()

    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(1)
    const audit = prismaMock.auditEvent.create.mock.calls[0][0]
    expect(audit.data.action).toBe("company_settings_update")
    expect(audit.data.metadata.keysChanged).toEqual(["riskTags"])
    expect(audit.data.metadata.after).toEqual({ riskTags: ["non_transparent_structure"] })
  })
})

describe("GET /api/companies/[id]/risk-tags", () => {
  it("returns empty array when no riskTags set", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.company.findFirst.mockResolvedValue(baseCompany)
    const req = makeRequest(`/api/companies/${CO_ID}/risk-tags`, { method: "GET" })
    const res = await GET(req, paramsFor(CO_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.riskTags).toEqual([])
  })

  it("filters out unknown tags from stored settings", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.company.findFirst.mockResolvedValue({
      ...baseCompany,
      settings: { riskTags: ["subsidy_dependency", "obsolete_tag"] },
    })
    const req = makeRequest(`/api/companies/${CO_ID}/risk-tags`, { method: "GET" })
    const res = await GET(req, paramsFor(CO_ID))
    const body = await res.json()
    expect(body.riskTags).toEqual(["subsidy_dependency"])
  })
})
