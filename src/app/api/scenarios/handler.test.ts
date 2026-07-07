// @vitest-environment node
/**
 * Handler tests for `/api/scenarios` (GET list + POST create).
 *
 * Phase 7.N: POST now creates a scenario (admin-only) instead of the
 * old "apply/queue 202" stub which was dead code (Phase 7.N's simulate
 * endpoint replaced it).
 *
 * Locks:
 * - GET: 401 unauth / 403 no-orgId / 200 org-scoped results / orderBy
 * - POST: 401 unauth / 403 below-admin / 400 bad schema / 409 duplicate code /
 *         201 happy path with correct data shape
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    scenario: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
// Stage 3 RLS — hand the mock straight to the scope callback.
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_demo"
const USER_ID = "u_admin"

const VALID_BODY = {
  code: "SUGAR_DROP_20",
  nameEn: "Sugar drops 20%",
  nameRu: "Сахар −20%",
  description: "Commodity shock",
  overrides: {
    adjustments: [
      { codes: ["AGRO_SUGAR_PRICE_TREND"], multiply: 0.8, note: "sugar −20%" },
    ],
  },
  isActive: true,
}

beforeEach(() => {
  prismaMock.scenario.findMany.mockReset().mockResolvedValue([])
  prismaMock.scenario.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.scenario.create.mockReset().mockResolvedValue({
    id: "sc_new",
    organizationId: ORG_ID,
    ...VALID_BODY,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// POST — create scenario (admin-only)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/scenarios", () => {
  it("401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(makeRequest("/api/scenarios", { method: "POST", json: VALID_BODY }))
    expect(res.status).toBe(401)
    expect(prismaMock.scenario.create).not.toHaveBeenCalled()
  })

  it("403 when role is below admin (editor cannot create scenarios)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "editor" })
    const res = await POST(makeRequest("/api/scenarios", { method: "POST", json: VALID_BODY }))
    expect(res.status).toBe(403)
    expect(prismaMock.scenario.create).not.toHaveBeenCalled()
  })

  it("400 when code is missing", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "admin" })
    const { code: _code, ...noCode } = VALID_BODY
    const res = await POST(makeRequest("/api/scenarios", { method: "POST", json: noCode }))
    expect(res.status).toBe(400)
    expect(prismaMock.scenario.create).not.toHaveBeenCalled()
  })

  it("400 when code has invalid characters (lowercase)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "admin" })
    const res = await POST(
      makeRequest("/api/scenarios", {
        method: "POST",
        json: { ...VALID_BODY, code: "bad-code-123" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 when overrides.adjustments is empty array", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "admin" })
    const res = await POST(
      makeRequest("/api/scenarios", {
        method: "POST",
        json: { ...VALID_BODY, overrides: { adjustments: [] } },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("409 on duplicate scenario code within same org (P2002)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "admin" })
    const p2002Err = Object.assign(new Error("Unique constraint"), { code: "P2002" })
    prismaMock.scenario.create.mockRejectedValue(p2002Err)
    const res = await POST(makeRequest("/api/scenarios", { method: "POST", json: VALID_BODY }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already exists/)
  })

  it("201 happy path — scenario created, org scoped", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "admin" })
    const res = await POST(makeRequest("/api/scenarios", { method: "POST", json: VALID_BODY }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe("sc_new")
    expect(prismaMock.scenario.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          code: "SUGAR_DROP_20",
        }),
      }),
    )
  })
})
