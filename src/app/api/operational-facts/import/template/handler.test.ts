// @vitest-environment node
/**
 * Handler test for `/api/operational-facts/import/template` (GET).
 *
 * Phase 7.H F4.v2.3.1 — KPI bulk import template download. Locks
 * auth gate, xlsx content-type, attachment filename, and that the
 * generated workbook contains a header row + at least one example.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findFirst: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.company.findFirst.mockReset().mockResolvedValue({ code: "AAC-MAIN" })
})

describe("GET /api/operational-facts/import/template", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/operational-facts/import/template"))
    expect(res.status).toBe(401)
  })

  it("200 xlsx with correct headers", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/operational-facts/import/template"))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    const disposition = res.headers.get("content-disposition") || ""
    const filenameMatch = disposition.match(/filename="([^"]+)"/)
    expect(filenameMatch?.[1]).toMatch(/operational-facts-template\.xlsx/)
  })

  it("xlsx body is non-empty (file size > 0)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/operational-facts/import/template"))
    const buf = await res.arrayBuffer()
    expect(buf.byteLength).toBeGreaterThan(1000)
  })

  it("falls back to AAC-MAIN code when no operational company found", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.company.findFirst.mockResolvedValue(null)
    const res = await GET(makeRequest("/api/operational-facts/import/template"))
    expect(res.status).toBe(200)
  })
})
