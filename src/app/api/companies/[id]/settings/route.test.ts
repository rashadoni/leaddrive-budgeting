// @vitest-environment node
/**
 * Phase 7.I — handler tests for /api/companies/[id]/settings.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { computeKeysChanged } from "./compute-keys-changed"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    user: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, PATCH } from "./route"

const ORG_ID = "org_demo"
const COMPANY_ID = "c_azseker_eden"

function buildParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  for (const fn of [
    prismaMock.company.findFirst,
    prismaMock.company.findMany,
    prismaMock.company.update,
    prismaMock.user.findFirst,
    prismaMock.auditEvent.create,
  ]) {
    fn.mockReset()
  }
  prismaMock.user.findFirst.mockResolvedValue({ allowedSubGroupIds: [] })
  prismaMock.auditEvent.create.mockResolvedValue({ id: "a_1" })
})

describe("computeKeysChanged — pure diff", () => {
  it("detects added, removed, and modified keys (sorted output)", () => {
    expect(
      computeKeysChanged(
        { region: "salyan", hectaresPlanted: 10000, cropType: "sugarcane" },
        { region: "imishli", hectaresPlanted: 12000, yieldTarget: 65 },
      ),
    ).toEqual(["cropType", "hectaresPlanted", "region", "yieldTarget"])
  })
  it("returns empty for identical objects", () => {
    expect(computeKeysChanged({ a: 1, b: 2 }, { a: 1, b: 2 })).toEqual([])
  })
  it("handles null before (initial settings)", () => {
    expect(computeKeysChanged(null, { region: "salyan" })).toEqual(["region"])
  })
})

describe("PATCH /api/companies/[id]/settings — agro_crops", () => {
  it("validates + persists + emits audit for an agro_crops company", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_m", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue({
      id: COMPANY_ID,
      code: "AZSEKER-EDEN",
      industry: "agro_crops",
      settings: null,
    })
    prismaMock.company.update.mockResolvedValue({})

    const res = await PATCH(
      makeRequest(`/api/companies/${COMPANY_ID}/settings`, {
        method: "PATCH",
        json: {
          hectaresPlanted: 12000,
          region: "salyan",
          cropType: "sugarcane",
          yieldTarget: 65,
        },
      }),
      buildParams(COMPANY_ID),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.company.update).toHaveBeenCalledTimes(1)
    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(1)
    const audit = prismaMock.auditEvent.create.mock.calls[0][0]
    expect(audit.data.action).toBe("company_settings_update")
    expect(audit.data.metadata.keysChanged).toContain("region")
    expect(audit.data.metadata.industry).toBe("agro_crops")
  })

  it("returns 400 when payload uses cross-industry keys (totalRooms on agro)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_m", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue({
      id: COMPANY_ID,
      code: "AZSEKER-EDEN",
      industry: "agro_crops",
      settings: null,
    })
    const res = await PATCH(
      makeRequest(`/api/companies/${COMPANY_ID}/settings`, {
        method: "PATCH",
        json: { totalRooms: 200 },
      }),
      buildParams(COMPANY_ID),
    )
    expect(res.status).toBe(400)
    expect(prismaMock.company.update).not.toHaveBeenCalled()
  })

  it("rejects viewer role with 403", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_v", role: "viewer" })
    const res = await PATCH(
      makeRequest(`/api/companies/${COMPANY_ID}/settings`, {
        method: "PATCH",
        json: { region: "salyan" },
      }),
      buildParams(COMPANY_ID),
    )
    expect(res.status).toBe(403)
  })

  it("returns 404 for cross-tenant company (no info leak)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_m", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue(null)
    const res = await PATCH(
      makeRequest(`/api/companies/${COMPANY_ID}/settings`, {
        method: "PATCH",
        json: { region: "salyan" },
      }),
      buildParams(COMPANY_ID),
    )
    expect(res.status).toBe(404)
  })

  it("emits sub-group RBAC 403 when company outside scope", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_m", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue({
      id: COMPANY_ID,
      code: "AZSEKER-EDEN",
      industry: "agro_crops",
      settings: null,
    })
    prismaMock.user.findFirst.mockResolvedValue({ allowedSubGroupIds: ["c_tabia"] })
    prismaMock.company.findMany.mockResolvedValue([]) // scope set empty for COMPANY_ID

    const res = await PATCH(
      makeRequest(`/api/companies/${COMPANY_ID}/settings`, {
        method: "PATCH",
        json: { region: "salyan" },
      }),
      buildParams(COMPANY_ID),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.company.update).not.toHaveBeenCalled()
  })
})

describe("GET /api/companies/[id]/settings — viewer-allowed read", () => {
  it("returns current settings for a viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_v", role: "viewer" })
    prismaMock.company.findFirst.mockResolvedValue({
      id: COMPANY_ID,
      code: "AZSEKER-EDEN",
      industry: "agro_crops",
      settings: { region: "salyan", hectaresPlanted: 12000 },
    })
    const res = await GET(
      makeRequest(`/api/companies/${COMPANY_ID}/settings`),
      buildParams(COMPANY_ID),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.settings.region).toBe("salyan")
    expect(body.industry).toBe("agro_crops")
  })
})
