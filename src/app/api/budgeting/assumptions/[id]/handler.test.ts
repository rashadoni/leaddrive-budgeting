// @vitest-environment node
/**
 * Handler test for `/api/budgeting/assumptions/[id]` (PATCH + DELETE).
 *
 * Mirrors the `balance-sheet/[id]` shape: role gate, approved-plan guard,
 * period lock, audit-on-change — plus the Phase 7.Q cross-tenant company
 * guard, which is the one thing this route has that its siblings do not.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, logBudgetChangeMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetAssumption: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    budgetPlan: { findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  logBudgetChangeMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock, logBudgetChange: logBudgetChangeMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))

import { NextRequest } from "next/server"
import { mockSession, makeRequest } from "@/test/api-harness"
import { PATCH, DELETE } from "./route"

const ORG_ID = "org_demo"
const params = Promise.resolve({ id: "a1" })

const EXISTING = {
  id: "a1",
  organizationId: ORG_ID,
  planId: "p1",
  companyId: null,
  category: "fx",
  key: "import_share",
  label: "Imported input share",
  value: 0.3,
  unit: null,
  period: "annual",
  notes: null,
  sortOrder: 0,
}

function patchReq(json: unknown) {
  return makeRequest("/api/budgeting/assumptions/a1", { method: "PATCH", json })
}

beforeEach(() => {
  logBudgetChangeMock.mockReset()
  prismaMock.budgetAssumption.findFirst.mockReset().mockResolvedValue(EXISTING)
  prismaMock.budgetAssumption.updateMany.mockReset().mockResolvedValue({ count: 1 })
  prismaMock.budgetAssumption.deleteMany.mockReset().mockResolvedValue({ count: 1 })
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({
    id: "p1", status: "draft", periodType: "annual", year: 2026, month: null, quarter: null,
  })
  prismaMock.company.findFirst.mockReset().mockResolvedValue({ id: "cmp_sugar" })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "ae1" })
})

describe("PATCH /api/budgeting/assumptions/[id]", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    expect((await PATCH(patchReq({ value: 0.7 }), { params })).status).toBe(401)
  })

  it("403 for a viewer — write requires manager", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await PATCH(patchReq({ value: 0.7 }), { params })
    expect(res.status).toBe(403)
    expect(prismaMock.budgetAssumption.updateMany).not.toHaveBeenCalled()
  })

  it("400 on malformed JSON", async () => {
    // Built directly rather than through `makeRequest`, which JSON-encodes for
    // you and so cannot express a body that fails to parse.
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const req = new NextRequest("http://localhost/api/budgeting/assumptions/a1", {
      method: "PATCH",
      body: "{oops",
      headers: { "content-type": "application/json" },
    })
    expect((await PATCH(req, { params })).status).toBe(400)
  })

  it("400 on an empty patch", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    expect((await PATCH(patchReq({}), { params })).status).toBe(400)
  })

  it("404 when the row is not in this org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetAssumption.findFirst.mockResolvedValue(null)
    expect((await PATCH(patchReq({ value: 0.7 }), { params })).status).toBe(404)
  })

  it("403 when the plan is approved", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({ id: "p1", status: "approved" })
    const res = await PATCH(patchReq({ value: 0.7 }), { params })
    expect(res.status).toBe(403)
    expect(prismaMock.budgetAssumption.updateMany).not.toHaveBeenCalled()
  })

  it("423 when the period is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedBy: "u9", lockedAt: "2026-01-01T00:00:00Z", reason: "closed" }],
    })
    const res = await PATCH(patchReq({ value: 0.7 }), { params })
    expect(res.status).toBe(423)
    expect(prismaMock.budgetAssumption.updateMany).not.toHaveBeenCalled()
  })

  it("404 when companyId names another tenant's company", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue(null)
    const res = await PATCH(patchReq({ companyId: "cmp_other_tenant" }), { params })
    expect(res.status).toBe(404)
    expect(prismaMock.budgetAssumption.updateMany).not.toHaveBeenCalled()
  })

  it("companyId:null demotes an override to a plan default without a company lookup", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetAssumption.findFirst.mockResolvedValue({ ...EXISTING, companyId: "cmp_sugar" })
    const res = await PATCH(patchReq({ companyId: null }), { params })
    expect(res.status).toBe(200)
    expect(prismaMock.company.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.budgetAssumption.updateMany.mock.calls[0][0].data).toEqual({ companyId: null })
  })

  it("200 happy path writes only the patched field", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetAssumption.findFirst
      .mockResolvedValueOnce(EXISTING)
      .mockResolvedValueOnce({ ...EXISTING, value: 0.7 })
    const res = await PATCH(patchReq({ value: 0.7 }), { params })
    expect(res.status).toBe(200)
    expect(prismaMock.budgetAssumption.updateMany.mock.calls[0][0].data).toEqual({ value: 0.7 })
  })

  it("audits the changed field and nothing else", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetAssumption.findFirst
      .mockResolvedValueOnce(EXISTING)
      .mockResolvedValueOnce({ ...EXISTING, value: 0.7 })
    await PATCH(patchReq({ value: 0.7 }), { params })
    expect(logBudgetChangeMock).toHaveBeenCalledTimes(1)
    expect(logBudgetChangeMock.mock.calls[0][0]).toMatchObject({
      entityType: "budgetAssumption",
      entityId: "a1",
      action: "update",
      field: "value",
      oldValue: 0.3,
      newValue: 0.7,
    })
  })

  it("writes no audit when the patch changes nothing", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetAssumption.findFirst.mockResolvedValue(EXISTING)
    await PATCH(patchReq({ value: 0.3 }), { params })
    expect(logBudgetChangeMock).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/budgeting/assumptions/[id]", () => {
  const delReq = () => makeRequest("/api/budgeting/assumptions/a1", { method: "DELETE" })

  it("401 unauthenticated", async () => {
    await mockSession(null)
    expect((await DELETE(delReq(), { params })).status).toBe(401)
  })

  it("403 for a viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    expect((await DELETE(delReq(), { params })).status).toBe(403)
  })

  it("404 when the row is not in this org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetAssumption.findFirst.mockResolvedValue(null)
    const res = await DELETE(delReq(), { params })
    expect(res.status).toBe(404)
    expect(prismaMock.budgetAssumption.deleteMany).not.toHaveBeenCalled()
  })

  it("423 when the period is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedBy: "u9", lockedAt: "2026-01-01T00:00:00Z", reason: "closed" }],
    })
    const res = await DELETE(delReq(), { params })
    expect(res.status).toBe(423)
    expect(prismaMock.budgetAssumption.deleteMany).not.toHaveBeenCalled()
  })

  it("hard-deletes org-scoped and keeps the whole row in the audit", async () => {
    // No `deletedAt` column exists on this model, so the audit entry is the
    // only surviving copy — it must carry the full row, not just the id.
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await DELETE(delReq(), { params })
    expect(res.status).toBe(200)
    expect(prismaMock.budgetAssumption.deleteMany).toHaveBeenCalledWith({
      where: { id: "a1", organizationId: ORG_ID },
    })
    expect(logBudgetChangeMock.mock.calls[0][0]).toMatchObject({
      entityType: "budgetAssumption",
      action: "delete",
      oldValue: EXISTING,
    })
  })
})
