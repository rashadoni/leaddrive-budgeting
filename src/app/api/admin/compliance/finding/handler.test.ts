/**
 * Handler tests for PATCH /api/admin/compliance/finding (Phase 8 E1).
 *
 * Locks the close / reopen / assign / comment flow, the org-scope
 * 404 guard, and the in-place items[]+summary update.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    company: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { PATCH } from "./route"

const ORG_ID = "cmcompliancetestorg00000001"
const USER_ID = "u_admin"
const COMPANY_ID = "cmcompliancetestcompany0001"

function baseFinding(overrides: Record<string, unknown> = {}) {
  return {
    severity: "Major",
    audit: "Process control",
    status: "icra olunur",
    grouping: "Operations",
    findingStatusJan: "open",
    ...overrides,
  }
}

beforeEach(() => {
  prismaMock.company.findFirst.mockReset()
  prismaMock.company.update.mockReset().mockResolvedValue({})
})

describe("PATCH /api/admin/compliance/finding", () => {
  it("401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await PATCH(
      makeRequest("/api/admin/compliance/finding", {
        method: "PATCH",
        json: { companyId: COMPANY_ID, findingIdx: 0, action: "close" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("403 when role is manager (admin-only)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "manager" })
    const res = await PATCH(
      makeRequest("/api/admin/compliance/finding", {
        method: "PATCH",
        json: { companyId: COMPANY_ID, findingIdx: 0, action: "close" },
      }),
    )
    expect(res.status).toBe(403)
  })

  it("400 when body fields are missing or wrong types", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "admin" })

    const cases = [
      { companyId: COMPANY_ID, findingIdx: 0, action: "frobnicate" },
      { companyId: COMPANY_ID, findingIdx: -1, action: "close" },
      { findingIdx: 0, action: "close" },
      { companyId: COMPANY_ID, action: "close" },
      { companyId: COMPANY_ID, findingIdx: 0, action: "assign" }, // missing value
    ]
    for (const body of cases) {
      const res = await PATCH(
        makeRequest("/api/admin/compliance/finding", {
          method: "PATCH",
          json: body,
        }),
      )
      expect(res.status).toBe(400)
    }
  })

  it("404 when company is outside the caller's org", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "admin" })
    prismaMock.company.findFirst.mockResolvedValue(null)
    const res = await PATCH(
      makeRequest("/api/admin/compliance/finding", {
        method: "PATCH",
        json: { companyId: COMPANY_ID, findingIdx: 0, action: "close" },
      }),
    )
    expect(res.status).toBe(404)
  })

  it("close marks the finding closed + appends a mutation log + recomputes summary", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "admin" })
    const items = [baseFinding(), baseFinding({ severity: "Minor" })]
    prismaMock.company.findFirst.mockResolvedValue({
      id: COMPANY_ID,
      code: "AZSEKER-AZSF",
      settings: {
        auditFindings: {
          items,
          summary: { total: 2, completed: 0, completedPct: 0 },
        },
      },
    })
    const res = await PATCH(
      makeRequest("/api/admin/compliance/finding", {
        method: "PATCH",
        json: { companyId: COMPANY_ID, findingIdx: 0, action: "close" },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.finding.closed).toBe(true)
    expect(body.finding.closedBy).toBe(USER_ID)
    expect(typeof body.finding.closedAt).toBe("string")
    expect(Array.isArray(body.finding.mutations)).toBe(true)
    expect(body.finding.mutations[0].action).toBe("close")
    expect(body.summary.completed).toBe(1)
    expect(body.summary.completedPct).toBe(50)

    // Persisted via prisma.company.update with the merged settings blob.
    expect(prismaMock.company.update).toHaveBeenCalledTimes(1)
    const call = prismaMock.company.update.mock.calls[0][0]
    expect(call.where.id).toBe(COMPANY_ID)
    const persistedItems = call.data.settings.auditFindings.items
    expect(persistedItems[0].closed).toBe(true)
    expect(persistedItems[1].closed).toBeUndefined()
  })

  it("reopen flips closed back to false + clears closedAt/closedBy", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "admin" })
    prismaMock.company.findFirst.mockResolvedValue({
      id: COMPANY_ID,
      code: "AZSEKER-AZSF",
      settings: {
        auditFindings: {
          items: [
            baseFinding({
              closed: true,
              closedAt: "2026-05-26T00:00:00Z",
              closedBy: "u_other",
            }),
          ],
          summary: { total: 1, completed: 1, completedPct: 100 },
        },
      },
    })
    const res = await PATCH(
      makeRequest("/api/admin/compliance/finding", {
        method: "PATCH",
        json: { companyId: COMPANY_ID, findingIdx: 0, action: "reopen" },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.finding.closed).toBe(false)
    expect(body.finding.closedAt).toBeUndefined()
    expect(body.finding.closedBy).toBeUndefined()
    expect(body.summary.completed).toBe(0)
    expect(body.summary.completedPct).toBe(0)
  })

  it("409 when company has no auditFindings to mutate", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "admin" })
    prismaMock.company.findFirst.mockResolvedValue({
      id: COMPANY_ID,
      code: "AZSEKER-AZSF",
      settings: {},
    })
    const res = await PATCH(
      makeRequest("/api/admin/compliance/finding", {
        method: "PATCH",
        json: { companyId: COMPANY_ID, findingIdx: 0, action: "close" },
      }),
    )
    expect(res.status).toBe(409)
  })

  it("400 when findingIdx is past the end of items[]", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "admin" })
    prismaMock.company.findFirst.mockResolvedValue({
      id: COMPANY_ID,
      code: "AZSEKER-AZSF",
      settings: { auditFindings: { items: [baseFinding()] } },
    })
    const res = await PATCH(
      makeRequest("/api/admin/compliance/finding", {
        method: "PATCH",
        json: { companyId: COMPANY_ID, findingIdx: 99, action: "close" },
      }),
    )
    expect(res.status).toBe(400)
  })
})
