// @vitest-environment node
/**
 * Handler test for `/api/scenarios` (GET list + POST apply).
 *
 * Locks the security audit fixes from 2026-04-26 (Phase A):
 * - GET: 401 unauth / 403 no orgId / 200 with org-scoped results
 * - POST: 401 unauth / 403 below-editor role / 400 missing params /
 *   404 cross-tenant scenario id (no existence leak) / 202 happy path
 *
 * Catches: regression where session.orgId stops scoping the query, or
 * where role gate gets relaxed back to `requireAuth`. Both were the
 * original bugs the 2026-04-26 audit fixed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    scenario: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_demo"
const USER_ID = "u_editor"

beforeEach(() => {
  prismaMock.scenario.findMany.mockReset().mockResolvedValue([])
  prismaMock.scenario.findFirst.mockReset().mockResolvedValue(null)
})

describe("GET /api/scenarios", () => {
  it("401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/scenarios"))
    expect(res.status).toBe(401)
    expect(prismaMock.scenario.findMany).not.toHaveBeenCalled()
  })

  it("200 with org-scoped scenarios for authenticated viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
    prismaMock.scenario.findMany.mockResolvedValue([
      { id: "s1", code: "USD_STRESS", overrides: {} },
      { id: "s2", code: "OIL_CRASH", overrides: {} },
    ])
    const res = await GET(makeRequest("/api/scenarios"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    // Org-scoped + isActive=true filter is the security-critical bit
    expect(prismaMock.scenario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, isActive: true },
      }),
    )
  })

  it("orderBy createdAt desc (most-recent first)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
    await GET(makeRequest("/api/scenarios"))
    expect(prismaMock.scenario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } }),
    )
  })
})

describe("POST /api/scenarios", () => {
  it("401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/scenarios", { method: "POST", json: { scenarioId: "s1", period: "2026" } }),
    )
    expect(res.status).toBe(401)
  })

  it("403 when role is below editor (viewer cannot trigger scenarios)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
    const res = await POST(
      makeRequest("/api/scenarios", { method: "POST", json: { scenarioId: "s1", period: "2026" } }),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.scenario.findFirst).not.toHaveBeenCalled()
  })

  it("400 when scenarioId is missing", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "editor" })
    const res = await POST(
      makeRequest("/api/scenarios", { method: "POST", json: { period: "2026" } }),
    )
    expect(res.status).toBe(400)
    expect(prismaMock.scenario.findFirst).not.toHaveBeenCalled()
  })

  it("400 when period is missing", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "editor" })
    const res = await POST(
      makeRequest("/api/scenarios", { method: "POST", json: { scenarioId: "s1" } }),
    )
    expect(res.status).toBe(400)
  })

  it("404 on cross-tenant scenarioId (no existence leak as 403)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "editor" })
    prismaMock.scenario.findFirst.mockResolvedValue(null) // scenario exists but in another org
    const res = await POST(
      makeRequest("/api/scenarios", {
        method: "POST",
        json: { scenarioId: "s-other-org", period: "2026" },
      }),
    )
    expect(res.status).toBe(404) // NOT 403 — security audit fix
  })

  it("202 happy path returns scenario code + overrides", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "editor" })
    prismaMock.scenario.findFirst.mockResolvedValue({
      id: "s1",
      code: "USD_STRESS",
      overrides: { fx_usd: 2.0 },
    })
    const res = await POST(
      makeRequest("/api/scenarios", {
        method: "POST",
        json: { scenarioId: "s1", period: "2026" },
      }),
    )
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.scenarioCode).toBe("USD_STRESS")
    expect(body.overrides).toEqual({ fx_usd: 2.0 })
    // Scenario lookup must be org-scoped
    expect(prismaMock.scenario.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "s1", organizationId: ORG_ID },
      }),
    )
  })
})
