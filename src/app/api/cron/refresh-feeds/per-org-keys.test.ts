import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  prismaMock,
  enumerateActiveOrgsMock,
  listApiKeysMock,
  getScheduledFreeFeedAdaptersMock,
  ingestCommodityDataMock,
  runRecomputeForCompaniesMock,
  acquireRefreshFeedsLockMock,
  releaseLockMock,
} = vi.hoisted(() => ({
  prismaMock: {
    company: { findMany: vi.fn() },
    organization: { findUnique: vi.fn(), update: vi.fn() },
  },
  enumerateActiveOrgsMock: vi.fn(),
  listApiKeysMock: vi.fn(),
  getScheduledFreeFeedAdaptersMock: vi.fn(),
  ingestCommodityDataMock: vi.fn(),
  runRecomputeForCompaniesMock: vi.fn(),
  acquireRefreshFeedsLockMock: vi.fn(),
  releaseLockMock: vi.fn(),
}))

vi.mock("@/lib/db/prisma-admin", () => ({ prismaAdmin: prismaMock }))
vi.mock("@/lib/intel/scheduler-bootstrap", () => ({
  enumerateActiveOrgs: enumerateActiveOrgsMock,
}))
vi.mock("@/lib/intel/api-keys", () => ({ listApiKeys: listApiKeysMock }))
vi.mock("@/lib/intel/commodity", () => ({
  getScheduledFreeFeedAdapters: getScheduledFreeFeedAdaptersMock,
}))
vi.mock("@/lib/intel/commodity/ingest", () => ({
  ingestCommodityData: ingestCommodityDataMock,
}))
vi.mock("@/lib/risk/recompute-trigger", () => ({
  runRecomputeForCompanies: runRecomputeForCompaniesMock,
}))
vi.mock("@/lib/intel/refresh-feeds-lock", () => ({
  acquireRefreshFeedsLock: acquireRefreshFeedsLockMock,
}))

import { GET } from "./route"
import type { NextRequest } from "next/server"

function makeRequest(secret: string): NextRequest {
  return {
    headers: { get: (key: string) => (key === "authorization" ? `Bearer ${secret}` : null) },
  } as unknown as NextRequest
}

const originalSecret = process.env.CRON_SECRET

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret"
  enumerateActiveOrgsMock.mockReset().mockResolvedValue([
    { id: "org-a" },
    { id: "org-b" },
  ])
  listApiKeysMock.mockReset().mockImplementation(async (_prisma, orgId: string) => ({
    eia: `${orgId}-eia-key`,
    usda: null,
    gtrends: null,
    anthropic: null,
  }))
  getScheduledFreeFeedAdaptersMock.mockReset().mockImplementation(({ apiKeys }) => ({
    adapters: [
      { source: `eia:${apiKeys.eia}`, label: "fixture", fetch: vi.fn() },
    ],
    skipped: [
      { source: "google-trends-az", reason: "paid_source_disabled" },
    ],
  }))
  ingestCommodityDataMock.mockReset().mockResolvedValue({
    pointsWritten: 2,
    errors: [],
    perSource: [
      {
        source: "fixture",
        dataPoints: [{ metric: "X" }],
        errors: [],
        fetched: true,
      },
    ],
  })
  prismaMock.company.findMany.mockReset().mockResolvedValue([])
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ settings: {} })
  prismaMock.organization.update.mockReset().mockResolvedValue({})
  runRecomputeForCompaniesMock.mockReset()
  releaseLockMock.mockReset().mockResolvedValue(undefined)
  acquireRefreshFeedsLockMock.mockReset().mockResolvedValue({
    acquired: true,
    release: releaseLockMock,
  })
})

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = originalSecret
})

describe("GET /api/cron/refresh-feeds — per-org credentials", () => {
  it("constructs a separate adapter set from each organization's stored keys", async () => {
    const response = await GET(makeRequest("cron-secret"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(listApiKeysMock.mock.calls).toEqual([
      [prismaMock, "org-a"],
      [prismaMock, "org-b"],
    ])
    expect(getScheduledFreeFeedAdaptersMock.mock.calls).toEqual([
      [{ apiKeys: expect.objectContaining({ eia: "org-a-eia-key" }) }],
      [{ apiKeys: expect.objectContaining({ eia: "org-b-eia-key" }) }],
    ])
    expect(ingestCommodityDataMock.mock.calls).toEqual([
      ["org-a", [expect.objectContaining({ source: "eia:org-a-eia-key" })]],
      ["org-b", [expect.objectContaining({ source: "eia:org-b-eia-key" })]],
    ])
    expect(body.orgs).toEqual([
      expect.objectContaining({
        orgId: "org-a",
        status: "ok",
        pointsWritten: 2,
        feedErrors: 0,
        heartbeatPersisted: true,
      }),
      expect.objectContaining({
        orgId: "org-b",
        status: "ok",
        pointsWritten: 2,
        feedErrors: 0,
        heartbeatPersisted: true,
      }),
    ])
    expect(releaseLockMock).toHaveBeenCalledOnce()
    for (const call of prismaMock.organization.update.mock.calls) {
      const settings = call[0].data.settings
      expect(settings).toEqual(
        expect.objectContaining({
          feedRefreshLastRunStatus: "ok",
          feedRefreshLastRunPointsWritten: 2,
          feedRefreshLastRunErrorCount: 0,
        }),
      )
      expect(settings).not.toHaveProperty("intelLastRunAt")
    }
  })

  it("returns 409 without provider work when another refresh owns the lock", async () => {
    acquireRefreshFeedsLockMock.mockResolvedValue({
      acquired: false,
      release: releaseLockMock,
    })

    const response = await GET(makeRequest("cron-secret"))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      ok: false,
      error: "refresh_already_running",
    })
    expect(enumerateActiveOrgsMock).not.toHaveBeenCalled()
    expect(ingestCommodityDataMock).not.toHaveBeenCalled()
    expect(releaseLockMock).toHaveBeenCalledOnce()
  })

  it("returns 502 and persists a failed heartbeat when every feed fails", async () => {
    enumerateActiveOrgsMock.mockResolvedValue([{ id: "org-a" }])
    ingestCommodityDataMock.mockResolvedValue({
      pointsWritten: 0,
      errors: ["eia-energy: HTTP 429"],
      perSource: [
        {
          source: "eia-energy",
          dataPoints: [],
          errors: ["HTTP 429"],
          fetched: true,
        },
      ],
    })

    const response = await GET(makeRequest("cron-secret"))
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body.ok).toBe(false)
    expect(body.orgs[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        successfulSources: 0,
        feedErrors: 2,
        heartbeatPersisted: true,
      }),
    )
    expect(prismaMock.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          settings: expect.objectContaining({
            feedRefreshLastRunStatus: "failed",
            feedRefreshLastRunErrorCount: 2,
          }),
        },
      }),
    )
    expect(releaseLockMock).toHaveBeenCalledOnce()
  })

  it("returns 502 for a degraded partial feed run so the scheduler retries", async () => {
    enumerateActiveOrgsMock.mockResolvedValue([{ id: "org-a" }])
    getScheduledFreeFeedAdaptersMock.mockReturnValue({
      adapters: [
        { source: "healthy", label: "healthy", fetch: vi.fn() },
        { source: "broken", label: "broken", fetch: vi.fn() },
      ],
      skipped: [],
    })
    ingestCommodityDataMock.mockResolvedValue({
      pointsWritten: 1,
      errors: ["broken: HTTP 429"],
      perSource: [
        {
          source: "healthy",
          dataPoints: [{ metric: "X" }],
          errors: [],
          fetched: true,
        },
        {
          source: "broken",
          dataPoints: [],
          errors: ["HTTP 429"],
          fetched: true,
        },
      ],
    })

    const response = await GET(makeRequest("cron-secret"))
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body.ok).toBe(false)
    expect(body.degraded).toBe(true)
    expect(body.orgs[0]).toEqual(
      expect.objectContaining({
        status: "degraded",
        configuredSources: 2,
        successfulSources: 1,
        feedErrors: 1,
        heartbeatPersisted: true,
      }),
    )
    expect(prismaMock.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          settings: expect.objectContaining({
            feedRefreshLastRunStatus: "degraded",
            feedRefreshLastRunErrorCount: 1,
          }),
        },
      }),
    )
    expect(releaseLockMock).toHaveBeenCalledOnce()
  })

  it("returns 502 when the durable heartbeat cannot be persisted", async () => {
    enumerateActiveOrgsMock.mockResolvedValue([{ id: "org-a" }])
    prismaMock.organization.update.mockRejectedValue(new Error("write denied"))

    const response = await GET(makeRequest("cron-secret"))
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body.orgs[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        heartbeatPersisted: false,
        feedErrors: 1,
      }),
    )
    expect(releaseLockMock).toHaveBeenCalledOnce()
  })
})
