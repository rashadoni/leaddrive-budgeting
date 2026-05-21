// @vitest-environment node
/**
 * Handler test for `/api/budgeting/changelog` (GET + POST undo).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetChangeLog: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
    budgetLine: { updateMany: vi.fn() },
    user: { findMany: vi.fn() },
    // Phase 5.2 Stage 2 — withOrgScope wraps changelog reads + undo mutations.
    $transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
    ),
    $executeRawUnsafe: vi.fn(async () => 1),
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

// Phase 5.2 — withOrgScope validates 20-32 char cuid-shaped orgId.
const ORG_ID = "cm3rlschangelog000001abc"

beforeEach(() => {
  prismaMock.budgetChangeLog.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetChangeLog.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.budgetChangeLog.deleteMany.mockReset().mockResolvedValue({ count: 1 })
  prismaMock.budgetLine.updateMany.mockReset().mockResolvedValue({ count: 1 })
  prismaMock.user.findMany.mockReset().mockResolvedValue([])
})

describe("GET /api/budgeting/changelog", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/changelog?planId=p1"))
    expect(res.status).toBe(401)
  })

  it("400 missing planId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/changelog"))
    expect(res.status).toBe(400)
  })

  it("200 org-scoped + take 50 + desc order", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/changelog?planId=p1"))
    expect(prismaMock.budgetChangeLog.findMany).toHaveBeenCalledWith({
      where: { planId: "p1", organizationId: ORG_ID },
      orderBy: { createdAt: "desc" },
      take: 50,
    })
  })

  it("resolves userId → userName from User table", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetChangeLog.findMany.mockResolvedValue([
      {
        id: "c1",
        userId: "u-actor",
        action: "update",
        entityType: "line",
        entityId: "l1",
        field: "plannedAmount",
        oldValue: 100,
        newValue: 200,
        snapshot: { category: "Rent" },
        createdAt: new Date("2026-05-17"),
      },
    ])
    prismaMock.user.findMany.mockResolvedValue([
      { id: "u-actor", name: "Alice" },
    ])
    const res = await GET(makeRequest("/api/budgeting/changelog?planId=p1"))
    const body = await res.json()
    expect(body.data.items[0].userName).toBe("Alice")
  })

  it("renders 'System' when userId is null", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetChangeLog.findMany.mockResolvedValue([
      {
        id: "c1",
        userId: null,
        action: "update",
        entityType: "line",
        entityId: "l1",
        field: "plannedAmount",
        snapshot: null,
        createdAt: new Date(),
      },
    ])
    const res = await GET(makeRequest("/api/budgeting/changelog?planId=p1"))
    const body = await res.json()
    expect(body.data.items[0].userName).toBe("System")
  })
})

describe("POST /api/budgeting/changelog (undo)", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/changelog", {
        method: "POST",
        json: { changeId: "c1" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 missing changeId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/changelog", {
        method: "POST",
        json: {},
      }),
    )
    expect(res.status).toBe(400)
  })

  it("404 changeId not in org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.budgetChangeLog.findFirst.mockResolvedValue(null)
    const res = await POST(
      makeRequest("/api/budgeting/changelog", {
        method: "POST",
        json: { changeId: "c-other" },
      }),
    )
    expect(res.status).toBe(404)
  })

  it("400 when change is not an undo-able field update (e.g. create)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.budgetChangeLog.findFirst.mockResolvedValue({
      id: "c1",
      action: "create", // not update
      entityType: "line",
      entityId: "l1",
      field: "plannedAmount",
      oldValue: 100,
    })
    const res = await POST(
      makeRequest("/api/budgeting/changelog", {
        method: "POST",
        json: { changeId: "c1" },
      }),
    )
    expect(res.status).toBe(400)
    expect(prismaMock.budgetLine.updateMany).not.toHaveBeenCalled()
  })

  it("200 reverts plannedAmount + deletes the changelog row", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.budgetChangeLog.findFirst.mockResolvedValue({
      id: "c1",
      action: "update",
      entityType: "line",
      entityId: "l1",
      field: "plannedAmount",
      oldValue: 100,
      newValue: 200,
    })
    const res = await POST(
      makeRequest("/api/budgeting/changelog", {
        method: "POST",
        json: { changeId: "c1" },
      }),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.budgetLine.updateMany).toHaveBeenCalledWith({
      where: { id: "l1", organizationId: ORG_ID },
      data: { plannedAmount: 100 }, // reverted to oldValue
    })
    expect(prismaMock.budgetChangeLog.deleteMany).toHaveBeenCalledWith({
      where: { id: "c1", organizationId: ORG_ID },
    })
  })

  it("404 when target line not in org (updateMany count=0)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.budgetChangeLog.findFirst.mockResolvedValue({
      id: "c1",
      action: "update",
      entityType: "line",
      entityId: "l-other",
      field: "plannedAmount",
      oldValue: 100,
    })
    prismaMock.budgetLine.updateMany.mockResolvedValue({ count: 0 })
    const res = await POST(
      makeRequest("/api/budgeting/changelog", {
        method: "POST",
        json: { changeId: "c1" },
      }),
    )
    expect(res.status).toBe(404)
  })
})
