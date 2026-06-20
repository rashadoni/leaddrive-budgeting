// @vitest-environment node
/**
 * Handler tests for POST /api/admin/data-archive.
 *
 * Focus: the confirmCode safety gate, archive/restore pass-through, and the
 * Codex P2 #3 fix — a company-scoped CashFlow archive reports how many CF
 * rows for the year could NOT be company-attributed (null / non-"::" sourceId)
 * and were therefore left untouched.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, archiveRowsMock, restoreRowsMock } = vi.hoisted(() => ({
  prismaMock: { cashFlowEntry: { count: vi.fn() } },
  archiveRowsMock: vi.fn(),
  restoreRowsMock: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  requireRole: vi.fn(),
  isAuthError: (r: unknown) => r instanceof Response,
}))
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(() => null),
  getClientIp: vi.fn(() => "1.2.3.4"),
}))
vi.mock("@/lib/log", () => ({ getLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/server/archive", () => ({ archiveRows: archiveRowsMock, restoreRows: restoreRowsMock }))

import { requireRole } from "@/lib/api-auth"
import { POST } from "./route"

const SESSION = { userId: "u1", orgId: "org1", role: "admin" as const }

function req(body: Record<string, unknown>) {
  return new Request("http://t/api/admin/data-archive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireRole as ReturnType<typeof vi.fn>).mockResolvedValue(SESSION)
  archiveRowsMock.mockResolvedValue({ rowsAffected: 84, auditEventId: "a1" })
  restoreRowsMock.mockResolvedValue({ rowsAffected: 84, auditEventId: "a2" })
  prismaMock.cashFlowEntry.count.mockResolvedValue(0)
})

describe("POST /api/admin/data-archive", () => {
  it("400s when confirmCode does not match the scope", async () => {
    const res = await POST(req({ mode: "archive", entityKind: "CashFlowEntry", companyCode: "AZSEKER-AZSF", year: 2026, confirmCode: "WRONG" }))
    expect(res.status).toBe(400)
    expect(archiveRowsMock).not.toHaveBeenCalled()
  })

  it("archives CF for a company and reports unattributable (null/non-:: sourceId) rows", async () => {
    prismaMock.cashFlowEntry.count.mockResolvedValueOnce(5)
    const res = await POST(req({ mode: "archive", entityKind: "CashFlowEntry", companyCode: "AZSEKER-AZSF", year: 2026, confirmCode: "AZSEKER-AZSF" }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.rowsAffected).toBe(84)
    expect(body.unattributableCfRows).toBe(5)
    // the count query targets live, non-"::"-prefixed rows for the year
    const w = prismaMock.cashFlowEntry.count.mock.calls[0][0].where
    expect(w).toMatchObject({ organizationId: "org1", year: 2026, deletedAt: null })
    expect(w.OR).toBeTruthy()
  })

  it("does NOT compute unattributable count for non-CF kinds", async () => {
    const res = await POST(req({ mode: "archive", entityKind: "BalanceSheetLine", companyCode: "AZSEKER-AZSF", year: 2026, confirmCode: "AZSEKER-AZSF" }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.unattributableCfRows).toBeUndefined()
    expect(prismaMock.cashFlowEntry.count).not.toHaveBeenCalled()
  })

  it("does NOT compute unattributable count on restore", async () => {
    const res = await POST(req({ mode: "restore", entityKind: "CashFlowEntry", companyCode: "AZSEKER-AZSF", year: 2026, confirmCode: "AZSEKER-AZSF" }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(restoreRowsMock).toHaveBeenCalled()
    expect(prismaMock.cashFlowEntry.count).not.toHaveBeenCalled()
  })
})
