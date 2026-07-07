// @vitest-environment node
/**
 * R3 — handler tests for GET|POST /api/trade/pacing.
 * Locks: auth, POST delegates to the shared recompute lib (R1) and
 * returns its org/channel results; GET returns null result without a
 * snapshot but still ships the live cascade.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, recomputeMock, buildInputMock } = vi.hoisted(() => ({
  prismaMock: {
    tradePacingSnapshot: { findFirst: vi.fn(), findMany: vi.fn() },
    tradeChannel: { findMany: vi.fn() },
  },
  recomputeMock: vi.fn(),
  buildInputMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/trade/pacing-recompute", () => ({
  recomputeTradePacing: recomputeMock,
  buildPacingInput: buildInputMock,
  ORG_GRAIN: "org",
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_trade_test_000000000001"
const CASCADE = { budget: 100, committed: 0, accrued: 0, actual: 0, control: 0, available: 100 }

beforeEach(() => {
  prismaMock.tradePacingSnapshot.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.tradePacingSnapshot.findMany.mockReset().mockResolvedValue([])
  prismaMock.tradeChannel.findMany.mockReset().mockResolvedValue([])
  buildInputMock.mockReset().mockResolvedValue({ input: {}, cascade: CASCADE })
  recomputeMock.mockReset().mockResolvedValue({
    period: "2026-07",
    org: { result: { riskStatus: "ok" }, cascade: CASCADE },
    channels: { "channel:ch1": { result: { riskStatus: "critical" }, cascade: CASCADE } },
    alerts: { created: 1, updated: 0, resolved: 0 },
  })
})

describe("GET /api/trade/pacing", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    expect((await GET(makeRequest("/api/trade/pacing"))).status).toBe(401)
  })

  it("no snapshot → null result but live cascade + empty channels", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/trade/pacing"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result).toBeNull()
    expect(body.cascade).toEqual(CASCADE)
    expect(body.channels).toEqual([])
  })
})

describe("POST /api/trade/pacing", () => {
  it("403 for viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    expect((await POST(makeRequest("/api/trade/pacing", { method: "POST" }))).status).toBe(403)
  })

  it("delegates to recomputeTradePacing and returns its outcome", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(makeRequest("/api/trade/pacing?period=2026-07", { method: "POST" }))
    expect(res.status).toBe(200)
    expect(recomputeMock).toHaveBeenCalledWith(prismaMock, ORG_ID, 2026, 7)
    const body = await res.json()
    expect(body.result.riskStatus).toBe("ok")
    expect(Object.keys(body.channels)).toEqual(["channel:ch1"])
    expect(body.alerts).toEqual({ created: 1, updated: 0, resolved: 0 })
  })
})
