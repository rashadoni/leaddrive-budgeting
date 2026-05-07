// @vitest-environment node
/**
 * Phase 7.G Turn LXIII — handler tests for `/api/budgeting/cash-flow/generate`.
 *
 * Closes Turn-LXII Tier 2 H1 (top-3 untested critical handlers). Smoke-level:
 * auth gate + JSON parse + Zod gates + happy-path empty-data short-circuit.
 * Full cash-flow generation correctness needs fixtures + golden-output
 * (Tier 3 territory).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    cashFlowEntry: {
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    cashFlowAlert: {
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    budgetPlan: { findMany: vi.fn() },
    budgetLine: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.cashFlowEntry.deleteMany.mockReset().mockResolvedValue({ count: 0 })
  prismaMock.cashFlowEntry.findMany.mockReset().mockResolvedValue([])
  prismaMock.cashFlowEntry.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.cashFlowEntry.create.mockReset()
  prismaMock.cashFlowAlert.deleteMany.mockReset().mockResolvedValue({ count: 0 })
  prismaMock.cashFlowAlert.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.cashFlowAlert.create.mockReset()
  prismaMock.budgetPlan.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([])
})

describe("POST /api/budgeting/cash-flow/generate — gates", () => {
  it("returns 401 unauth", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow/generate", {
        method: "POST",
        json: { year: 2025 },
      }),
    )
    expect(res.status).toBe(401)
    expect(prismaMock.cashFlowEntry.deleteMany).not.toHaveBeenCalled()
  })

  it("returns 400 on Zod — missing year", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow/generate", {
        method: "POST",
        json: {},
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 on Zod — year out of range", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow/generate", {
        method: "POST",
        json: { year: 1900 },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 on Zod .strict() — unknown key", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow/generate", {
        method: "POST",
        json: { year: 2025, organizationId: "evil_org" },
      }),
    )
    expect(res.status).toBe(400)
  })
})

describe("POST /api/budgeting/cash-flow/generate — happy path", () => {
  it("returns 200 + clears old entries scoped by org+year+source", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow/generate", {
        method: "POST",
        json: { year: 2025 },
      }),
    )
    expect(res.status).toBe(200)
    // Org-scoped delete
    const delArg = prismaMock.cashFlowEntry.deleteMany.mock.calls[0][0]
    expect(delArg.where.organizationId).toBe(ORG_ID)
    expect(delArg.where.year).toBe(2025)
    expect(delArg.where.source).toBe("budget_line")
    // Empty plans → no creates fire
    expect(prismaMock.cashFlowEntry.create).not.toHaveBeenCalled()
  })

  it("returns 200 with `created` count when no plans exist", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow/generate", {
        method: "POST",
        json: { year: 2025 },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(true)
    expect(body.entriesCreated).toBe(0)
    expect(body.year).toBe(2025)
    // Plan query filtered by org + year + non-rolling
    const planArg = prismaMock.budgetPlan.findMany.mock.calls[0][0]
    expect(planArg.where.organizationId).toBe(ORG_ID)
    expect(planArg.where.year).toBe(2025)
    expect(planArg.where.isRolling).toBe(false)
  })
})
