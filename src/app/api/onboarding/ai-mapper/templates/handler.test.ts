/**
 * Handler tests for `/api/onboarding/ai-mapper/templates`.
 * Mocks the proposal-cache lib so the tests don't touch Prisma; assert
 * auth gate, validation, and the contract with the lib helpers.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const { promoteMock, listMock } = vi.hoisted(() => ({
  promoteMock: vi.fn(),
  listMock: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/onboarding/ai-mapper/proposal-cache", () => ({
  promoteCacheEntryToTemplate: promoteMock,
  listTemplates: listMock,
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "cmtest1234567890abcde0001"

const VALID_INPUT = {
  sourceFile: "AZMADE_2026.xlsx",
  sourceSheet: "P&L",
  columns: [
    { index: 0, headerText: "Account", samples: ["701-01", "711-01"] },
    { index: 1, headerText: "Jan", samples: [1000, 2000] },
  ],
  sampleRows: [
    ["701-01", 1000],
    ["711-01", 2000],
  ],
  companyContext: { name: "AAC-MAIN", industry: "industrial" },
}

beforeEach(() => {
  promoteMock.mockReset()
  listMock.mockReset()
})

describe("GET /api/onboarding/ai-mapper/templates", () => {
  it("returns 401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/onboarding/ai-mapper/templates"))
    expect(res.status).toBe(401)
    expect(listMock).not.toHaveBeenCalled()
  })

  it("returns 403 when role is viewer (manager+ required)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/onboarding/ai-mapper/templates"))
    expect(res.status).toBe(403)
  })

  it("200 returns templates list scoped to caller's org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    listMock.mockResolvedValue([
      {
        cacheKey: `${ORG_ID}:hash1:v1:m1`,
        templateName: "AZMADE 2026 P&L",
        structureHash: "hash1",
        applyCount: 4,
        lastUsedAt: 1747400000000,
        cachedAt: 1747300000000,
      },
    ])
    const res = await GET(makeRequest("/api/onboarding/ai-mapper/templates"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.templates).toHaveLength(1)
    expect(body.templates[0].templateName).toBe("AZMADE 2026 P&L")
    expect(listMock).toHaveBeenCalledWith(ORG_ID)
  })
})

describe("POST /api/onboarding/ai-mapper/templates", () => {
  it("returns 400 on invalid body (missing templateName)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/onboarding/ai-mapper/templates", {
        method: "POST",
        json: { input: VALID_INPUT },
      }),
    )
    expect(res.status).toBe(400)
    expect(promoteMock).not.toHaveBeenCalled()
  })

  it("returns 400 on invalid input shape (no columns)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/onboarding/ai-mapper/templates", {
        method: "POST",
        json: { input: { ...VALID_INPUT, columns: [] }, templateName: "X" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 404 when no cache entry exists for the structure (must /analyze first)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    promoteMock.mockResolvedValue(false) // lib signals "no entry"
    const res = await POST(
      makeRequest("/api/onboarding/ai-mapper/templates", {
        method: "POST",
        json: { input: VALID_INPUT, templateName: "AZMADE 2026 P&L" },
      }),
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/Run.*\/analyze.*first/)
  })

  it("200 promotes a cache entry to template + threads orgId/language correctly", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    promoteMock.mockResolvedValue(true)
    const res = await POST(
      makeRequest("/api/onboarding/ai-mapper/templates", {
        method: "POST",
        json: { input: VALID_INPUT, templateName: "AZMADE 2026 P&L", language: "ru" },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.promoted).toBe(true)
    expect(body.templateName).toBe("AZMADE 2026 P&L")
    expect(promoteMock).toHaveBeenCalledTimes(1)
    const [calledOrgId, calledInput, calledName, calledLang] = promoteMock.mock.calls[0]
    expect(calledOrgId).toBe(ORG_ID)
    expect(calledInput.sourceFile).toBe("AZMADE_2026.xlsx")
    expect(calledName).toBe("AZMADE 2026 P&L")
    expect(calledLang).toBe("ru")
  })

  it("returns 401 when unauthenticated (no promote)", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/onboarding/ai-mapper/templates", {
        method: "POST",
        json: { input: VALID_INPUT, templateName: "X" },
      }),
    )
    expect(res.status).toBe(401)
    expect(promoteMock).not.toHaveBeenCalled()
  })
})
