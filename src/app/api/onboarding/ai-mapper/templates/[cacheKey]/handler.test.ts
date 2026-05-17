/**
 * Handler tests for DELETE /api/onboarding/ai-mapper/templates/[cacheKey].
 * Locks: auth, URI-decode of cacheKey, cross-tenant guard
 * (cacheKey's orgId must match session.orgId or 404), 404 when no
 * such template, 200 on successful delete.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const { deleteMock } = vi.hoisted(() => ({ deleteMock: vi.fn() }))
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/onboarding/ai-mapper/proposal-cache", () => ({
  deleteTemplate: deleteMock,
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { DELETE } from "./route"

const ORG_A = "cmtestorga0000000000000a01"
const ORG_B = "cmtestorgb0000000000000b02"
const HASH = "abc123def456"

function paramsFor(cacheKey: string) {
  return { params: Promise.resolve({ cacheKey: encodeURIComponent(cacheKey) }) }
}

beforeEach(() => {
  deleteMock.mockReset()
})

describe("DELETE /api/onboarding/ai-mapper/templates/[cacheKey]", () => {
  const validKey = `${ORG_A}:${HASH}:v1:m1`

  it("401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await DELETE(
      makeRequest(`/api/onboarding/ai-mapper/templates/${encodeURIComponent(validKey)}`, {
        method: "DELETE",
      }),
      paramsFor(validKey),
    )
    expect(res.status).toBe(401)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it("403 when role is viewer", async () => {
    await mockSession({ orgId: ORG_A, userId: "u1", role: "viewer" })
    const res = await DELETE(
      makeRequest(`/api/onboarding/ai-mapper/templates/${encodeURIComponent(validKey)}`, {
        method: "DELETE",
      }),
      paramsFor(validKey),
    )
    expect(res.status).toBe(403)
  })

  it("400 on malformed cacheKey shape (not 4 segments)", async () => {
    await mockSession({ orgId: ORG_A, userId: "u1", role: "manager" })
    const malformed = `${ORG_A}:onlytwo`
    const res = await DELETE(
      makeRequest(`/api/onboarding/ai-mapper/templates/${encodeURIComponent(malformed)}`, {
        method: "DELETE",
      }),
      paramsFor(malformed),
    )
    expect(res.status).toBe(400)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it("404 when cacheKey's orgId belongs to another tenant (no existence leak)", async () => {
    await mockSession({ orgId: ORG_A, userId: "u1", role: "manager" })
    const otherOrgKey = `${ORG_B}:${HASH}:v1:m1`
    const res = await DELETE(
      makeRequest(`/api/onboarding/ai-mapper/templates/${encodeURIComponent(otherOrgKey)}`, {
        method: "DELETE",
      }),
      paramsFor(otherOrgKey),
    )
    expect(res.status).toBe(404)
    // Critical: never reach the lib for a cross-tenant key.
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it("404 when lib reports no such template", async () => {
    await mockSession({ orgId: ORG_A, userId: "u1", role: "manager" })
    deleteMock.mockResolvedValue(false)
    const res = await DELETE(
      makeRequest(`/api/onboarding/ai-mapper/templates/${encodeURIComponent(validKey)}`, {
        method: "DELETE",
      }),
      paramsFor(validKey),
    )
    expect(res.status).toBe(404)
    expect(deleteMock).toHaveBeenCalledWith(validKey)
  })

  it("200 + { deleted: true } when lib reports removal", async () => {
    await mockSession({ orgId: ORG_A, userId: "u1", role: "manager" })
    deleteMock.mockResolvedValue(true)
    const res = await DELETE(
      makeRequest(`/api/onboarding/ai-mapper/templates/${encodeURIComponent(validKey)}`, {
        method: "DELETE",
      }),
      paramsFor(validKey),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deleted).toBe(true)
  })
})
