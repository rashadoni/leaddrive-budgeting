import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  prismaMock,
  listApiKeysMock,
  getCommodityAdaptersMock,
  ingestCommodityDataMock,
  enforceRateLimitMock,
} = vi.hoisted(() => ({
  prismaMock: {},
  listApiKeysMock: vi.fn(),
  getCommodityAdaptersMock: vi.fn(),
  ingestCommodityDataMock: vi.fn(),
  enforceRateLimitMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/prisma-admin", () => ({ prismaAdmin: prismaMock }))
vi.mock("@/lib/intel/api-keys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intel/api-keys")>()
  return { ...actual, listApiKeys: listApiKeysMock }
})
vi.mock("@/lib/intel/commodity", () => ({
  getCommodityAdapters: getCommodityAdaptersMock,
  ingestCommodityData: ingestCommodityDataMock,
}))
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: enforceRateLimitMock,
}))

import { mockSession } from "@/test/api-harness"
import { POST } from "./route"
import type { NextRequest } from "next/server"

const ORG_ID = "org_demo"
const adapter = (source: string) => ({
  source,
  label: source,
  fetch: vi.fn(),
})

async function makeRequest(source?: string): Promise<NextRequest> {
  const suffix = source === undefined ? "" : `?source=${encodeURIComponent(source)}`
  const { NextRequest } = await import("next/server")
  return new NextRequest(
    new Request(`http://localhost/api/admin/drift/refresh-source${suffix}`, {
      method: "POST",
    }),
  )
}

beforeEach(() => {
  listApiKeysMock.mockReset().mockResolvedValue({
    eia: null,
    usda: null,
    gtrends: null,
    anthropic: null,
  })
  getCommodityAdaptersMock.mockReset().mockImplementation(() => [
    adapter("weather-openmeteo"),
    adapter("eia-energy"),
    adapter("usda-nass"),
    adapter("google-trends-az"),
  ])
  ingestCommodityDataMock.mockReset().mockResolvedValue({
    pointsWritten: 3,
    errors: [],
    perSource: [
      { source: "eia-energy", dataPoints: [{}, {}, {}], fetched: true, errors: [] },
    ],
  })
  enforceRateLimitMock.mockReset().mockReturnValue(null)
})

describe("POST /api/admin/drift/refresh-source", () => {
  it("rejects unauthenticated callers", async () => {
    await mockSession(null)
    const response = await POST(await makeRequest("eia-energy"))
    expect(response.status).toBe(401)
  })

  it("validates sourceCode before reading keys or consuming rate limit", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const response = await POST(await makeRequest("not-a-source"))
    expect(response.status).toBe(404)
    expect(listApiKeysMock).not.toHaveBeenCalled()
    expect(enforceRateLimitMock).not.toHaveBeenCalled()
  })

  it("returns an actionable 424 for a missing EIA key without consuming quota", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const response = await POST(await makeRequest("eia-energy"))
    const body = await response.json()

    expect(response.status).toBe(424)
    expect(body).toMatchObject({
      code: "api_key_missing",
      sourceCode: "eia-energy",
      keySource: "eia",
      configurePath: "/budgeting/admin/api-keys",
    })
    expect(listApiKeysMock).toHaveBeenCalledWith(prismaMock, ORG_ID)
    expect(enforceRateLimitMock).not.toHaveBeenCalled()
    expect(ingestCommodityDataMock).not.toHaveBeenCalled()
  })

  it("threads the organization EIA key into the selected adapter", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const keys = {
      eia: "ORG_EIA_KEY_123",
      usda: null,
      gtrends: null,
      anthropic: null,
    }
    listApiKeysMock.mockResolvedValue(keys)

    const response = await POST(await makeRequest("eia-energy"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.inserted).toBe(3)
    expect(getCommodityAdaptersMock).toHaveBeenLastCalledWith({ apiKeys: keys })
    expect(enforceRateLimitMock).toHaveBeenCalledWith(
      `${ORG_ID}:eia-energy`,
      expect.objectContaining({ max: 1, windowMs: 60_000 }),
    )
    expect(ingestCommodityDataMock).toHaveBeenCalledWith(
      ORG_ID,
      [expect.objectContaining({ source: "eia-energy" })],
      { prisma: prismaMock },
    )
  })

  it("does not query organization keys for a public source", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    ingestCommodityDataMock.mockResolvedValue({
      pointsWritten: 1,
      errors: [],
      perSource: [
        { source: "weather-openmeteo", dataPoints: [{}], fetched: true, errors: [] },
      ],
    })

    const response = await POST(await makeRequest("weather-openmeteo"))
    expect(response.status).toBe(200)
    expect(listApiKeysMock).not.toHaveBeenCalled()
    expect(getCommodityAdaptersMock).toHaveBeenLastCalledWith({ apiKeys: undefined })
  })

  it("returns the limiter response before calling the provider", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    listApiKeysMock.mockResolvedValue({
      eia: "ORG_EIA_KEY_123",
      usda: null,
      gtrends: null,
      anthropic: null,
    })
    enforceRateLimitMock.mockReturnValue(
      new Response(
        JSON.stringify({
          error: "Too many requests",
          message: "Rate limit exceeded. Retry in 42s.",
          retryAfterSec: 42,
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "Retry-After": "42",
          },
        },
      ),
    )

    const response = await POST(await makeRequest("eia-energy"))
    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("42")
    expect(ingestCommodityDataMock).not.toHaveBeenCalled()
  })
})
