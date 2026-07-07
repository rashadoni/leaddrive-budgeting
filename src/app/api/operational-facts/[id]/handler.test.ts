// @vitest-environment node
/**
 * Handler test for `/api/operational-facts/[id]` (DELETE).
 *
 * Phase 7.H F4.v2.3 — single-row delete with audit event.
 * Admin-only; refuses silent 200 on missing row.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    operationalFact: { findFirst: vi.fn(), delete: vi.fn() },
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

import { mockSession, makeRequest } from "@/test/api-harness"
import { DELETE } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.operationalFact.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.operationalFact.delete.mockReset().mockResolvedValue({ id: "f1" })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
})

describe("DELETE /api/operational-facts/[id]", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await DELETE(
      makeRequest("/api/operational-facts/f1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "f1" }) },
    )
    expect(res.status).toBe(401)
  })

  it("403 below admin (manager rejected)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await DELETE(
      makeRequest("/api/operational-facts/f1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "f1" }) },
    )
    expect(res.status).toBe(403)
    expect(prismaMock.operationalFact.delete).not.toHaveBeenCalled()
  })

  it("404 fact not found in org (NOT silent 200)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.operationalFact.findFirst.mockResolvedValue(null)
    const res = await DELETE(
      makeRequest("/api/operational-facts/f-bogus", { method: "DELETE" }),
      { params: Promise.resolve({ id: "f-bogus" }) },
    )
    expect(res.status).toBe(404)
    expect(prismaMock.operationalFact.delete).not.toHaveBeenCalled()
  })

  it("200 happy path deletes + would-emit audit event (fire-and-forget)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.operationalFact.findFirst.mockResolvedValue({
      id: "f1",
      companyId: "c1",
      metric: "yield_per_ha",
      date: new Date("2026-05-17"),
      value: 60,
      unit: "tons/ha",
    })
    const res = await DELETE(
      makeRequest("/api/operational-facts/f1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "f1" }) },
    )
    expect(res.status).toBe(200)
    expect(prismaMock.operationalFact.delete).toHaveBeenCalledWith({
      where: { id: "f1" },
    })
  })

  it("findFirst is org-scoped (cross-tenant safe)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    await DELETE(
      makeRequest("/api/operational-facts/f1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "f1" }) },
    )
    expect(prismaMock.operationalFact.findFirst).toHaveBeenCalledWith({
      where: { id: "f1", organizationId: ORG_ID },
      select: expect.any(Object),
    })
  })
})
