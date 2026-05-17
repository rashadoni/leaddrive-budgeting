// @vitest-environment node
/**
 * Handler test for `/api/budgeting/exchange-rates` (GET + POST).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    currencyRateHistory: { findMany: vi.fn(), create: vi.fn() },
    currency: { findMany: vi.fn(), updateMany: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.currencyRateHistory.findMany.mockReset().mockResolvedValue([])
  prismaMock.currencyRateHistory.create.mockReset().mockResolvedValue({ id: "r1" })
  prismaMock.currency.findMany.mockReset().mockResolvedValue([])
  prismaMock.currency.updateMany.mockReset().mockResolvedValue({ count: 1 })
})

describe("GET /api/budgeting/exchange-rates", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/exchange-rates"))
    expect(res.status).toBe(401)
  })

  it("200 with org-scoped rates + currencies (default limit 100)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/exchange-rates"))
    expect(res.status).toBe(200)
    expect(prismaMock.currencyRateHistory.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID },
      orderBy: { rateDate: "desc" },
      take: 100,
    })
    expect(prismaMock.currency.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID },
      }),
    )
    const body = await res.json()
    expect(body).toHaveProperty("rates")
    expect(body).toHaveProperty("currencies")
  })

  it("currencyCode filter applied to rates query", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(
      makeRequest("/api/budgeting/exchange-rates?currencyCode=USD"),
    )
    expect(prismaMock.currencyRateHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, currencyCode: "USD" },
      }),
    )
  })

  it("?limit=N respected", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/exchange-rates?limit=20"))
    expect(prismaMock.currencyRateHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    )
  })
})

describe("POST /api/budgeting/exchange-rates", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/exchange-rates", {
        method: "POST",
        json: { currencyCode: "USD", rate: 1.7 },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 missing currencyCode", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/exchange-rates", {
        method: "POST",
        json: { rate: 1.7 },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 missing rate", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/exchange-rates", {
        method: "POST",
        json: { currencyCode: "USD" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 strict zod: extra fields rejected", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/exchange-rates", {
        method: "POST",
        json: {
          currencyCode: "USD",
          rate: 1.7,
          organizationId: "evil-org",
        },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("201 happy path creates history + updates current rate in Currency", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/exchange-rates", {
        method: "POST",
        json: { currencyCode: "USD", rate: 1.7 },
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.currencyRateHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG_ID,
        currencyCode: "USD",
        rate: 1.7,
      }),
    })
    // Also updates the Currency table for convenience
    expect(prismaMock.currency.updateMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, code: "USD" },
      data: { exchangeRate: 1.7 },
    })
  })

  it("rate string is parsed to float", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    await POST(
      makeRequest("/api/budgeting/exchange-rates", {
        method: "POST",
        json: { currencyCode: "EUR", rate: "1.85" },
      }),
    )
    expect(prismaMock.currencyRateHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rate: 1.85 }),
      }),
    )
  })
})
