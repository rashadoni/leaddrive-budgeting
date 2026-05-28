/**
 * Handler tests for GET /api/terminal/strategic-context/[companyCode].
 *
 * Phase 8 A1 — Risk Registry block. The endpoint now returns a
 * `riskRegistry: { itemCount, source, importedAt, pendingVerification }`
 * for every level-2 operational company, with `pendingVerification`
 * true when the items[] is empty (5 of 6 entities today).
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "cmstratcontexttestorgid00001"

beforeEach(() => {
  prismaMock.company.findFirst.mockReset()
  prismaMock.organization.findUnique
    .mockReset()
    .mockResolvedValue({ settings: {} })
})

function paramsFor(code: string) {
  return { params: Promise.resolve({ companyCode: code }) }
}

describe("GET /api/terminal/strategic-context", () => {
  it("returns riskRegistry: null for level-1 holding root", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.company.findFirst.mockResolvedValue({
      id: "co_holding",
      code: "AZSEKER",
      name: "AZSEKER Holding",
      level: 1,
      settings: {},
    })
    const res = await GET(
      makeRequest("/api/terminal/strategic-context/AZSEKER"),
      paramsFor("AZSEKER"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.riskRegistry).toBeNull()
  })

  it("returns pendingVerification:true for level-2 with no Risk Registry data", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.company.findFirst.mockResolvedValue({
      id: "co_azsf",
      code: "AZSEKER-AZSF",
      name: "Azərşəkər Sugar",
      level: 2,
      settings: {},
    })
    const res = await GET(
      makeRequest("/api/terminal/strategic-context/AZSEKER-AZSF"),
      paramsFor("AZSEKER-AZSF"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.riskRegistry).toEqual({
      itemCount: 0,
      source: null,
      importedAt: null,
      pendingVerification: true,
    })
    expect(body.hasAnyContent).toBe(true)
  })

  it("returns itemCount + source for level-2 with populated Risk Registry (EDEN)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.company.findFirst.mockResolvedValue({
      id: "co_eden",
      code: "AZSEKER-EDEN",
      name: "Eden Agro",
      level: 2,
      settings: {
        riskRegistry: {
          items: Array.from({ length: 15 }, (_, i) => ({ kriId: `KRI-${i}` })),
          source: "Top risk - EDEN AGRO MMC.xlsx",
          importedAt: "2026-05-27T10:00:00Z",
        },
      },
    })
    const res = await GET(
      makeRequest("/api/terminal/strategic-context/AZSEKER-EDEN"),
      paramsFor("AZSEKER-EDEN"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.riskRegistry.itemCount).toBe(15)
    expect(body.riskRegistry.source).toBe("Top risk - EDEN AGRO MMC.xlsx")
    expect(body.riskRegistry.importedAt).toBe("2026-05-27T10:00:00Z")
    expect(body.riskRegistry.pendingVerification).toBe(false)
  })

  it("returns 404 when company doesn't belong to caller's org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.company.findFirst.mockResolvedValue(null)
    const res = await GET(
      makeRequest("/api/terminal/strategic-context/UNKNOWN"),
      paramsFor("UNKNOWN"),
    )
    expect(res.status).toBe(404)
  })
})
