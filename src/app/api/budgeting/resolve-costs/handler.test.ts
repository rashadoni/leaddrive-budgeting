// @vitest-environment node
/**
 * Handler test for `/api/budgeting/resolve-costs` (POST).
 *
 * Locks the TemplateSeedButton pre-fill path: keys array → resolved
 * cost-model values. Uses strict zod (extra fields rejected) and
 * gracefully degrades when cost model is unavailable.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

const { loadAndComputeMock } = vi.hoisted(() => ({
  loadAndComputeMock: vi.fn(),
}))
vi.mock("@/lib/cost-model/db", () => ({ loadAndCompute: loadAndComputeMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  loadAndComputeMock.mockReset().mockResolvedValue(null)
})

describe("POST /api/budgeting/resolve-costs", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/resolve-costs", {
        method: "POST",
        json: { keys: ["adminOverhead"] },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 missing keys", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/resolve-costs", {
        method: "POST",
        json: {},
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 keys array empty (zod min(1))", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/resolve-costs", {
        method: "POST",
        json: { keys: [] },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 keys array > 100 hard cap", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const tooMany = Array.from({ length: 101 }, (_, i) => `key${i}`)
    const res = await POST(
      makeRequest("/api/budgeting/resolve-costs", {
        method: "POST",
        json: { keys: tooMany },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 strict zod: extra fields rejected", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/resolve-costs", {
        method: "POST",
        json: { keys: ["x"], orgId: "evil-injection" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("200 with empty data when cost model unavailable (graceful degradation)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    loadAndComputeMock.mockResolvedValue(null)
    const res = await POST(
      makeRequest("/api/budgeting/resolve-costs", {
        method: "POST",
        json: { keys: ["adminOverhead", "coreLabor"] },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, data: {} })
  })

  it("200 with resolved values when cost model has data", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    loadAndComputeMock.mockResolvedValue({
      adminOverhead: 5000,
      coreLabor: 12000,
    })
    const res = await POST(
      makeRequest("/api/budgeting/resolve-costs", {
        method: "POST",
        json: { keys: ["adminOverhead", "coreLabor", "missing"] },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.adminOverhead).toBe(5000)
    expect(body.data.coreLabor).toBe(12000)
    expect(body.data.missing).toBe(0) // resolveCostModelKey returns 0 for unknown
  })
})
