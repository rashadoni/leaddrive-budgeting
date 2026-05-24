// @vitest-environment node
/**
 * Handler tests for `/api/scenarios/[id]` (GET single + PATCH update + DELETE soft-delete).
 *
 * Locks:
 * - GET:    401 unauth / 404 cross-tenant / 200 happy path
 * - PATCH:  401 unauth / 403 below-admin / 404 cross-tenant / 400 bad body /
 *           200 happy path with org-scope guard
 * - DELETE: 401 unauth / 403 below-admin / 404 cross-tenant /
 *           200 sets isActive=false (soft-delete)
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    scenario: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, PATCH, DELETE } from "./route"

const ORG_ID = "org_demo"
const USER_ID = "u_admin"
const SCENARIO_ID = "sc_123"

const EXISTING = {
  id: SCENARIO_ID,
  organizationId: ORG_ID,
  code: "AZN_DEVAL_20",
  nameEn: "AZN devalues 20%",
  nameRu: "Девальвация маната −20%",
  nameAz: null,
  description: "FX shock",
  overrides: {
    adjustments: [{ codes: ["FX_IMPORTED_INPUT"], multiply: 1.2, note: "AZN +20%" }],
  },
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}

function makeParams(id = SCENARIO_ID) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  prismaMock.scenario.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.scenario.update.mockReset().mockResolvedValue({ ...EXISTING })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/scenarios/[id]
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/scenarios/[id]", () => {
  it("401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest(`/api/scenarios/${SCENARIO_ID}`), makeParams())
    expect(res.status).toBe(401)
  })

  it("404 when scenario not in caller's org (no existence leak)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
    prismaMock.scenario.findFirst.mockResolvedValue(null)
    const res = await GET(makeRequest(`/api/scenarios/${SCENARIO_ID}`), makeParams())
    expect(res.status).toBe(404)
  })

  it("200 returns scenario for authenticated viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
    prismaMock.scenario.findFirst.mockResolvedValue(EXISTING)
    const res = await GET(makeRequest(`/api/scenarios/${SCENARIO_ID}`), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.code).toBe("AZN_DEVAL_20")
    // Lookup must be org-scoped
    expect(prismaMock.scenario.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SCENARIO_ID, organizationId: ORG_ID } }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/scenarios/[id]
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/scenarios/[id]", () => {
  it("401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await PATCH(
      makeRequest(`/api/scenarios/${SCENARIO_ID}`, { method: "PATCH", json: { nameEn: "X" } }),
      makeParams(),
    )
    expect(res.status).toBe(401)
  })

  it("403 when role is below admin", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "editor" })
    const res = await PATCH(
      makeRequest(`/api/scenarios/${SCENARIO_ID}`, { method: "PATCH", json: { nameEn: "X" } }),
      makeParams(),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.scenario.update).not.toHaveBeenCalled()
  })

  it("404 when scenario not in caller's org", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "admin" })
    prismaMock.scenario.findFirst.mockResolvedValue(null)
    const res = await PATCH(
      makeRequest(`/api/scenarios/${SCENARIO_ID}`, { method: "PATCH", json: { nameEn: "X" } }),
      makeParams(),
    )
    expect(res.status).toBe(404)
    expect(prismaMock.scenario.update).not.toHaveBeenCalled()
  })

  it("400 when adjustments array is empty", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "admin" })
    prismaMock.scenario.findFirst.mockResolvedValue(EXISTING)
    const res = await PATCH(
      makeRequest(`/api/scenarios/${SCENARIO_ID}`, {
        method: "PATCH",
        json: { overrides: { adjustments: [] } },
      }),
      makeParams(),
    )
    expect(res.status).toBe(400)
  })

  it("200 happy path — calls update with org-scoped check", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "admin" })
    prismaMock.scenario.findFirst.mockResolvedValue(EXISTING)
    prismaMock.scenario.update.mockResolvedValue({ ...EXISTING, nameEn: "Updated" })
    const res = await PATCH(
      makeRequest(`/api/scenarios/${SCENARIO_ID}`, {
        method: "PATCH",
        json: { nameEn: "Updated" },
      }),
      makeParams(),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.nameEn).toBe("Updated")
    // Guard must check org-scope BEFORE update
    expect(prismaMock.scenario.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SCENARIO_ID, organizationId: ORG_ID } }),
    )
    expect(prismaMock.scenario.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SCENARIO_ID } }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/scenarios/[id]
// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /api/scenarios/[id]", () => {
  it("401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await DELETE(makeRequest(`/api/scenarios/${SCENARIO_ID}`), makeParams())
    expect(res.status).toBe(401)
  })

  it("403 when role is below admin", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "editor" })
    const res = await DELETE(makeRequest(`/api/scenarios/${SCENARIO_ID}`), makeParams())
    expect(res.status).toBe(403)
    expect(prismaMock.scenario.update).not.toHaveBeenCalled()
  })

  it("404 when scenario not in caller's org", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "admin" })
    prismaMock.scenario.findFirst.mockResolvedValue(null)
    const res = await DELETE(makeRequest(`/api/scenarios/${SCENARIO_ID}`), makeParams())
    expect(res.status).toBe(404)
    expect(prismaMock.scenario.update).not.toHaveBeenCalled()
  })

  it("200 soft-deletes by setting isActive=false (row is preserved)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "admin" })
    prismaMock.scenario.findFirst.mockResolvedValue(EXISTING)
    prismaMock.scenario.update.mockResolvedValue({ ...EXISTING, isActive: false })
    const res = await DELETE(makeRequest(`/api/scenarios/${SCENARIO_ID}`), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deleted).toBe(true)
    // Must use isActive=false, NOT prisma.scenario.delete (hard delete)
    expect(prismaMock.scenario.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SCENARIO_ID },
        data: { isActive: false },
      }),
    )
  })
})
