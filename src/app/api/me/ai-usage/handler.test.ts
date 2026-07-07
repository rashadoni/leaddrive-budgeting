/**
 * Handler tests for GET /api/me/ai-usage (Phase 7.O C2).
 *
 * Verifies:
 *  - 401 when unauthenticated
 *  - 200 returns today + MTD aggregated from AuditEvent.metadata
 *  - Today's slice is filtered correctly by createdAt boundary
 *  - Audit-query failure degrades to zeros (no 500)
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    auditEvent: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "cmtestmeaiusagedevorg00001"
const USER_ID = "u_cfo"

beforeEach(() => {
  prismaMock.auditEvent.findMany.mockReset().mockResolvedValue([])
})

describe("GET /api/me/ai-usage", () => {
  it("401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/me/ai-usage"))
    expect(res.status).toBe(401)
  })

  it("200 returns zeroed envelope when no AI calls recorded", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "manager" })
    const res = await GET(makeRequest("/api/me/ai-usage"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.today).toEqual({ tokensIn: 0, tokensOut: 0, calls: 0, total: 0 })
    expect(body.mtd).toEqual({ tokensIn: 0, tokensOut: 0, calls: 0, total: 0 })
    expect(typeof body.updatedAt).toBe("string")
  })

  it("200 aggregates tokensIn + tokensOut from AuditEvent rows", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "manager" })
    const now = new Date()
    prismaMock.auditEvent.findMany.mockResolvedValue([
      {
        metadata: { tokensIn: 800, tokensOut: 200 },
        createdAt: now,
      },
      {
        metadata: { tokensIn: 1200, tokensOut: 300 },
        createdAt: now,
      },
    ])
    const res = await GET(makeRequest("/api/me/ai-usage"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.today.total).toBe(2500)
    expect(body.today.calls).toBe(2)
    expect(body.mtd.total).toBe(2500)
    expect(body.mtd.calls).toBe(2)
  })

  it("excludes earlier-month rows from today's slice but counts them in MTD", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "manager" })
    const now = new Date()
    const yesterday = new Date(now.getTime() - 36 * 3600 * 1000) // 36h ago

    prismaMock.auditEvent.findMany.mockResolvedValue([
      // Today's call
      {
        metadata: { tokensIn: 1000, tokensOut: 500 },
        createdAt: now,
      },
      // Earlier this month (≥ 24h ago — outside today window)
      {
        metadata: { tokensIn: 5000, tokensOut: 2000 },
        createdAt: yesterday,
      },
    ])
    const res = await GET(makeRequest("/api/me/ai-usage"))
    const body = await res.json()
    expect(body.today.total).toBe(1500)
    expect(body.mtd.total).toBe(8500)
  })

  it("skips audit rows with no token metadata (non-AI events filtered)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "manager" })
    const now = new Date()
    prismaMock.auditEvent.findMany.mockResolvedValue([
      { metadata: { tokensIn: 0, tokensOut: 0 }, createdAt: now },
      { metadata: { tokensIn: 100, tokensOut: 50 }, createdAt: now },
      { metadata: {}, createdAt: now }, // missing fields
    ])
    const res = await GET(makeRequest("/api/me/ai-usage"))
    const body = await res.json()
    expect(body.today.total).toBe(150)
    expect(body.today.calls).toBe(1) // only the real one counted
  })

  it("degrades to zeros when audit-query throws (chip stays informational)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "manager" })
    prismaMock.auditEvent.findMany.mockRejectedValue(new Error("DB down"))
    const res = await GET(makeRequest("/api/me/ai-usage"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.today.total).toBe(0)
    expect(body.mtd.total).toBe(0)
  })
})
