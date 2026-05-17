// @vitest-environment node
/**
 * Handler test for `/api/operational-facts/import` (POST).
 *
 * Phase 7.H F4.v2.3.1 — operational KPI bulk import. Locks manager+
 * gate, multipart envelope, 5MB cap, dryRun default, apply-vs-dryRun
 * paths, errors-block-apply, warnings-require-confirm, cross-tenant
 * companyCode rejection, and per-row audit emission.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, logAuditEventMock, parseOperationalFactsWorkbookMock, xlsxReadMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findMany: vi.fn() },
    operationalFact: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
  logAuditEventMock: vi.fn(),
  parseOperationalFactsWorkbookMock: vi.fn(),
  xlsxReadMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/audit/log", () => ({
  logAuditEvent: logAuditEventMock,
}))
vi.mock("@/lib/onboarding/operational-facts-import", () => ({
  parseOperationalFactsWorkbook: parseOperationalFactsWorkbookMock,
}))
vi.mock("xlsx", () => ({
  read: xlsxReadMock,
  default: { read: xlsxReadMock },
}))

import { mockSession } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.company.findMany.mockReset().mockResolvedValue([])
  prismaMock.operationalFact.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.operationalFact.create.mockReset().mockResolvedValue({ id: "of1" })
  prismaMock.operationalFact.update.mockReset().mockResolvedValue({ id: "of1" })
  logAuditEventMock.mockReset().mockResolvedValue({ ok: true })
  parseOperationalFactsWorkbookMock.mockReset().mockReturnValue({ rows: [], errors: [], warnings: [] })
  xlsxReadMock.mockReset().mockReturnValue({ SheetNames: [], Sheets: {} })
})

function makeMultipartRequest(form: FormData): Request {
  return new Request("http://localhost/api/operational-facts/import", {
    method: "POST",
    body: form,
  })
}

describe("POST /api/operational-facts/import", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const fd = new FormData()
    fd.set("file", new Blob(["x"]), "x.xlsx")
    const res = await POST(makeMultipartRequest(fd) as never)
    expect(res.status).toBe(401)
  })

  it("403 viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const fd = new FormData()
    fd.set("file", new Blob(["x"]), "x.xlsx")
    const res = await POST(makeMultipartRequest(fd) as never)
    expect(res.status).toBe(403)
  })

  it("400 missing file", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const fd = new FormData()
    const res = await POST(makeMultipartRequest(fd) as never)
    expect(res.status).toBe(400)
  })

  it("413 when file exceeds 5MB", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const big = new Blob([new Uint8Array(6 * 1024 * 1024)])
    const fd = new FormData()
    fd.set("file", big, "huge.xlsx")
    const res = await POST(makeMultipartRequest(fd) as never)
    expect(res.status).toBe(413)
  })

  it("200 dryRun default returns parsed rows + errors + warnings", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    parseOperationalFactsWorkbookMock.mockReturnValue({
      rows: [{ rowNumber: 2, companyCode: "AAC", metric: "yield_per_ha", date: "2026-01-01", value: 65, unit: "tons/ha" }],
      errors: [],
      warnings: [],
    })
    const fd = new FormData()
    fd.set("file", new Blob(["x"]), "x.xlsx")
    const res = await POST(makeMultipartRequest(fd) as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dryRun).toBe(true)
    expect(body.rowCount).toBe(1)
    expect(prismaMock.operationalFact.create).not.toHaveBeenCalled()
  })

  it("400 apply blocked when validation errors exist", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    parseOperationalFactsWorkbookMock.mockReturnValue({
      rows: [],
      errors: [{ rowNumber: 2, reason: "bad" }],
      warnings: [],
    })
    const fd = new FormData()
    fd.set("file", new Blob(["x"]), "x.xlsx")
    fd.set("dryRun", "false")
    const res = await POST(makeMultipartRequest(fd) as never)
    expect(res.status).toBe(400)
  })

  it("200 requiresConfirm when warnings exist and forceWarnings missing", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    parseOperationalFactsWorkbookMock.mockReturnValue({
      rows: [{ rowNumber: 2, companyCode: "AAC", metric: "y", date: "2026-01-01", value: 1, unit: "x" }],
      errors: [],
      warnings: [{ rowNumber: 2, reason: "out of band" }],
    })
    const fd = new FormData()
    fd.set("file", new Blob(["x"]), "x.xlsx")
    fd.set("dryRun", "false")
    const res = await POST(makeMultipartRequest(fd) as never)
    const body = await res.json()
    expect(body.requiresConfirm).toBe(true)
    expect(prismaMock.operationalFact.create).not.toHaveBeenCalled()
  })

  it("200 apply path — cross-tenant companyCode → rejected, not leaked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    parseOperationalFactsWorkbookMock.mockReturnValue({
      rows: [
        { rowNumber: 2, companyCode: "AAC", metric: "yield_per_ha", date: "2026-01-01", value: 65, unit: "tons/ha", sourceNote: null },
        { rowNumber: 3, companyCode: "EVIL-CO", metric: "yield_per_ha", date: "2026-01-01", value: 99, unit: "tons/ha", sourceNote: null },
      ],
      errors: [],
      warnings: [],
    })
    prismaMock.company.findMany.mockResolvedValue([{ id: "c1", code: "AAC" }])
    const fd = new FormData()
    fd.set("file", new Blob(["x"]), "x.xlsx")
    fd.set("dryRun", "false")
    const res = await POST(makeMultipartRequest(fd) as never)
    const body = await res.json()
    expect(body.appliedCount).toBe(1)
    expect(body.rejectedCount).toBe(1)
    expect(body.rejected[0].reason).toContain("EVIL-CO")
  })

  it("200 apply path — update when row exists, create when new", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    parseOperationalFactsWorkbookMock.mockReturnValue({
      rows: [
        { rowNumber: 2, companyCode: "AAC", metric: "yield_per_ha", date: "2026-01-01", value: 65, unit: "tons/ha", sourceNote: null },
        { rowNumber: 3, companyCode: "AAC", metric: "yield_per_ha", date: "2026-02-01", value: 70, unit: "tons/ha", sourceNote: null },
      ],
      errors: [],
      warnings: [],
    })
    prismaMock.company.findMany.mockResolvedValue([{ id: "c1", code: "AAC" }])
    // First row exists (update path), second is new (create path)
    prismaMock.operationalFact.findFirst
      .mockResolvedValueOnce({ id: "of_old", value: 50 })
      .mockResolvedValueOnce(null)

    const fd = new FormData()
    fd.set("file", new Blob(["x"]), "x.xlsx")
    fd.set("dryRun", "false")
    const res = await POST(makeMultipartRequest(fd) as never)
    const body = await res.json()
    expect(body.appliedCount).toBe(2)
    expect(prismaMock.operationalFact.update).toHaveBeenCalledTimes(1)
    expect(prismaMock.operationalFact.create).toHaveBeenCalledTimes(1)
  })
})
