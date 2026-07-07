// @vitest-environment node
/**
 * Handler test for `/api/indicator-disclosures/[id]` (DELETE).
 *
 * Phase 7.H F4.v2.3 — disclosure delete with fire-and-forget recompute.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    indicatorDisclosure: { findFirst: vi.fn(), delete: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
// Stage 3 RLS — hand the mock straight to the scope callback.
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
}))

const { runRecomputeMock } = vi.hoisted(() => ({
  runRecomputeMock: vi.fn().mockResolvedValue({}),
}))
vi.mock("@/lib/risk/recompute-trigger", () => ({
  runRecomputeForCompanies: runRecomputeMock,
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { DELETE } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.indicatorDisclosure.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.indicatorDisclosure.delete.mockReset().mockResolvedValue({ id: "d1" })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
  runRecomputeMock.mockReset().mockResolvedValue({})
})

describe("DELETE /api/indicator-disclosures/[id]", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await DELETE(
      makeRequest("/api/indicator-disclosures/d1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "d1" }) },
    )
    expect(res.status).toBe(401)
  })

  it("403 below admin", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await DELETE(
      makeRequest("/api/indicator-disclosures/d1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "d1" }) },
    )
    expect(res.status).toBe(403)
  })

  it("404 disclosure not found", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.indicatorDisclosure.findFirst.mockResolvedValue(null)
    const res = await DELETE(
      makeRequest("/api/indicator-disclosures/d-bogus", { method: "DELETE" }),
      { params: Promise.resolve({ id: "d-bogus" }) },
    )
    expect(res.status).toBe(404)
  })

  it("200 happy path: delete + queues post-delete recompute (year from period)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.indicatorDisclosure.findFirst.mockResolvedValue({
      id: "d1",
      companyId: "c1",
      indicatorCode: "IND_CARBON_SCOPE_1",
      period: "2026",
      value: 800,
      unit: "tCO2e",
    })
    const res = await DELETE(
      makeRequest("/api/indicator-disclosures/d1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "d1" }) },
    )
    expect(res.status).toBe(200)
    expect(prismaMock.indicatorDisclosure.delete).toHaveBeenCalledWith({
      where: { id: "d1" },
    })
    // Fire-and-forget recompute called with extracted year + indicator filter
    expect(runRecomputeMock).toHaveBeenCalledWith(
      prismaMock,
      ORG_ID,
      [{ companyId: "c1", year: 2026 }],
      {},
      { codeFilter: ["IND_CARBON_SCOPE_1"] },
    )
  })

  it("findFirst is org-scoped", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    await DELETE(
      makeRequest("/api/indicator-disclosures/d1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "d1" }) },
    )
    expect(prismaMock.indicatorDisclosure.findFirst).toHaveBeenCalledWith({
      where: { id: "d1", organizationId: ORG_ID },
      select: expect.any(Object),
    })
  })
})
