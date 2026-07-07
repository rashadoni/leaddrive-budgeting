// @vitest-environment node
/**
 * Handler test for `/api/budgeting/templates/[id]` (PUT + DELETE).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetDirectionTemplate: { update: vi.fn(), delete: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { PUT, DELETE } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetDirectionTemplate.update.mockReset().mockResolvedValue({ id: "t1" })
  prismaMock.budgetDirectionTemplate.delete.mockReset().mockResolvedValue({ id: "t1" })
})

describe("PUT /api/budgeting/templates/[id]", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await PUT(
      makeRequest("/api/budgeting/templates/t1", { method: "PUT", json: { name: "X" } }),
      { params: Promise.resolve({ id: "t1" }) },
    )
    expect(res.status).toBe(401)
  })

  it("400 invalid JSON", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const req = new Request("http://localhost/api/budgeting/templates/t1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{not json",
    })
    const res = await PUT(req as never, { params: Promise.resolve({ id: "t1" }) })
    expect(res.status).toBe(400)
  })

  it("400 negative defaultAmount", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await PUT(
      makeRequest("/api/budgeting/templates/t1", {
        method: "PUT",
        json: { defaultAmount: -1 },
      }),
      { params: Promise.resolve({ id: "t1" }) },
    )
    expect(res.status).toBe(400)
  })

  it("200 happy path with partial update + org-scoped where", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await PUT(
      makeRequest("/api/budgeting/templates/t1", {
        method: "PUT",
        json: { name: "  New Name  ", defaultAmount: 500 },
      }),
      { params: Promise.resolve({ id: "t1" }) },
    )
    expect(res.status).toBe(200)
    expect(prismaMock.budgetDirectionTemplate.update).toHaveBeenCalledWith({
      where: { id: "t1", organizationId: ORG_ID },
      data: expect.objectContaining({
        name: "New Name", // trimmed
        defaultAmount: 500,
      }),
    })
  })

  it("partial update: only supplied fields go to data", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    await PUT(
      makeRequest("/api/budgeting/templates/t1", {
        method: "PUT",
        json: { isActive: false }, // ONLY isActive
      }),
      { params: Promise.resolve({ id: "t1" }) },
    )
    const callArgs = prismaMock.budgetDirectionTemplate.update.mock.calls[0][0]
    expect(callArgs.data).toEqual({ isActive: false })
    // name, defaultAmount, etc. NOT in data
    expect(callArgs.data.name).toBeUndefined()
    expect(callArgs.data.defaultAmount).toBeUndefined()
  })
})

describe("DELETE /api/budgeting/templates/[id]", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await DELETE(
      makeRequest("/api/budgeting/templates/t1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "t1" }) },
    )
    expect(res.status).toBe(401)
  })

  it("200 with org-scoped delete", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await DELETE(
      makeRequest("/api/budgeting/templates/t1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "t1" }) },
    )
    expect(res.status).toBe(200)
    expect(prismaMock.budgetDirectionTemplate.delete).toHaveBeenCalledWith({
      where: { id: "t1", organizationId: ORG_ID },
    })
  })
})
