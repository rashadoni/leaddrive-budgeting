/**
 * Phase 7.G Turn CX (Phase 7.B v2 Day 4) — handler tests for
 * `POST /api/onboarding/import/staging/[id]/apply-multi`. Mocks the
 * applier surface so the route's HTTP shape + per-sheet aggregation are
 * exercised without real xlsx parsing.
 *
 * Coverage:
 *  - 401 unauth, 403 viewer
 *  - 404 staging not found / cross-tenant
 *  - 410 expired / discarded staging
 *  - 409 already applied
 *  - 422 single-sheet proposal sent to multi route (shape mismatch)
 *  - 422 when ALL sheets fail to apply
 *  - 200 happy path: per-sheet success counts + persisted BudgetLines via
 *    transaction + staging marked applied
 *  - per-sheet failure isolation: 1 sheet errors, others succeed
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, applierMocks, recomputeMock, auditMock } = vi.hoisted(() => ({
  prismaMock: {
    importStaging: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    company: { findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  applierMocks: {
    applyMultiSheetProposal: vi.fn(),
    isMultiSheetProposal: vi.fn(),
    detectProposalYear: vi.fn(),
  },
  recomputeMock: { runRecomputeForCompanies: vi.fn() },
  auditMock: { logAuditEvent: vi.fn(), buildAuditContext: vi.fn((c) => c) },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/onboarding/ai-mapper/applier", () => applierMocks)
vi.mock("@/lib/risk/recompute-trigger", () => recomputeMock)
vi.mock("@/lib/audit/log", () => auditMock)
vi.mock("xlsx", () => ({
  read: vi.fn().mockReturnValue({
    SheetNames: ["P&L", "BS"],
    Sheets: { "P&L": {}, BS: {} },
  }),
}))
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit")
  return {
    ...actual,
    enforceRateLimit: vi.fn().mockReturnValue(null),
    getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
  }
})

import type { NextRequest as NextRequestType } from "next/server"
import { mockSession } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_az"
const STAGING_ID = "staging_1"
const COMPANY_ID = "co_aac"

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) }
}

async function makeRequest(): Promise<NextRequestType> {
  const fd = new FormData()
  fd.set(
    "file",
    new File(["fake"], "aac.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  )
  const base = new Request(
    `http://localhost/api/onboarding/import/staging/${STAGING_ID}/apply-multi`,
    { method: "POST", body: fd },
  )
  const { NextRequest } = await import("next/server")
  return new NextRequest(base)
}

const validMultiProposal = {
  sheets: [
    { sheetName: "P&L", proposal: { columns: [], summary: "x", overallConfidence: 0.9, accountTypeOverrides: [], anomalies: [] } },
    { sheetName: "BS", proposal: { columns: [], summary: "y", overallConfidence: 0.9, accountTypeOverrides: [], anomalies: [] } },
  ],
}

const validStagingRow = {
  id: STAGING_ID,
  companyId: COMPANY_ID,
  status: "pending" as const,
  sourceSheet: "P&L,BS",
  proposal: validMultiProposal,
  expiresAt: new Date(Date.now() + 60_000),
  appliedAt: null,
}

beforeEach(() => {
  prismaMock.importStaging.findFirst.mockReset()
  prismaMock.importStaging.updateMany.mockReset()
  prismaMock.importStaging.update.mockReset()
  prismaMock.company.findUnique.mockReset().mockResolvedValue({ baseCurrencyCode: "AZN" })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "audit_1" })
  prismaMock.$transaction.mockReset()
  applierMocks.applyMultiSheetProposal.mockReset()
  applierMocks.isMultiSheetProposal.mockReset().mockReturnValue(true)
  applierMocks.detectProposalYear.mockReset().mockReturnValue(2026)
  recomputeMock.runRecomputeForCompanies
    .mockReset()
    .mockResolvedValue({ ok: 5, unknown: 1, failed: 0, targets: 6 })
  auditMock.logAuditEvent.mockReset().mockResolvedValue({ ok: true, id: "audit_1" })
})

describe("POST /api/onboarding/import/staging/[id]/apply-multi — auth + status gates", () => {
  it("401 unauth", async () => {
    await mockSession(null)
    const res = await POST(await makeRequest(), paramsFor(STAGING_ID))
    expect(res.status).toBe(401)
  })

  it("403 viewer role", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(await makeRequest(), paramsFor(STAGING_ID))
    expect(res.status).toBe(403)
  })

  it("404 when staging not found", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.importStaging.findFirst.mockResolvedValue(null)
    const res = await POST(await makeRequest(), paramsFor(STAGING_ID))
    expect(res.status).toBe(404)
  })

  it("410 when staging expired", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.importStaging.findFirst.mockResolvedValue({
      ...validStagingRow,
      expiresAt: new Date(Date.now() - 1000),
    })
    prismaMock.importStaging.updateMany.mockResolvedValue({ count: 1 })
    const res = await POST(await makeRequest(), paramsFor(STAGING_ID))
    expect(res.status).toBe(410)
  })

  it("409 when already applied", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.importStaging.findFirst.mockResolvedValue({
      ...validStagingRow,
      status: "applied",
      appliedAt: new Date(),
    })
    const res = await POST(await makeRequest(), paramsFor(STAGING_ID))
    expect(res.status).toBe(409)
  })

  it("410 when discarded", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.importStaging.findFirst.mockResolvedValue({
      ...validStagingRow,
      status: "discarded",
    })
    const res = await POST(await makeRequest(), paramsFor(STAGING_ID))
    expect(res.status).toBe(410)
  })
})

describe("POST /api/onboarding/import/staging/[id]/apply-multi — proposal shape validation", () => {
  beforeEach(async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
  })

  it("422 when staging proposal is single-sheet (not MultiSheetProposal)", async () => {
    prismaMock.importStaging.findFirst.mockResolvedValue({
      ...validStagingRow,
      proposal: { columns: [], summary: "single sheet", overallConfidence: 0.9 }, // single-sheet shape
    })
    applierMocks.isMultiSheetProposal.mockReturnValue(false)
    const res = await POST(await makeRequest(), paramsFor(STAGING_ID))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain("MultiSheetProposal")
  })
})

describe("POST /api/onboarding/import/staging/[id]/apply-multi — apply outcomes", () => {
  beforeEach(async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.importStaging.findFirst.mockResolvedValue(validStagingRow)
  })

  it("422 when all sheets fail to apply", async () => {
    applierMocks.applyMultiSheetProposal.mockReturnValue({
      perSheet: [
        { sheetName: "P&L", error: "no header band detected" },
        { sheetName: "BS", error: "schema mismatch" },
      ],
    })
    const res = await POST(await makeRequest(), paramsFor(STAGING_ID))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toMatch(/All sheets failed/)
    expect(body.perSheet).toHaveLength(2)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it("200 happy path: aggregates per-sheet stats + commits transaction", async () => {
    applierMocks.applyMultiSheetProposal.mockReturnValue({
      perSheet: [
        {
          sheetName: "P&L",
          result: {
            lines: [
              { code: "601-01", label: "Sales", accountType: "revenue", perMonth: Array(12).fill(100) },
              { code: "701-01", label: "COGS", accountType: "cogs", perMonth: Array(12).fill(50) },
            ],
            warnings: [],
            parentRollupsDropped: [],
            parentRollupsUnallocated: [],
            sheetName: "P&L",
            skippedRowCount: 0,
          },
        },
        {
          sheetName: "BS",
          result: {
            lines: [
              { code: "801-01", label: "OpEx", accountType: "expense", perMonth: Array(12).fill(20) },
            ],
            warnings: [],
            parentRollupsDropped: [],
            parentRollupsUnallocated: [],
            sheetName: "BS",
            skippedRowCount: 0,
          },
        },
      ],
    })
    prismaMock.$transaction.mockResolvedValue({ inserted: 3, deleted: 0 })
    const res = await POST(await makeRequest(), paramsFor(STAGING_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.successCount).toBe(2)
    expect(body.failureCount).toBe(0)
    expect(body.inserted).toBe(3)
    expect(body.year).toBe(2026)
    expect(body.perSheet).toHaveLength(2)
    expect(prismaMock.$transaction).toHaveBeenCalledOnce()
  })

  it("200 with per-sheet failure isolation: 1 sheet errors, other succeeds + persists", async () => {
    applierMocks.applyMultiSheetProposal.mockReturnValue({
      perSheet: [
        { sheetName: "P&L", error: "extract failed" },
        {
          sheetName: "BS",
          result: {
            lines: [
              { code: "801-01", label: "OpEx", accountType: "expense", perMonth: Array(12).fill(20) },
            ],
            warnings: [],
            parentRollupsDropped: [],
            parentRollupsUnallocated: [],
            sheetName: "BS",
            skippedRowCount: 0,
          },
        },
      ],
    })
    prismaMock.$transaction.mockResolvedValue({ inserted: 1, deleted: 0 })
    const res = await POST(await makeRequest(), paramsFor(STAGING_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.successCount).toBe(1)
    expect(body.failureCount).toBe(1)
    expect(body.perSheet[0]).toMatchObject({ sheetName: "P&L", error: "extract failed" })
    expect(body.perSheet[1]).toMatchObject({ sheetName: "BS", inserted: 1 })
    expect(prismaMock.$transaction).toHaveBeenCalledOnce()
  })

  it("400 when first successful sheet has multi-year column conflict", async () => {
    applierMocks.applyMultiSheetProposal.mockReturnValue({
      perSheet: [
        {
          sheetName: "P&L",
          result: {
            lines: [],
            warnings: [],
            parentRollupsDropped: [],
            parentRollupsUnallocated: [],
            sheetName: "P&L",
            skippedRowCount: 0,
          },
        },
      ],
    })
    applierMocks.detectProposalYear.mockReturnValue({ conflict: [2025, 2026] })
    const res = await POST(await makeRequest(), paramsFor(STAGING_ID))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/multiple years/)
  })

  it("500 when transaction throws (rollback semantics intact)", async () => {
    applierMocks.applyMultiSheetProposal.mockReturnValue({
      perSheet: [
        {
          sheetName: "P&L",
          result: {
            lines: [
              { code: "601-01", label: "Sales", accountType: "revenue", perMonth: Array(12).fill(100) },
            ],
            warnings: [],
            parentRollupsDropped: [],
            parentRollupsUnallocated: [],
            sheetName: "P&L",
            skippedRowCount: 0,
          },
        },
      ],
    })
    prismaMock.$transaction.mockRejectedValue(new Error("DB explosion"))
    const res = await POST(await makeRequest(), paramsFor(STAGING_ID))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/Transaction failed/)
    expect(body.perSheet).toBeDefined()
    // Recompute + audit MUST NOT fire when transaction failed
    expect(recomputeMock.runRecomputeForCompanies).not.toHaveBeenCalled()
    expect(auditMock.logAuditEvent).not.toHaveBeenCalled()
  })
})

describe("POST /api/onboarding/import/staging/[id]/apply-multi — recompute + audit (Turn CXI)", () => {
  beforeEach(async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "manager" })
    prismaMock.importStaging.findFirst.mockResolvedValue(validStagingRow)
    applierMocks.applyMultiSheetProposal.mockReturnValue({
      perSheet: [
        {
          sheetName: "P&L",
          result: {
            lines: [
              { code: "601-01", label: "Sales", accountType: "revenue", perMonth: Array(12).fill(100) },
              { code: "701-01", label: "COGS", accountType: "cogs", perMonth: Array(12).fill(50) },
            ],
            warnings: [],
            parentRollupsDropped: [],
            parentRollupsUnallocated: [],
            sheetName: "P&L",
            skippedRowCount: 0,
          },
        },
        {
          sheetName: "BS",
          result: {
            lines: [
              { code: "801-01", label: "OpEx", accountType: "expense", perMonth: Array(12).fill(20) },
            ],
            warnings: [],
            parentRollupsDropped: [],
            parentRollupsUnallocated: [],
            sheetName: "BS",
            skippedRowCount: 0,
          },
        },
      ],
    })
    prismaMock.$transaction.mockResolvedValue({ inserted: 3, deleted: 0 })
  })

  it("recompute fires once for (companyId, year) after successful transaction", async () => {
    await POST(await makeRequest(), paramsFor(STAGING_ID))
    expect(recomputeMock.runRecomputeForCompanies).toHaveBeenCalledOnce()
    const args = recomputeMock.runRecomputeForCompanies.mock.calls[0]
    expect(args[1]).toBe(ORG_ID)
    expect(args[2]).toEqual([{ companyId: COMPANY_ID, year: 2026 }])
  })

  it("response carries recompute stats + indicatorsStale=false on full success", async () => {
    const res = await POST(await makeRequest(), paramsFor(STAGING_ID))
    const body = await res.json()
    expect(body.recompute).toEqual({ ok: 5, unknown: 1, failed: 0, targets: 6 })
    expect(body.indicatorsStale).toBe(false)
  })

  it("indicatorsStale=true when any recompute pair fails", async () => {
    recomputeMock.runRecomputeForCompanies.mockResolvedValue({ ok: 4, unknown: 1, failed: 2, targets: 7 })
    const res = await POST(await makeRequest(), paramsFor(STAGING_ID))
    const body = await res.json()
    expect(body.indicatorsStale).toBe(true)
  })

  it("audit emits import_staging_apply with multiSheet=true + sheet counts + recompute stats", async () => {
    await POST(await makeRequest(), paramsFor(STAGING_ID))
    expect(auditMock.logAuditEvent).toHaveBeenCalledOnce()
    const callArgs = auditMock.logAuditEvent.mock.calls[0][1]
    expect(callArgs.organizationId).toBe(ORG_ID)
    expect(callArgs.actorUserId).toBe("u_admin")
    expect(callArgs.event).toMatchObject({
      action: "import_staging_apply",
      entityType: "ImportStaging",
      entityId: STAGING_ID,
      metadata: {
        companyId: COMPANY_ID,
        year: 2026,
        inserted: 3,
        deleted: 0,
        multiSheet: true,
        sheetCount: 2,
        successCount: 2,
        failureCount: 0,
        recompute: { ok: 5, unknown: 1, failed: 0, targets: 6 },
      },
    })
    expect(callArgs.context.route).toBe("/api/onboarding/import/staging/[id]/apply-multi")
  })

  it("audit metadata aggregates per-sheet warnings + parent-rollup counts", async () => {
    applierMocks.applyMultiSheetProposal.mockReturnValue({
      perSheet: [
        {
          sheetName: "P&L",
          result: {
            lines: [{ code: "601-01", label: "S", accountType: "revenue", perMonth: Array(12).fill(100) }],
            warnings: ["w1", "w2"],
            parentRollupsDropped: ["p1"],
            parentRollupsUnallocated: ["u1", "u2"],
            sheetName: "P&L",
            skippedRowCount: 0,
          },
        },
        {
          sheetName: "BS",
          result: {
            lines: [{ code: "801-01", label: "O", accountType: "expense", perMonth: Array(12).fill(20) }],
            warnings: ["w3"],
            parentRollupsDropped: [],
            parentRollupsUnallocated: ["u3"],
            sheetName: "BS",
            skippedRowCount: 0,
          },
        },
      ],
    })
    await POST(await makeRequest(), paramsFor(STAGING_ID))
    const meta = auditMock.logAuditEvent.mock.calls[0][1].event.metadata
    expect(meta.warnings).toBe(3) // 2 + 1
    expect(meta.parentRollupsDropped).toBe(1) // 1 + 0
    expect(meta.parentRollupsUnallocated).toBe(3) // 2 + 1
  })

  it("audit failure → response carries auditStale=true (transaction NOT rolled back)", async () => {
    auditMock.logAuditEvent.mockResolvedValue({ ok: false, error: "table missing" })
    const res = await POST(await makeRequest(), paramsFor(STAGING_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.auditStale).toBe(true)
    // Inserted lines still committed
    expect(body.inserted).toBe(3)
    expect(body.status).toBe("applied")
  })

  it("audit succeeds → auditStale=false (omitted-true in response)", async () => {
    const res = await POST(await makeRequest(), paramsFor(STAGING_ID))
    const body = await res.json()
    expect(body.auditStale).toBe(false)
  })
})
