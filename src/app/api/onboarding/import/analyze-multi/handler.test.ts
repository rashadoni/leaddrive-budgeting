/**
 * Phase 7.G Turn CIX (Phase 7.B v2 Day 4) — handler tests for
 * `POST /api/onboarding/import/analyze-multi`. Mocks the LLM surface
 * (`runMapper`) and the extract pipeline so the route's HTTP shape +
 * per-sheet isolation are exercised without real Anthropic calls.
 *
 * Coverage:
 *  - 503 ANTHROPIC_API_KEY missing
 *  - 401 unauth, 403 below-manager
 *  - 404 cross-tenant company
 *  - 400 missing companyId / non-xlsx filename / unknown sheetNames filter
 *  - 400 over MAX_SHEETS_PER_REQUEST cap
 *  - 422 when ALL sheets fail (no successful proposal to persist)
 *  - 201 happy path: per-sheet results + persisted MultiSheetProposal shape
 *  - per-sheet failure isolation: extract or runMapper error in one sheet
 *    does NOT abort the batch; failed sheets recorded as {sheetName, error}
 *    while successes still persist
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, aiMocks, hasKeyMock, xlsxMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findFirst: vi.fn() },
    importStaging: { create: vi.fn() },
  },
  aiMocks: {
    extractMapperInput: vi.fn(),
    runMapper: vi.fn(),
  },
  hasKeyMock: { hasAnthropicKey: vi.fn().mockReturnValue(true) },
  xlsxMock: {
    read: vi.fn(),
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/onboarding/ai-mapper/extract", () => ({
  extractMapperInput: aiMocks.extractMapperInput,
}))
vi.mock("@/lib/onboarding/ai-mapper/mapper", () => ({
  runMapper: aiMocks.runMapper,
}))
vi.mock("@/lib/ai/client", () => hasKeyMock)
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit")
  return {
    ...actual,
    enforceRateLimit: vi.fn().mockReturnValue(null),
    getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
  }
})
vi.mock("xlsx", () => ({
  read: xlsxMock.read,
}))

import type { NextRequest } from "next/server"
import { mockSession } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_az"
const COMPANY_ID = "co_aac"
const STAGING_ID = "staging_new"

async function makeRequest(opts: {
  filename?: string
  companyId?: string | null
  sheetNames?: string
  industryHint?: string
} = {}): Promise<NextRequest> {
  const fd = new FormData()
  fd.set(
    "file",
    new File(["fake"], opts.filename ?? "aac.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  )
  if (opts.companyId !== null) fd.set("companyId", opts.companyId ?? COMPANY_ID)
  if (opts.sheetNames) fd.set("sheetNames", opts.sheetNames)
  if (opts.industryHint) fd.set("industryHint", opts.industryHint)
  const base = new Request("http://localhost/api/onboarding/import/analyze-multi", {
    method: "POST",
    body: fd,
  })
  const { NextRequest } = await import("next/server")
  return new NextRequest(base)
}

const sampleProposal = (sheetName: string) => ({
  sourceFile: "aac.xlsx",
  sourceSheet: sheetName,
  summary: `mock for ${sheetName}`,
  overallConfidence: 0.9,
  columns: [{ sourceIndex: 0, role: "code", confidence: 1, reasoning: "stub" }],
  accountTypeOverrides: [],
  anomalies: [],
  usage: { inputTokens: 100, outputTokens: 50 },
})

beforeEach(() => {
  prismaMock.company.findFirst.mockReset()
  prismaMock.importStaging.create.mockReset().mockResolvedValue({ id: STAGING_ID })
  aiMocks.extractMapperInput.mockReset()
  aiMocks.runMapper.mockReset()
  hasKeyMock.hasAnthropicKey.mockReset().mockReturnValue(true)
  xlsxMock.read.mockReset().mockReturnValue({
    SheetNames: ["P&L", "BS"],
    Sheets: { "P&L": {}, BS: {} },
  })
})

describe("POST /api/onboarding/import/analyze-multi — guard rails", () => {
  it("503 when ANTHROPIC_API_KEY missing", async () => {
    hasKeyMock.hasAnthropicKey.mockReturnValue(false)
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(await makeRequest())
    expect(res.status).toBe(503)
  })

  it("401 unauth", async () => {
    await mockSession(null)
    const res = await POST(await makeRequest())
    expect(res.status).toBe(401)
  })

  it("403 viewer role", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(await makeRequest())
    expect(res.status).toBe(403)
  })

  it("400 when companyId missing", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(await makeRequest({ companyId: null }))
    expect(res.status).toBe(400)
  })

  it("415 when filename is non-xlsx", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(await makeRequest({ filename: "evil.csv" }))
    expect(res.status).toBe(415)
  })

  it("404 when companyId is in a different org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue(null)
    const res = await POST(await makeRequest())
    expect(res.status).toBe(404)
    expect(aiMocks.runMapper).not.toHaveBeenCalled()
  })
})

describe("POST /api/onboarding/import/analyze-multi — sheet filtering + caps", () => {
  beforeEach(async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue({
      id: COMPANY_ID,
      name: "AAC",
      industry: "hospitality",
    })
    aiMocks.extractMapperInput.mockReturnValue({
      sourceFile: "aac.xlsx",
      sourceSheet: "X",
      columns: [{ index: 0, headerText: "KOD", samples: ["601-01"] }],
      sampleRows: [["601-01"]],
    })
    aiMocks.runMapper.mockImplementation(async (input: { sourceSheet: string }) =>
      sampleProposal(input.sourceSheet),
    )
  })

  it("400 when sheetNames filter has unknown name", async () => {
    const res = await POST(await makeRequest({ sheetNames: "P&L,DOES_NOT_EXIST" }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.availableSheets).toEqual(["P&L", "BS"])
  })

  it("400 when sheet count exceeds MAX_SHEETS_PER_REQUEST", async () => {
    // 11 sheets — over the cap of 10
    const sheets: string[] = []
    const sheetMap: Record<string, object> = {}
    for (let i = 0; i < 11; i++) {
      sheets.push(`S${i}`)
      sheetMap[`S${i}`] = {}
    }
    xlsxMock.read.mockReturnValue({ SheetNames: sheets, Sheets: sheetMap })
    const res = await POST(await makeRequest())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Too many sheets/)
  })

  it("processes filtered subset only", async () => {
    const res = await POST(await makeRequest({ sheetNames: "P&L" }))
    expect(res.status).toBe(201)
    expect(aiMocks.runMapper).toHaveBeenCalledOnce()
    const body = await res.json()
    expect(body.successCount).toBe(1)
    expect(body.perSheet[0].sheetName).toBe("P&L")
  })
})

describe("POST /api/onboarding/import/analyze-multi — happy path + persistence", () => {
  beforeEach(async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue({
      id: COMPANY_ID,
      name: "AAC",
      industry: "hospitality",
    })
    aiMocks.extractMapperInput.mockReturnValue({
      sourceFile: "aac.xlsx",
      sourceSheet: "X",
      columns: [{ index: 0, headerText: "KOD", samples: ["601-01"] }],
      sampleRows: [["601-01"]],
    })
    aiMocks.runMapper.mockImplementation(async (input: { sourceSheet: string }) =>
      sampleProposal(input.sourceSheet),
    )
  })

  it("201 with both sheets when both succeed", async () => {
    const res = await POST(await makeRequest())
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.stagingId).toBe(STAGING_ID)
    expect(body.successCount).toBe(2)
    expect(body.failureCount).toBe(0)
    expect(body.perSheet).toHaveLength(2)
    // Persisted shape is MultiSheetProposal {sheets: [...]}
    const createCall = prismaMock.importStaging.create.mock.calls[0][0]
    expect(createCall.data.proposal).toMatchObject({
      sheets: expect.arrayContaining([
        expect.objectContaining({ sheetName: "P&L" }),
        expect.objectContaining({ sheetName: "BS" }),
      ]),
    })
    // sourceSheet stores comma-separated list for forensics
    expect(createCall.data.sourceSheet).toBe("P&L,BS")
    // usage stripped from persisted snapshot
    const persistedSheets = (createCall.data.proposal as { sheets: Array<{ proposal: object }> })
      .sheets
    for (const s of persistedSheets) {
      expect(s.proposal).not.toHaveProperty("usage")
    }
  })

  it("response perSheet includes sourceColumns for each successful sheet", async () => {
    const res = await POST(await makeRequest())
    const body = await res.json()
    for (const r of body.perSheet) {
      expect(r.sourceColumns).toBeDefined()
      expect(Array.isArray(r.sourceColumns)).toBe(true)
    }
  })
})

describe("POST /api/onboarding/import/analyze-multi — per-sheet failure isolation", () => {
  beforeEach(async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue({
      id: COMPANY_ID,
      name: "AAC",
      industry: "hospitality",
    })
  })

  it("one sheet's runMapper throw doesn't abort other sheets", async () => {
    aiMocks.extractMapperInput.mockReturnValue({
      sourceFile: "aac.xlsx",
      sourceSheet: "X",
      columns: [{ index: 0, headerText: "KOD", samples: ["601-01"] }],
      sampleRows: [["601-01"]],
    })
    let callCount = 0
    aiMocks.runMapper.mockImplementation(async (input: { sourceSheet: string }) => {
      callCount++
      if (callCount === 1) throw new Error("LLM transient error")
      return sampleProposal(input.sourceSheet)
    })
    const res = await POST(await makeRequest())
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.successCount).toBe(1)
    expect(body.failureCount).toBe(1)
    expect(body.perSheet[0]).toMatchObject({ sheetName: "P&L", error: expect.stringContaining("mapper failed") })
    expect(body.perSheet[1]).toMatchObject({ sheetName: "BS" })
    // Only the successful sheet persists
    const createCall = prismaMock.importStaging.create.mock.calls[0][0]
    expect((createCall.data.proposal as { sheets: unknown[] }).sheets).toHaveLength(1)
  })

  it("extract failure on a sheet → recorded + skipped, not aborted", async () => {
    let callCount = 0
    aiMocks.extractMapperInput.mockImplementation(() => {
      callCount++
      if (callCount === 1) return { error: "extract failed: empty header band" }
      return {
        sourceFile: "aac.xlsx",
        sourceSheet: "BS",
        columns: [{ index: 0, headerText: "KOD", samples: ["601-01"] }],
        sampleRows: [["601-01"]],
      }
    })
    aiMocks.runMapper.mockImplementation(async (input: { sourceSheet: string }) =>
      sampleProposal(input.sourceSheet),
    )
    const res = await POST(await makeRequest())
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.successCount).toBe(1)
    expect(body.failureCount).toBe(1)
    expect(body.perSheet[0].error).toContain("extract failed")
    expect(aiMocks.runMapper).toHaveBeenCalledOnce() // not called for the failed-extract sheet
  })

  it("422 when ALL sheets fail (no proposal to persist)", async () => {
    aiMocks.extractMapperInput.mockReturnValue({
      sourceFile: "aac.xlsx",
      sourceSheet: "X",
      columns: [{ index: 0, headerText: "KOD", samples: ["601-01"] }],
      sampleRows: [["601-01"]],
    })
    aiMocks.runMapper.mockRejectedValue(new Error("LLM down"))
    const res = await POST(await makeRequest())
    expect(res.status).toBe(422)
    expect(prismaMock.importStaging.create).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.error).toMatch(/all attempts failed/)
    expect(body.perSheet).toHaveLength(2)
  })
})
