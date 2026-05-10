// @vitest-environment node
/**
 * Phase 7.G Turn LXXXXI (Phase 5.1.2) — handler tests for
 * `/api/budgeting/chart-of-accounts/[id]` PUT.
 *
 * Locks: admin-only role gate, Zod CoARole enum validation,
 * cross-tenant guard via composite where-clause, 404 on missing/foreign id,
 * Zod .strict() rejects unknown keys (defense-in-depth vs accidental
 * `organizationId` rewrite from client).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    chartOfAccount: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { PUT } from "./route"

const ORG_ID = "org_demo"
const ACCOUNT_ID = "acc_601_01"

const stubParams = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  prismaMock.chartOfAccount.updateMany.mockReset().mockResolvedValue({ count: 1 })
  prismaMock.chartOfAccount.findUnique.mockReset().mockResolvedValue({
    id: ACCOUNT_ID,
    organizationId: ORG_ID,
    code: "601-01",
    name: "Sales — Goods",
    accountType: "revenue",
    role: "revenue",
  })
})

describe("PUT /api/budgeting/chart-of-accounts/[id] — auth gate", () => {
  it("returns 401 unauth", async () => {
    await mockSession(null)
    const res = await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: { role: "revenue" },
      }),
      stubParams(ACCOUNT_ID),
    )
    expect(res.status).toBe(401)
    expect(prismaMock.chartOfAccount.updateMany).not.toHaveBeenCalled()
  })

  it("returns 403 when viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: { role: "revenue" },
      }),
      stubParams(ACCOUNT_ID),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.chartOfAccount.updateMany).not.toHaveBeenCalled()
  })

  it("returns 403 when manager (admin-only mutation)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_mgr", role: "manager" })
    const res = await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: { role: "revenue" },
      }),
      stubParams(ACCOUNT_ID),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.chartOfAccount.updateMany).not.toHaveBeenCalled()
  })
})

describe("PUT — Zod validation", () => {
  beforeEach(async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
  })

  it("returns 400 on invalid role enum value", async () => {
    const res = await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: { role: "made_up_role" },
      }),
      stubParams(ACCOUNT_ID),
    )
    expect(res.status).toBe(400)
    expect(prismaMock.chartOfAccount.updateMany).not.toHaveBeenCalled()
  })

  it("returns 400 on Zod .strict() — unknown key", async () => {
    const res = await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: { role: "revenue", organizationId: "evil_org" },
      }),
      stubParams(ACCOUNT_ID),
    )
    expect(res.status).toBe(400)
    expect(prismaMock.chartOfAccount.updateMany).not.toHaveBeenCalled()
  })

  it("returns 400 on missing role field", async () => {
    const res = await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: {},
      }),
      stubParams(ACCOUNT_ID),
    )
    expect(res.status).toBe(400)
    expect(prismaMock.chartOfAccount.updateMany).not.toHaveBeenCalled()
  })

  it("returns 400 on invalid JSON body", async () => {
    const req = new Request(`http://localhost/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
      method: "PUT",
      body: "not json",
      headers: { "content-type": "application/json" },
    })
    const res = await PUT(req as unknown as Parameters<typeof PUT>[0], stubParams(ACCOUNT_ID))
    expect(res.status).toBe(400)
  })

  it("accepts null role (revert to derived default)", async () => {
    const res = await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: { role: null },
      }),
      stubParams(ACCOUNT_ID),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.chartOfAccount.updateMany).toHaveBeenCalledWith({
      where: { id: ACCOUNT_ID, organizationId: ORG_ID },
      data: { role: null },
    })
  })
})

describe("PUT — cross-tenant + happy path", () => {
  beforeEach(async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
  })

  it("happy path 200 — updates role + returns row", async () => {
    const res = await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: { role: "opex" },
      }),
      stubParams(ACCOUNT_ID),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.updated).toBe(true)
    expect(body.account.id).toBe(ACCOUNT_ID)
    expect(prismaMock.chartOfAccount.updateMany).toHaveBeenCalledWith({
      where: { id: ACCOUNT_ID, organizationId: ORG_ID },
      data: { role: "opex" },
    })
  })

  it("returns 404 when account belongs to a different org (updateMany count=0)", async () => {
    prismaMock.chartOfAccount.updateMany.mockResolvedValue({ count: 0 })
    const res = await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: { role: "opex" },
      }),
      stubParams(ACCOUNT_ID),
    )
    expect(res.status).toBe(404)
    expect(prismaMock.chartOfAccount.findUnique).not.toHaveBeenCalled()
  })

  it("composite where-clause: never updates without orgId match", async () => {
    await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: { role: "cogs" },
      }),
      stubParams(ACCOUNT_ID),
    )
    const callArgs = prismaMock.chartOfAccount.updateMany.mock.calls[0][0]
    expect(callArgs.where).toMatchObject({ organizationId: ORG_ID })
  })
})
