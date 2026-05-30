// @vitest-environment node
/**
 * Handler test for `/api/budgeting/lines/count` (GET).
 *
 * Lightweight count-only endpoint. Phase 7.G perf gate — replaces
 * a 4.3MB `/lines` fetch with a ~200-byte `{count}` response so
 * TemplateSeedButton can short-circuit without full data download.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetLine: { count: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetLine.count.mockReset().mockResolvedValue(0)
})

describe("GET /api/budgeting/lines/count", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/lines/count?planId=p1"))
    expect(res.status).toBe(401)
  })

  it("400 missing planId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/lines/count"))
    expect(res.status).toBe(400)
  })

  it("200 with {count: 0} when no lines exist", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/lines/count?planId=p1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ count: 0 })
  })

  it("200 with non-zero count + org-scoped query", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetLine.count.mockResolvedValue(4321)
    const res = await GET(makeRequest("/api/budgeting/lines/count?planId=p1"))
    const body = await res.json()
    expect(body.count).toBe(4321)
    // Phase 8: count honors soft-delete — live lines only.
    expect(prismaMock.budgetLine.count).toHaveBeenCalledWith({
      where: { planId: "p1", organizationId: ORG_ID, deletedAt: null },
    })
  })
})
