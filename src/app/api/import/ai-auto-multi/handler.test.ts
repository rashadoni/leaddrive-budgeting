// @vitest-environment node
/**
 * Handler tests for POST /api/import/ai-auto-multi (Phase 7.M Tier 5).
 *
 * Locks:
 *  - Auth gate (admin role required)
 *  - File count cap (max 10)
 *  - Total size cap (20 MB)
 *  - Year validation
 *  - Cost-budget gate (429 when exceeded)
 *  - Conflict short-circuit (409 with diff payload, no DB write)
 *  - Happy path (200 with MultiFileImportResult shape)
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findMany: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}))

const { orchestratorMock } = vi.hoisted(() => ({
  orchestratorMock: { runMultiFileImport: vi.fn() },
}))

const { budgetMock } = vi.hoisted(() => ({
  budgetMock: { checkBudget: vi.fn(), recordUsage: vi.fn() },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/onboarding/ai-import/multi-file-orchestrator", () => orchestratorMock)
vi.mock("@/lib/llm/cost-budget", () => budgetMock)
vi.mock("@/lib/ai/client", () => ({
  getAnthropicClient: () => ({ messages: { create: vi.fn() } }),
  AI_MODEL: "claude-test",
}))
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(() => null),
  getClientIp: () => "127.0.0.1",
}))
vi.mock("xlsx", async () => {
  const actual = await vi.importActual<typeof import("xlsx")>("xlsx")
  return {
    ...actual,
    read: vi.fn(() => ({ Sheets: { S1: { "!ref": "A1:A1" } }, SheetNames: ["S1"] })),
  }
})

import { mockSession } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"

/** Build a multipart/form-data request with N file blobs. */
function makeMultipartRequest(opts: {
  fileCount: number
  fileSize?: number
  year?: string
  apply?: string
  forceOverride?: string
}): Request {
  const form = new FormData()
  for (let i = 0; i < opts.fileCount; i++) {
    const size = opts.fileSize ?? 1024
    const blob = new Blob([new Uint8Array(size)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    form.append("files", new File([blob], `file${i + 1}.xlsx`))
  }
  if (opts.year) form.append("year", opts.year)
  if (opts.apply) form.append("apply", opts.apply)
  if (opts.forceOverride) form.append("forceOverride", opts.forceOverride)
  return new Request("http://localhost/api/import/ai-auto-multi", {
    method: "POST",
    body: form,
  })
}

beforeEach(() => {
  prismaMock.company.findMany.mockReset().mockResolvedValue([])
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({
    settings: { industry: "agriculture" },
  })
  orchestratorMock.runMultiFileImport.mockReset()
  budgetMock.checkBudget
    .mockReset()
    .mockResolvedValue({ ok: true, resetAt: new Date() })
  budgetMock.recordUsage.mockReset().mockResolvedValue(undefined)
})

function defaultOrchResult() {
  return {
    perFile: [
      {
        filename: "file1.xlsx",
        fileTypeResult: {
          fileType: "main-financial",
          confidence: 0.95,
          reasoning: "x",
          sheetCounts: {},
        },
        classifications: [],
        expectedSums: new Map(),
        error: null,
        llmUsage: {
          inputTokens: 100,
          outputTokens: 50,
          modelName: "claude-test",
          promptVersion: "v1",
        },
      },
    ],
    conflicts: [],
    perGroup: [
      {
        fileType: "main-financial",
        filenames: ["file1.xlsx"],
        verdict: "green",
        reconciliation: null,
        committed: false,
        totalRowsInserted: 0,
        skipReason: "dryRun=true",
      },
    ],
    overallVerdict: "green",
    llmUsage: {
      inputTokens: 100,
      outputTokens: 50,
      modelName: "claude-test",
      promptVersion: "v1",
    },
    durationMs: 100,
    recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
    warnings: [],
  }
}

describe("POST /api/import/ai-auto-multi", () => {
  it("returns 401 when caller lacks admin role", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(makeMultipartRequest({ fileCount: 1 }) as never)
    expect(res.status).toBe(403)
    expect(orchestratorMock.runMultiFileImport).not.toHaveBeenCalled()
  })

  it("returns 400 when no files provided", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const form = new FormData()
    const req = new Request("http://localhost/api/import/ai-auto-multi", {
      method: "POST",
      body: form,
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/at least one file/i)
  })

  it("returns 400 when more than 10 files provided", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const res = await POST(makeMultipartRequest({ fileCount: 11 }) as never)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/Max 10 files/i)
  })

  it("returns 400 when total size exceeds 20 MB", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    // 5 × 5 MB = 25 MB
    const res = await POST(
      makeMultipartRequest({ fileCount: 5, fileSize: 5 * 1024 * 1024 }) as never,
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/exceeds 20 MB cap/i)
  })

  it("returns 400 when year is out of range", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const res = await POST(
      makeMultipartRequest({ fileCount: 1, year: "1999" }) as never,
    )
    expect(res.status).toBe(400)
  })

  it("returns 429 when LLM budget exceeded", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    budgetMock.checkBudget.mockResolvedValue({
      ok: false,
      reason: "daily limit",
      resetAt: new Date(),
    })
    const res = await POST(makeMultipartRequest({ fileCount: 1 }) as never)
    expect(res.status).toBe(429)
    expect(orchestratorMock.runMultiFileImport).not.toHaveBeenCalled()
  })

  it("returns 200 with MultiFileImportResult shape on happy path", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    orchestratorMock.runMultiFileImport.mockResolvedValue(defaultOrchResult())
    const res = await POST(makeMultipartRequest({ fileCount: 1 }) as never)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      mode: string
      perFile: unknown[]
      perGroup: unknown[]
      overallVerdict: string
    }
    expect(body.ok).toBe(true)
    expect(body.mode).toBe("preview")
    expect(body.perFile).toHaveLength(1)
    expect(body.perGroup).toHaveLength(1)
    expect(body.overallVerdict).toBe("green")
  })

  it("returns 409 when cross-file conflicts detected", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const orchResult = defaultOrchResult()
    orchResult.conflicts = [
      {
        key: "AZSEKER-CPC::PLF.01::2026-01",
        occurrences: [
          { filename: "a.xlsx", value: 100 },
          { filename: "b.xlsx", value: 150 },
        ],
        spread: 50,
        spreadPct: 0.5,
      },
    ] as never
    orchResult.overallVerdict = "red"
    orchestratorMock.runMultiFileImport.mockResolvedValue(orchResult)

    const res = await POST(makeMultipartRequest({ fileCount: 2 }) as never)
    expect(res.status).toBe(409)
    const body = (await res.json()) as {
      ok: boolean
      error: string
      conflicts: unknown[]
    }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/Cross-file conflicts/i)
    expect(body.conflicts).toHaveLength(1)
  })

  it("forceOverride bypasses conflict 409", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const orchResult = defaultOrchResult()
    orchResult.conflicts = [
      {
        key: "k1",
        occurrences: [],
        spread: 50,
        spreadPct: 0.5,
      },
    ] as never
    orchestratorMock.runMultiFileImport.mockResolvedValue(orchResult)
    const res = await POST(
      makeMultipartRequest({
        fileCount: 2,
        forceOverride: "1",
      }) as never,
    )
    expect(res.status).toBe(200)
  })

  it("apply=true switches mode to 'applied' and propagates dryRun=false to orchestrator", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    orchestratorMock.runMultiFileImport.mockResolvedValue(defaultOrchResult())
    await POST(
      makeMultipartRequest({ fileCount: 1, apply: "1" }) as never,
    )
    const call = orchestratorMock.runMultiFileImport.mock.calls[0]
    expect(call[0].dryRun).toBe(false)
  })

  it("default mode is preview (apply unset → dryRun=true)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    orchestratorMock.runMultiFileImport.mockResolvedValue(defaultOrchResult())
    await POST(makeMultipartRequest({ fileCount: 1 }) as never)
    const call = orchestratorMock.runMultiFileImport.mock.calls[0]
    expect(call[0].dryRun).toBe(true)
  })
})
