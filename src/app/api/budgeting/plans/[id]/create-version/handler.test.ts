// @vitest-environment node
/**
 * Handler test for `/api/budgeting/plans/[id]/create-version` (POST).
 *
 * Locks plan-version snapshot semantics: manager-only gate, plan
 * cross-tenant 404, snapshotData write to original, new plan w/
 * version+1 + amendmentOf root id, and line clone.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    budgetLine: { create: vi.fn() },
    $queryRaw: vi.fn(),
    organization: { findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.budgetPlan.update.mockReset().mockResolvedValue({ id: "p1" })
  prismaMock.budgetPlan.create.mockReset().mockResolvedValue({ id: "p2", version: 2 })
  prismaMock.budgetLine.create.mockReset().mockResolvedValue({ id: "bl1" })
  prismaMock.$queryRaw.mockReset().mockResolvedValue([{ pg_advisory_xact_lock: null }])
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
})

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe("POST /api/budgeting/plans/[id]/create-version", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/plans/p1/create-version", { method: "POST" }),
      makeParams("p1"),
    )
    expect(res.status).toBe(401)
  })

  it("403 viewer (requires manager)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/plans/p1/create-version", { method: "POST" }),
      makeParams("p1"),
    )
    expect(res.status).toBe(403)
  })

  it("404 plan not in org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null)
    const res = await POST(
      makeRequest("/api/budgeting/plans/p1/create-version", { method: "POST" }),
      makeParams("p1"),
    )
    expect(res.status).toBe(404)
  })

  it("201 happy path — snapshotData on original + new plan v2", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({
      id: "p1",
      organizationId: ORG_ID,
      name: "Plan-A",
      periodType: "annual",
      year: 2026,
      month: null,
      quarter: null,
      notes: "n/a",
      kind: "budget",
      isRolling: false,
      rollingMonths: 12,
      amendmentOf: null,
      version: 1,
      lines: [
        { category: "Salaries", department: null, lineType: "expense", lineSubtype: null, plannedAmount: 1000, forecastAmount: null, costModelKey: null, isAutoPlanned: false, isAutoActual: false, costTypeId: null, departmentId: null, accountId: null, parentId: null, notes: null, sortOrder: 0, monthIndex: null },
        { category: "Rent",     department: null, lineType: "expense", lineSubtype: null, plannedAmount: 500,  forecastAmount: null, costModelKey: null, isAutoPlanned: false, isAutoActual: false, costTypeId: null, departmentId: null, accountId: null, parentId: null, notes: null, sortOrder: 1, monthIndex: null },
      ],
    })
    const res = await POST(
      makeRequest("/api/budgeting/plans/p1/create-version", { method: "POST" }),
      makeParams("p1"),
    )
    expect(res.status).toBe(201)
    // snapshotData written to ORIGINAL plan
    expect(prismaMock.budgetPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({ snapshotData: expect.any(Object) }),
      }),
    )
    // New plan created with version=2 + amendmentOf=p1 + status="draft"
    expect(prismaMock.budgetPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 2,
          amendmentOf: "p1",
          status: "draft",
          kind: "budget",
        }),
      }),
    )
    // Both lines cloned to new plan
    expect(prismaMock.budgetLine.create).toHaveBeenCalledTimes(2)
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
    // Regression (2026-05-31): the source-line load MUST exclude soft-deleted
    // lines, or archived budget lines get cloned into the new version and
    // resurrected as live rows. Lock the include filter.
    expect(prismaMock.budgetPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          lines: {
            where: { deletedAt: null },
            include: { account: { select: { code: true, name: true } } },
          },
        },
      }),
    )
  })

  it("uses amendmentOf (root) for version chain not the current id", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({
      id: "p2",
      organizationId: ORG_ID,
      name: "Plan-A",
      periodType: "annual",
      year: 2026,
      month: null,
      quarter: null,
      notes: null,
      kind: "budget",
      isRolling: false,
      rollingMonths: 12,
      amendmentOf: "p1", // p1 is the ROOT
      version: 2,
      lines: [],
    })
    await POST(
      makeRequest("/api/budgeting/plans/p2/create-version", { method: "POST" }),
      makeParams("p2"),
    )
    // amendmentOf on the new plan must point at the ROOT, not at p2
    const created = prismaMock.budgetPlan.create.mock.calls[0][0].data
    expect(created.amendmentOf).toBe("p1")
    expect(created.version).toBe(3)
  })

  it("allocates the next chain-wide version when creation starts from the root again", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetPlan.findFirst
      .mockResolvedValueOnce({
        id: "p1",
        organizationId: ORG_ID,
        name: "Plan-A",
        periodType: "annual",
        year: 2026,
        month: null,
        quarter: null,
        notes: null,
        kind: "budget",
        isRolling: false,
        rollingMonths: 12,
        amendmentOf: null,
        version: 1,
        lines: [],
      })
      .mockResolvedValueOnce({ version: 4 })

    await POST(
      makeRequest("/api/budgeting/plans/p1/create-version", { method: "POST" }),
      makeParams("p1"),
    )

    const created = prismaMock.budgetPlan.create.mock.calls[0][0].data
    expect(created.version).toBe(5)
    expect(created.versionLabel).toBe("v5")
    expect(created.kind).toBe("budget")
  })
})
