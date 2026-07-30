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

// Phase 11.8 — the apply path takes a Postgres session advisory lock on a
// dedicated connection. Stub it: these tests assert route behaviour, not
// locking, and must not open a real connection.
vi.mock("@/lib/onboarding/import-lock", () => ({
  acquireImportLock: vi.fn(async () => ({
    acquired: true,
    scope: "ai-import:test:2026",
    release: vi.fn(async () => undefined),
  })),
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
  conflictResolutions?: string
  guidedSheetFixes?: string
  years?: string
  yearFrom?: string
  yearTo?: string
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
  if (opts.conflictResolutions)
    form.append("conflictResolutions", opts.conflictResolutions)
  if (opts.guidedSheetFixes)
    form.append("guidedSheetFixes", opts.guidedSheetFixes)
  if (opts.years) form.append("years", opts.years)
  if (opts.yearFrom) form.append("yearFrom", opts.yearFrom)
  if (opts.yearTo) form.append("yearTo", opts.yearTo)
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
        skipReason: "dryRun=true" as string | null,
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
    parseMetrics: {
      workbookSheets: 1,
      classifiedSheets: 0,
      classificationErrors: 0,
      parsedSheets: 0,
      parsedItems: 0,
      parsedCells: 0,
      skippedSheets: 0,
      blockedSheets: 0,
      adapterWarnings: 0,
      planRelevantSheets: 0,
      planRelevantSheetsWithEntity: 0,
      missingEntitySheets: 0,
    },
    // Phase 11.3 — the orchestrator now reports whether every uploaded file
    // actually landed. Default the stub to a complete run; individual tests
    // override it to exercise the `applied_incomplete` / 409 path.
    completeness: {
      complete: true,
      filesWithErrors: [] as string[],
      unclassifiedFiles: [] as string[],
      groupsNotCommitted: [] as Array<{
        fileType: string
        filenames: string[]
        reason: string
      }>,
    },
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

  it("returns 400 when total size exceeds 40 MB", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    // 5 × 9 MB = 45 MB (cap raised to 40 MB for reporting packs ≈ 25 MB)
    const res = await POST(
      makeMultipartRequest({ fileCount: 5, fileSize: 9 * 1024 * 1024 }) as never,
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/exceeds 40 MB cap/i)
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
      safetyReceipt: { status: string; rows: { toWrite: number } }
    }
    expect(body.ok).toBe(true)
    expect(body.mode).toBe("preview")
    expect(body.perFile).toHaveLength(1)
    expect(body.perGroup).toHaveLength(1)
    expect(body.overallVerdict).toBe("green")
    expect(body.safetyReceipt.status).toBe("preview_ready")
    expect(body.safetyReceipt.rows.toWrite).toBe(0)
  })

  it("returns a safety receipt with affected scope before apply", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const orchResult = defaultOrchResult()
    orchResult.perFile[0].classifications = [
      {
        sheetName: "PLF CPC",
        dataType: "PLF",
        entityCode: "AZSEKER-CPC",
        confidence: 0.96,
        reasoning: "entity in sheet name",
        planKind: "actual",
        role: "source",
      },
      {
        sheetName: "CONS",
        dataType: "BS",
        entityCode: "AZSEKER",
        confidence: 0.88,
        reasoning: "summary",
        planKind: "actual",
        role: "derived_summary",
        roleSignal: "name-pattern",
      },
    ] as never
    orchResult.parseMetrics.parsedItems = 144
    orchestratorMock.runMultiFileImport.mockResolvedValue(orchResult)

    const res = await POST(makeMultipartRequest({ fileCount: 1 }) as never)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      safetyReceipt: {
        rows: { toWrite: number; toArchive: number | null }
        affectedCompanies: string[]
        affectedPlans: string[]
        archiveScopes: Array<{ companyCode: string; dataType: string }>
        skippedSheets: Array<{ sheetName: string }>
        recompute: { predictedTargets: number; status: string }
      }
    }
    expect(body.safetyReceipt.rows.toWrite).toBe(144)
    expect(body.safetyReceipt.rows.toArchive).toBeNull()
    expect(body.safetyReceipt.affectedCompanies).toEqual([
      "AZSEKER",
      "AZSEKER-CPC",
    ])
    expect(body.safetyReceipt.affectedPlans).toEqual(["actual"])
    expect(body.safetyReceipt.archiveScopes).toEqual([
      { companyCode: "AZSEKER-CPC", dataType: "PLF", planKind: "actual" },
    ])
    expect(body.safetyReceipt.skippedSheets).toEqual([
      expect.objectContaining({ sheetName: "CONS" }),
    ])
    expect(body.safetyReceipt.recompute.predictedTargets).toBe(1)
    expect(body.safetyReceipt.recompute.status).toBe("not_run")
  })

  it("surfaces applied recompute failure in the safety receipt", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const orchResult = defaultOrchResult()
    orchResult.perFile[0].classifications = [
      {
        sheetName: "PLF CPC",
        dataType: "PLF",
        entityCode: "AZSEKER-CPC",
        confidence: 0.96,
        reasoning: "entity in sheet name",
        planKind: "actual",
        role: "source",
      },
    ] as never
    orchResult.perGroup[0].committed = true
    orchResult.perGroup[0].skipReason = null
    orchResult.perGroup[0].totalRowsInserted = 12
    orchResult.recompute = { ok: 0, unknown: 0, failed: 1, targets: 1 }
    orchestratorMock.runMultiFileImport.mockResolvedValue(orchResult)

    const res = await POST(
      makeMultipartRequest({ fileCount: 1, apply: "1" }) as never,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      safetyReceipt: {
        status: string
        rows: { committed: number }
        recompute: { failed: number; status: string }
      }
    }
    expect(body.safetyReceipt.status).toBe("applied_recompute_failed")
    expect(body.safetyReceipt.rows.committed).toBe(12)
    expect(body.safetyReceipt.recompute.failed).toBe(1)
    expect(body.safetyReceipt.recompute.status).toBe("failed")
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

  // Phase 7.M Tier 6 — per-conflict resolution map.
  it("conflictResolutions JSON bypasses 409 and is forwarded to the orchestrator", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const orchResult = defaultOrchResult()
    // Orchestrator resolved the conflict thanks to the resolution map →
    // returned conflicts:[] (empty) so the route shouldn't 409.
    orchestratorMock.runMultiFileImport.mockResolvedValue(orchResult)
    const resolutions = {
      "AZSEKER-CPC::PLF.01::2026-01": {
        mode: "pick",
        filename: "fileA.xlsx",
      },
    }
    const res = await POST(
      makeMultipartRequest({
        fileCount: 2,
        apply: "1",
        conflictResolutions: JSON.stringify(resolutions),
      }) as never,
    )
    expect(res.status).toBe(200)
    const call = orchestratorMock.runMultiFileImport.mock.calls[0]
    expect(call[0].conflictResolutions).toEqual(resolutions)
  })

  it("invalid conflictResolutions JSON rejects with 400", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const res = await POST(
      makeMultipartRequest({
        fileCount: 2,
        apply: "1",
        conflictResolutions: "{not valid json",
      }) as never,
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/conflictResolutions JSON/i)
  })

  it("conflictResolutions with invalid entry shape rejects with 400", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const res = await POST(
      makeMultipartRequest({
        fileCount: 2,
        apply: "1",
        conflictResolutions: JSON.stringify({
          k1: { mode: "garbage" },
        }),
      }) as never,
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/conflictResolutions\[k1\]/i)
  })

  it("guidedSheetFixes become exact per-file sheetMap overrides and disable template fast path", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    prismaMock.company.findMany.mockResolvedValueOnce([
      { code: "AZSEKER-CPC", industry: null },
    ])
    orchestratorMock.runMultiFileImport.mockResolvedValue(defaultOrchResult())
    const fixes = [
      {
        filename: "file1.xlsx",
        sheetName: "S1",
        entityCode: "AZSEKER-CPC",
        planKind: "budget",
        role: "source",
      },
    ]

    const res = await POST(
      makeMultipartRequest({
        fileCount: 1,
        guidedSheetFixes: JSON.stringify(fixes),
      }) as never,
    )

    expect(res.status).toBe(200)
    const call = orchestratorMock.runMultiFileImport.mock.calls[0]
    expect(call[0].files[0].templateClassifications).toBeUndefined()
    expect(call[0].files[0].sheetMap).toContainEqual({
      match: "S1",
      entityCode: "AZSEKER-CPC",
      planKind: "budget",
      role: "source",
    })
  })

  it("guidedSheetFixes reject stale sheet names", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const res = await POST(
      makeMultipartRequest({
        fileCount: 1,
        guidedSheetFixes: JSON.stringify([
          { filename: "file1.xlsx", sheetName: "Missing", role: "source" },
        ]),
      }) as never,
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/guidedSheetFixes sheet not found/i)
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

  // ── Phase 11.3 — a partial import must not exit ok:true ──────────────
  it("answers 409 / applied_incomplete when a file never landed", async () => {
    // Classification failed on one of the uploaded files. Before Phase 11.3
    // the run still reported ok:true / applied_complete, which right after a
    // reset reads as "your numbers imported fine" while they are missing.
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const orchResult = defaultOrchResult()
    orchResult.perGroup[0].committed = true
    orchResult.perGroup[0].totalRowsInserted = 12
    orchResult.perGroup[0].skipReason = null
    orchResult.completeness = {
      complete: false,
      filesWithErrors: ["Reporting 2026.xlsx"],
      unclassifiedFiles: [],
      groupsNotCommitted: [],
    }
    orchestratorMock.runMultiFileImport.mockResolvedValue(orchResult)

    const res = await POST(
      makeMultipartRequest({ fileCount: 1, apply: "1" }) as never,
    )
    expect(res.status).toBe(409)
    const body = (await res.json()) as {
      ok: boolean
      safetyReceipt: { status: string }
      completeness: { filesWithErrors: string[] }
    }
    expect(body.ok).toBe(false)
    expect(body.safetyReceipt.status).toBe("applied_incomplete")
    // The specifics travel with the refusal so the user can act on it.
    expect(body.completeness.filesWithErrors).toEqual(["Reporting 2026.xlsx"])
  })

  it("answers 409 when a whole group failed to commit", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const orchResult = defaultOrchResult()
    orchResult.perGroup[0].committed = true
    orchResult.perGroup[0].totalRowsInserted = 5
    orchResult.perGroup[0].skipReason = null
    orchResult.completeness = {
      complete: false,
      filesWithErrors: [],
      unclassifiedFiles: [],
      groupsNotCommitted: [
        {
          fileType: "kpi-only",
          filenames: ["Farming strategy - Guvven.xlsx"],
          reason: "Group commit failed: synthetic",
        },
      ],
    }
    orchestratorMock.runMultiFileImport.mockResolvedValue(orchResult)

    const res = await POST(
      makeMultipartRequest({ fileCount: 1, apply: "1" }) as never,
    )
    expect(res.status).toBe(409)
    const body = (await res.json()) as { safetyReceipt: { status: string } }
    expect(body.safetyReceipt.status).toBe("applied_incomplete")
  })

  it("keeps 200 / ok:true when the apply really was complete", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const orchResult = defaultOrchResult()
    orchResult.perGroup[0].committed = true
    orchResult.perGroup[0].totalRowsInserted = 7
    orchResult.perGroup[0].skipReason = null
    orchestratorMock.runMultiFileImport.mockResolvedValue(orchResult)

    const res = await POST(
      makeMultipartRequest({ fileCount: 1, apply: "1" }) as never,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      safetyReceipt: { status: string }
    }
    expect(body.ok).toBe(true)
    expect(body.safetyReceipt.status).not.toBe("applied_incomplete")
  })

  it("does not call a PREVIEW incomplete — dry runs commit nothing by design", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const orchResult = defaultOrchResult()
    orchResult.completeness = {
      complete: false,
      filesWithErrors: ["x.xlsx"],
      unclassifiedFiles: [],
      groupsNotCommitted: [],
    }
    orchestratorMock.runMultiFileImport.mockResolvedValue(orchResult)

    const res = await POST(makeMultipartRequest({ fileCount: 1 }) as never)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  // ── 2026-07-30 — multi-year target in ONE request ──────────────────
  //
  // The year is scalar THROUGH the pipeline (it resolves the plan, bounds the
  // clean-slate window, drives every adapter's preferYear), so the loop lives
  // at the route: the existing single-year pipeline runs once per year.
  describe("multi-year", () => {
    beforeEach(async () => {
      orchestratorMock.runMultiFileImport.mockResolvedValue(defaultOrchResult())
      // The lock mock is module-level and accumulates across the whole file;
      // clear it so this block asserts ITS calls, not the earlier suites'.
      const { acquireImportLock } = await import("@/lib/onboarding/import-lock")
      ;(acquireImportLock as ReturnType<typeof vi.fn>).mockClear()
    })

    it("runs the pipeline ONCE PER YEAR, ascending", async () => {
      const res = await POST(
        makeMultipartRequest({ fileCount: 1, years: "2026,2025", apply: "1" }) as never,
      )
      expect(res.status).toBeLessThan(400)
      expect(orchestratorMock.runMultiFileImport).toHaveBeenCalledTimes(2)
      const years = orchestratorMock.runMultiFileImport.mock.calls.map(
        (c) => (c[0] as { year: number }).year,
      )
      // Ascending: a later year must not run before the one it may carry
      // comparatives for.
      expect(years).toEqual([2025, 2026])
    })

    it("expands an inclusive range", async () => {
      await POST(
        makeMultipartRequest({ fileCount: 1, yearFrom: "2024", yearTo: "2026" }) as never,
      )
      const years = orchestratorMock.runMultiFileImport.mock.calls.map(
        (c) => (c[0] as { year: number }).year,
      )
      expect(years).toEqual([2024, 2025, 2026])
    })

    it("still runs exactly once for a plain single year", async () => {
      await POST(makeMultipartRequest({ fileCount: 1, year: "2025" }) as never)
      expect(orchestratorMock.runMultiFileImport).toHaveBeenCalledTimes(1)
      expect(
        (orchestratorMock.runMultiFileImport.mock.calls[0][0] as { year: number }).year,
      ).toBe(2025)
    })

    it("reports the outcome per year", async () => {
      const res = await POST(
        makeMultipartRequest({ fileCount: 1, years: "2025,2026" }) as never,
      )
      const body = (await res.json()) as {
        importYears: number[]
        perYear: Array<{ year: number; verdict: string }>
      }
      expect(body.importYears).toEqual([2025, 2026])
      expect(body.perYear.map((y) => y.year)).toEqual([2025, 2026])
    })

    it("gives each year its OWN lock scope", async () => {
      const { acquireImportLock } = await import("@/lib/onboarding/import-lock")
      await POST(
        makeMultipartRequest({ fileCount: 1, years: "2025,2026", apply: "1" }) as never,
      )
      // Scoped (org, year): a concurrent import of a DIFFERENT year stays
      // allowed, exactly as before this change.
      const lockedYears = (acquireImportLock as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => c[1],
      )
      expect(lockedYears).toEqual([2025, 2026])
    })

    it("rejects an inverted range before touching the pipeline", async () => {
      const res = await POST(
        makeMultipartRequest({ fileCount: 1, yearFrom: "2026", yearTo: "2024" }) as never,
      )
      expect(res.status).toBe(400)
      expect(orchestratorMock.runMultiFileImport).not.toHaveBeenCalled()
    })

    it("caps the list rather than running an unbounded number of passes", async () => {
      const res = await POST(
        makeMultipartRequest({
          fileCount: 1,
          years: "2020,2021,2022,2023,2024,2025,2026",
        }) as never,
      )
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/At most 6 years/)
      expect(orchestratorMock.runMultiFileImport).not.toHaveBeenCalled()
    })
  })
})
