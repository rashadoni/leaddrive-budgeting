import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  prismaMock,
  enumerateActiveOrgsMock,
  listApiKeysMock,
  getCommodityAdaptersMock,
  ingestCommodityDataMock,
  runRecomputeForCompaniesMock,
} = vi.hoisted(() => ({
  prismaMock: {
    company: { findMany: vi.fn() },
    organization: { findUnique: vi.fn(), update: vi.fn() },
  },
  enumerateActiveOrgsMock: vi.fn(),
  listApiKeysMock: vi.fn(),
  getCommodityAdaptersMock: vi.fn(),
  ingestCommodityDataMock: vi.fn(),
  runRecomputeForCompaniesMock: vi.fn(),
}))

vi.mock("@/lib/db/prisma-admin", () => ({ prismaAdmin: prismaMock }))
vi.mock("@/lib/intel/scheduler-bootstrap", () => ({
  enumerateActiveOrgs: enumerateActiveOrgsMock,
}))
vi.mock("@/lib/intel/api-keys", () => ({ listApiKeys: listApiKeysMock }))
vi.mock("@/lib/intel/commodity", () => ({
  getCommodityAdapters: getCommodityAdaptersMock,
}))
vi.mock("@/lib/intel/commodity/ingest", () => ({
  ingestCommodityData: ingestCommodityDataMock,
}))
vi.mock("@/lib/risk/recompute-trigger", () => ({
  runRecomputeForCompanies: runRecomputeForCompaniesMock,
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
  getCommodityAdaptersMock.mockReset().mockImplementation(({ apiKeys }) => [
    { source: `eia:${apiKeys.eia}`, label: "fixture", fetch: vi.fn() },
  ])
  ingestCommodityDataMock.mockReset().mockResolvedValue({
    pointsWritten: 2,
    errors: [],
    perSource: [],
  })
  prismaMock.company.findMany.mockReset().mockResolvedValue([])
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ settings: {} })
  prismaMock.organization.update.mockReset().mockResolvedValue({})
  runRecomputeForCompaniesMock.mockReset()
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
    expect(getCommodityAdaptersMock.mock.calls).toEqual([
      [{ apiKeys: expect.objectContaining({ eia: "org-a-eia-key" }) }],
      [{ apiKeys: expect.objectContaining({ eia: "org-b-eia-key" }) }],
    ])
    expect(ingestCommodityDataMock.mock.calls).toEqual([
      ["org-a", [expect.objectContaining({ source: "eia:org-a-eia-key" })]],
      ["org-b", [expect.objectContaining({ source: "eia:org-b-eia-key" })]],
    ])
    expect(body.orgs).toEqual([
      expect.objectContaining({ orgId: "org-a", pointsWritten: 2, feedErrors: 0 }),
      expect.objectContaining({ orgId: "org-b", pointsWritten: 2, feedErrors: 0 }),
    ])
  })
})
