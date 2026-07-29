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

const { prismaMock, logAuditEventMock } = vi.hoisted(() => ({
  prismaMock: {
    chartOfAccount: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    auditEvent: { create: vi.fn() },
  },
  logAuditEventMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
// Stage 3 RLS — route wraps DB access in withOrgScope; hand the mock straight to the callback so the handler test stays DB-free.
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))
vi.mock("@/lib/audit/log", () => ({ logAuditEvent: logAuditEventMock }))

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
  // Phase 7.G LXXXXIV — prior-state read for audit metadata
  prismaMock.chartOfAccount.findFirst.mockReset().mockResolvedValue({
    code: "601-01",
    name: "Sales — Goods",
    role: "revenue",
  })
  logAuditEventMock.mockReset().mockResolvedValue({ ok: true, id: "audit_1" })
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

  it("returns 404 when account belongs to a different org (findFirst returns null)", async () => {
    prismaMock.chartOfAccount.findFirst.mockResolvedValue(null)
    const res = await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: { role: "opex" },
      }),
      stubParams(ACCOUNT_ID),
    )
    expect(res.status).toBe(404)
    expect(prismaMock.chartOfAccount.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.chartOfAccount.findUnique).not.toHaveBeenCalled()
  })

  it("returns 404 on race: prior present but updateMany count=0", async () => {
    // findFirst sees the row, but updateMany finds nothing (deleted between)
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

// Phase 7.G Turn LXXXXIV — coa_role_change audit emission
describe("PUT — coa_role_change audit emission (Turn LXXXXIV)", () => {
  beforeEach(async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
  })

  it("emits coa_role_change with from/to/accountCode/accountName when role changes", async () => {
    prismaMock.chartOfAccount.findFirst.mockResolvedValue({
      code: "601-01",
      name: "Sales — Goods",
      role: "revenue",
    })
    await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: { role: "opex" },
      }),
      stubParams(ACCOUNT_ID),
    )
    expect(logAuditEventMock).toHaveBeenCalledOnce()
    const callArgs = logAuditEventMock.mock.calls[0][1]
    expect(callArgs.organizationId).toBe(ORG_ID)
    expect(callArgs.actorUserId).toBe("u_admin")
    expect(callArgs.event).toMatchObject({
      action: "coa_role_change",
      entityType: "ChartOfAccount",
      entityId: ACCOUNT_ID,
      metadata: {
        accountCode: "601-01",
        accountName: "Sales — Goods",
        from: "revenue",
        to: "opex",
      },
    })
    expect(callArgs.context.route).toContain("PUT /api/budgeting/chart-of-accounts/")
  })

  it("does NOT emit when role unchanged (PUT with same role = no-op audit)", async () => {
    prismaMock.chartOfAccount.findFirst.mockResolvedValue({
      code: "601-01",
      name: "Sales — Goods",
      role: "revenue",
    })
    await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: { role: "revenue" }, // same as prior
      }),
      stubParams(ACCOUNT_ID),
    )
    expect(logAuditEventMock).not.toHaveBeenCalled()
  })

  it("emits when changing to null (revert to derived default)", async () => {
    prismaMock.chartOfAccount.findFirst.mockResolvedValue({
      code: "601-01",
      name: "Sales — Goods",
      role: "opex",
    })
    await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: { role: null },
      }),
      stubParams(ACCOUNT_ID),
    )
    expect(logAuditEventMock).toHaveBeenCalledOnce()
    const event = logAuditEventMock.mock.calls[0][1].event
    expect(event.metadata.from).toBe("opex")
    expect(event.metadata.to).toBeNull()
  })

  it("response includes auditStale=true when audit emit fails", async () => {
    logAuditEventMock.mockResolvedValue({ ok: false, error: "table missing" })
    const res = await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: { role: "opex" },
      }),
      stubParams(ACCOUNT_ID),
    )
    expect(res.status).toBe(200) // role change still committed
    const body = await res.json()
    expect(body.updated).toBe(true)
    expect(body.auditStale).toBe(true)
  })

  it("response omits auditStale when audit emit succeeds", async () => {
    logAuditEventMock.mockResolvedValue({ ok: true, id: "audit_42" })
    const res = await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: { role: "opex" },
      }),
      stubParams(ACCOUNT_ID),
    )
    const body = await res.json()
    expect(body.updated).toBe(true)
    expect(body.auditStale).toBeUndefined()
  })
})

// ─── Phase 11.20 — accountType is reclassifiable ────────────────────────
//
// It was written once by the importer and frozen forever: auto-created
// accounts took `defaultAccountType` (falling back to "expense" when
// unknown) and re-import deliberately never overwrites it. A mis-typed
// account therefore put its number in the wrong statement section
// permanently, even when the amount was correct — and the importer's own
// comment promised an admin override that only ever exposed `role`.
describe("PUT /api/budgeting/chart-of-accounts/[id] — accountType", () => {
  function priorIs(accountType: string) {
    prismaMock.chartOfAccount.findFirst.mockResolvedValue({
      code: "601-01",
      name: "Sales — Goods",
      role: "revenue",
      accountType,
    })
  }

  it("reclassifies WITHIN the P&L without extra confirmation", async () => {
    // expense↔cogs reshuffles P&L subtotals but keeps the number in the same
    // statement, so it needs no special acknowledgement.
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    priorIs("expense")
    const res = await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: { accountType: "cogs" },
      }) as never,
      stubParams(ACCOUNT_ID),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.chartOfAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { accountType: "cogs" } }),
    )
  })

  it("REFUSES a P&L → balance-sheet move without confirmCrossStatement", async () => {
    // expense→asset relocates the number out of the P&L entirely; both
    // statements change and neither total looks wrong afterwards, so it must
    // be deliberate rather than a typo in a PUT body.
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    priorIs("expense")
    const res = await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: { accountType: "asset" },
      }) as never,
      stubParams(ACCOUNT_ID),
    )
    expect(res.status).toBe(409)
    const body = (await res.json()) as { requiresConfirmation: boolean }
    expect(body.requiresConfirmation).toBe(true)
    // Refused BEFORE any write.
    expect(prismaMock.chartOfAccount.updateMany).not.toHaveBeenCalled()
  })

  it("allows the cross-statement move once confirmed, and audits it as such", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    priorIs("expense")
    const res = await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: { accountType: "asset", confirmCrossStatement: true },
      }) as never,
      stubParams(ACCOUNT_ID),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.chartOfAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { accountType: "asset" } }),
    )
    expect(logAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event: expect.objectContaining({
          metadata: expect.objectContaining({
            field: "accountType",
            from: "expense",
            to: "asset",
            crossStatement: true,
          }),
        }),
      }),
    )
  })

  it("rejects a body with neither role nor accountType", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    const res = await PUT(makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
      method: "PUT",
      json: {},
    }) as never, stubParams(ACCOUNT_ID))
    expect(res.status).toBe(400)
  })

  it("rejects an unknown accountType", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    const res = await PUT(
      makeRequest(`/api/budgeting/chart-of-accounts/${ACCOUNT_ID}`, {
        method: "PUT",
        json: { accountType: "goodwill" },
      }) as never,
      stubParams(ACCOUNT_ID),
    )
    expect(res.status).toBe(400)
  })
})
