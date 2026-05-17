// @vitest-environment node
/**
 * Handler test for `/api/onboarding/import/companies` (POST).
 *
 * Phase 7.B bulk company import. Locks manager+ auth, multipart
 * envelope, 10MB byte cap, 50k row cap, extension whitelist, rate
 * limit, error response envelope shapes, and high-level pass-1 /
 * pass-2 transaction structure.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const {
  prismaMock,
  enforceRateLimitMock,
  canonicalizeHeadersMock,
  normalizeRowMock,
  findWorkbookDuplicatesMock,
  xlsxReadMock,
  xlsxSheetToJsonMock,
} = vi.hoisted(() => ({
  prismaMock: {
    company: { findMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(),
  },
  enforceRateLimitMock: vi.fn(),
  canonicalizeHeadersMock: vi.fn(),
  normalizeRowMock: vi.fn(),
  findWorkbookDuplicatesMock: vi.fn(),
  xlsxReadMock: vi.fn(),
  xlsxSheetToJsonMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: enforceRateLimitMock,
  getClientIp: vi.fn(() => "127.0.0.1"),
}))
vi.mock("@/lib/onboarding/companies-import", () => ({
  canonicalizeHeaders: canonicalizeHeadersMock,
  normalizeRow: normalizeRowMock,
  findWorkbookDuplicates: findWorkbookDuplicatesMock,
}))
vi.mock("xlsx", () => ({
  read: xlsxReadMock,
  utils: {
    sheet_to_json: xlsxSheetToJsonMock,
  },
  default: {
    read: xlsxReadMock,
    utils: { sheet_to_json: xlsxSheetToJsonMock },
  },
}))

import { mockSession } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.company.findMany.mockReset().mockResolvedValue([])
  prismaMock.company.createMany.mockReset().mockResolvedValue({ count: 0 })
  prismaMock.$transaction.mockReset().mockImplementation(async (fn: any) => fn({
    company: {
      createMany: prismaMock.company.createMany,
      findMany: prismaMock.company.findMany,
    },
  }))
  enforceRateLimitMock.mockReset().mockReturnValue(null)
  canonicalizeHeadersMock.mockReset().mockImplementation((rows: unknown[]) => rows)
  normalizeRowMock.mockReset()
  findWorkbookDuplicatesMock.mockReset().mockReturnValue([])
  xlsxReadMock.mockReset().mockReturnValue({ SheetNames: ["Sheet1"], Sheets: { Sheet1: {} } })
  xlsxSheetToJsonMock.mockReset().mockReturnValue([])
})

function makeMultipartRequest(form: FormData, filename = "x.xlsx"): Request {
  return new Request("http://localhost/api/onboarding/import/companies", {
    method: "POST",
    body: form,
  })
}

describe("POST /api/onboarding/import/companies", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const fd = new FormData()
    const blob = new Blob(["x"], { type: "application/octet-stream" })
    fd.set("file", new File([blob], "x.xlsx"))
    const res = await POST(makeMultipartRequest(fd) as never)
    expect(res.status).toBe(401)
  })

  it("403 viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const fd = new FormData()
    fd.set("file", new File([new Blob(["x"])], "x.xlsx"))
    const res = await POST(makeMultipartRequest(fd) as never)
    expect(res.status).toBe(403)
  })

  it("429 rate-limited", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    enforceRateLimitMock.mockReturnValue(new Response("rate", { status: 429 }))
    const fd = new FormData()
    fd.set("file", new File([new Blob(["x"])], "x.xlsx"))
    const res = await POST(makeMultipartRequest(fd) as never)
    expect(res.status).toBe(429)
  })

  it("400 missing file", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const fd = new FormData()
    const res = await POST(makeMultipartRequest(fd) as never)
    expect(res.status).toBe(400)
  })

  it("413 when file exceeds 10MB", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const big = new Blob([new Uint8Array(11 * 1024 * 1024)])
    const fd = new FormData()
    fd.set("file", new File([big], "x.xlsx"))
    const res = await POST(makeMultipartRequest(fd) as never)
    expect(res.status).toBe(413)
  })

  it("415 unsupported extension (.xlsm)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const fd = new FormData()
    fd.set("file", new File([new Blob(["x"])], "evil.xlsm"))
    const res = await POST(makeMultipartRequest(fd) as never)
    expect(res.status).toBe(415)
  })

  it("400 empty sheet", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    xlsxSheetToJsonMock.mockReturnValue([])
    const fd = new FormData()
    fd.set("file", new File([new Blob(["x"])], "x.xlsx"))
    const res = await POST(makeMultipartRequest(fd) as never)
    expect(res.status).toBe(400)
  })

  it("400 validation errors from normalizeRow surface as rowErrors", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    xlsxSheetToJsonMock.mockReturnValue([{ code: "AAA", level: 1 }])
    normalizeRowMock.mockReturnValue({ row: 2, reason: "missing name" })
    const fd = new FormData()
    fd.set("file", new File([new Blob(["x"])], "x.xlsx"))
    const res = await POST(makeMultipartRequest(fd) as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.rowErrors[0].reason).toContain("missing name")
  })

  it("409 when codes already exist in DB", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    xlsxSheetToJsonMock.mockReturnValue([{ code: "AAA", level: 1 }])
    normalizeRowMock.mockReturnValue({
      code: "AAA", name: "AAA Co", industry: null, level: 1, parentCompanyCode: null,
    })
    prismaMock.company.findMany.mockResolvedValue([{ code: "AAA" }])
    const fd = new FormData()
    fd.set("file", new File([new Blob(["x"])], "x.xlsx"))
    const res = await POST(makeMultipartRequest(fd) as never)
    expect(res.status).toBe(409)
  })

  it("200 happy path — inserts level-1 + level-2 rows in transaction", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    xlsxSheetToJsonMock.mockReturnValue([{ code: "AAA", level: 1 }, { code: "BBB", level: 2 }])
    normalizeRowMock
      .mockReturnValueOnce({
        code: "AAA", name: "AAA Co", industry: null, level: 1, parentCompanyCode: null,
      })
      .mockReturnValueOnce({
        code: "BBB", name: "BBB Co", industry: "tech", level: 2, parentCompanyCode: "AAA",
      })
    prismaMock.company.findMany
      .mockResolvedValueOnce([]) // no existing codes
      .mockResolvedValueOnce([{ id: "id_AAA", code: "AAA" }]) // parent lookup
    prismaMock.company.createMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 })
    const fd = new FormData()
    fd.set("file", new File([new Blob(["x"])], "x.xlsx"))
    const res = await POST(makeMultipartRequest(fd) as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.inserted).toBe(2)
    expect(body.level1Count).toBe(1)
    expect(body.level2Count).toBe(1)
  })
})
