// @vitest-environment happy-dom
/**
 * Phase 7.M Tier 5 (2026-05-20) — MultiFileForm UI tests.
 *
 * Covers:
 *  - Empty drop zone disables submit button
 *  - Selecting files renders per-file rows
 *  - Remove ✕ button removes a file
 *  - Step 1 click POSTs to /api/import/ai-auto-multi with files
 *  - Preview result renders per-file file-type chips
 *  - Conflict banner appears on 409 response with diff table
 *  - forceOverride checkbox enables "Apply" button
 *  - File count > 10 shows warning
 *  - Apply click POSTs with apply=1 and renders per-group results
 */
import React from "react"
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from "vitest"
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react"
import { MultiFileForm } from "./MultiFileForm"

let fetchMock: MockInstance

function mockFetchOnce(status: number, body: unknown): void {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response)
}

function makeFakeFile(name: string, size = 1024): File {
  const blob = new Blob([new Uint8Array(size)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  return new File([blob], name, { type: blob.type })
}

beforeEach(() => {
  fetchMock = vi.spyOn(global, "fetch") as unknown as MockInstance
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("MultiFileForm", () => {
  it("disables Step 1 button when no files selected", () => {
    render(<MultiFileForm />)
    const btn = screen.getByTestId("btn-analyze") as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it("adding files via input enables the Step 1 button", () => {
    render(<MultiFileForm />)
    const input = screen.getByTestId("multi-file-input") as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [makeFakeFile("a.xlsx")] },
    })
    expect(screen.getByTestId("file-row-0")).toBeTruthy()
    const btn = screen.getByTestId("btn-analyze") as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })

  it("clicking ✕ removes a file row", () => {
    render(<MultiFileForm />)
    const input = screen.getByTestId("multi-file-input") as HTMLInputElement
    fireEvent.change(input, {
      target: {
        files: [makeFakeFile("a.xlsx"), makeFakeFile("b.xlsx")],
      },
    })
    expect(screen.getByTestId("file-row-0")).toBeTruthy()
    expect(screen.getByTestId("file-row-1")).toBeTruthy()
    fireEvent.click(screen.getByTestId("remove-file-0"))
    // After removal, the remaining file is at index 0
    expect(screen.queryByTestId("file-row-1")).toBeNull()
  })

  it("Step 1 click POSTs to /api/import/ai-auto-multi", async () => {
    mockFetchOnce(200, {
      ok: true,
      mode: "preview",
      perFile: [
        {
          filename: "a.xlsx",
          fileTypeResult: {
            fileType: "main-financial",
            confidence: 0.95,
            reasoning: "PLF+BS+CF",
            sheetCounts: {},
          },
          classifications: [],
          error: null,
        },
      ],
      conflicts: [],
      perGroup: [],
      overallVerdict: "green",
      llmUsage: { inputTokens: 100, outputTokens: 50, modelName: "x" },
      durationMs: 100,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
    })
    render(<MultiFileForm />)
    const input = screen.getByTestId("multi-file-input") as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [makeFakeFile("a.xlsx")] },
    })
    fireEvent.click(screen.getByTestId("btn-analyze"))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce()
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/import/ai-auto-multi")
    expect(init.method).toBe("POST")
    expect(init.body).toBeInstanceOf(FormData)
  })

  it("renders per-file chip after preview response", async () => {
    mockFetchOnce(200, {
      ok: true,
      mode: "preview",
      perFile: [
        {
          filename: "guvven.xlsx",
          fileTypeResult: {
            fileType: "main-financial",
            confidence: 0.95,
            reasoning: "PLF+BS+CF",
            sheetCounts: {},
          },
          classifications: [{ sheetName: "PLF CPC" }],
          error: null,
        },
      ],
      conflicts: [],
      perGroup: [],
      overallVerdict: "green",
      llmUsage: { inputTokens: 100, outputTokens: 50, modelName: "x" },
      durationMs: 100,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
    })
    render(<MultiFileForm />)
    fireEvent.change(screen.getByTestId("multi-file-input"), {
      target: { files: [makeFakeFile("guvven.xlsx")] },
    })
    fireEvent.click(screen.getByTestId("btn-analyze"))
    await waitFor(() => {
      expect(screen.getByTestId("preview-file-guvven.xlsx")).toBeTruthy()
    })
    expect(screen.getByText(/main-financial/)).toBeTruthy()
  })

  it("renders safety receipts before apply and after apply", async () => {
    const previewReceipt = {
      mode: "preview",
      status: "preview_ready",
      year: 2026,
      rows: {
        toWrite: 144,
        committed: 0,
        toArchive: null,
        archiveScopeCount: 1,
      },
      affectedCompanies: ["AZSEKER-CPC"],
      affectedPlans: ["actual"],
      sectionsDetected: [{ dataType: "PLF", sheets: 1 }],
      skippedSheets: [],
      archiveScopes: [
        { companyCode: "AZSEKER-CPC", dataType: "PLF", planKind: "actual" },
      ],
      reconciliation: {
        verdict: "green",
        conflicts: 0,
        groups: [],
      },
      recompute: {
        status: "not_run",
        predictedTargets: 1,
        targets: 0,
        ok: 0,
        unknown: 0,
        failed: 0,
      },
      links: {
        riskTerminal: "/budgeting/terminal",
        indicatorHealth: "/budgeting/admin/indicator-health",
        rollback: "/budgeting/admin/ai-import#import-cleanup",
      },
    }
    const appliedReceipt = {
      ...previewReceipt,
      mode: "applied",
      status: "applied_recompute_failed",
      rows: {
        toWrite: 144,
        committed: 144,
        toArchive: null,
        archiveScopeCount: 1,
      },
      reconciliation: {
        verdict: "green",
        conflicts: 0,
        groups: [
          {
            fileType: "main-financial",
            verdict: "green",
            committed: true,
            rows: 144,
            skipReason: null,
          },
        ],
      },
      recompute: {
        status: "failed",
        predictedTargets: 1,
        targets: 1,
        ok: 0,
        unknown: 0,
        failed: 1,
      },
    }
    mockFetchOnce(200, {
      ok: true,
      mode: "preview",
      perFile: [
        {
          filename: "receipt.xlsx",
          fileTypeResult: {
            fileType: "main-financial",
            confidence: 0.95,
            reasoning: "PLF",
            sheetCounts: {},
          },
          classifications: [
            {
              sheetName: "PLF",
              dataType: "PLF",
              entityCode: "AZSEKER-CPC",
              confidence: 0.95,
              reasoning: "entity",
              planKind: "actual",
              role: "source",
            },
          ],
          error: null,
        },
      ],
      conflicts: [],
      perGroup: [],
      overallVerdict: "green",
      llmUsage: { inputTokens: 100, outputTokens: 50, modelName: "x" },
      durationMs: 100,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
      safetyReceipt: previewReceipt,
    })
    mockFetchOnce(200, {
      ok: true,
      mode: "applied",
      perFile: [],
      conflicts: [],
      perGroup: [
        {
          fileType: "main-financial",
          filenames: ["receipt.xlsx"],
          verdict: "green",
          committed: true,
          totalRowsInserted: 144,
          skipReason: null,
        },
      ],
      overallVerdict: "green",
      llmUsage: { inputTokens: 100, outputTokens: 50, modelName: "x" },
      durationMs: 200,
      recompute: { ok: 0, unknown: 0, failed: 1, targets: 1 },
      warnings: [],
      safetyReceipt: appliedReceipt,
    })

    render(<MultiFileForm />)
    fireEvent.change(screen.getByTestId("multi-file-input"), {
      target: { files: [makeFakeFile("receipt.xlsx")] },
    })
    fireEvent.click(screen.getByTestId("btn-analyze"))
    await waitFor(() => {
      expect(screen.getByTestId("safety-receipt-preview")).toBeTruthy()
    })
    expect(screen.getByTestId("safety-receipt-status-preview")).toBeTruthy()

    fireEvent.click(screen.getByTestId("btn-apply"))
    await waitFor(() => {
      expect(screen.getByTestId("safety-receipt-applied")).toBeTruthy()
    })
    expect(screen.getByTestId("safety-receipt-status-applied")).toBeTruthy()
  })

  it("renders workbook profile chips when preview includes workbookProfile", async () => {
    mockFetchOnce(200, {
      ok: true,
      mode: "preview",
      perFile: [
        {
          filename: "profiled.xlsx",
          workbookProfile: {
            sheetCount: 4,
            workbookPlanHint: "mixed",
            sourceLikeSheets: 2,
            summaryLikeSheets: 1,
            monthLikeSheets: 2,
            sheetsWithBuColumns: 1,
            sheetsWithEliminations: 1,
            duplicateGroups: [{ id: "dup-1", sheetNames: ["A", "B"] }],
          },
          fileTypeResult: {
            fileType: "main-financial",
            confidence: 0.95,
            reasoning: "PLF+BS+CF",
            sheetCounts: {},
          },
          classifications: [{ sheetName: "PLF CPC" }],
          error: null,
        },
      ],
      conflicts: [],
      perGroup: [],
      overallVerdict: "green",
      llmUsage: { inputTokens: 100, outputTokens: 50, modelName: "x" },
      durationMs: 100,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
    })
    render(<MultiFileForm />)
    fireEvent.change(screen.getByTestId("multi-file-input"), {
      target: { files: [makeFakeFile("profiled.xlsx")] },
    })
    fireEvent.click(screen.getByTestId("btn-analyze"))
    await waitFor(() => {
      expect(screen.getByTestId("workbook-profile-profiled.xlsx")).toBeTruthy()
    })
    expect(screen.getByText(/PROFILE BU/)).toBeTruthy()
    expect(screen.getByText(/PROFILE DUPLICATES/)).toBeTruthy()
  })

  it("sends useTemplate=0 when saved-template reuse is disabled", async () => {
    mockFetchOnce(200, {
      ok: true,
      mode: "preview",
      perFile: [],
      conflicts: [],
      perGroup: [],
      overallVerdict: "green",
      llmUsage: { inputTokens: 100, outputTokens: 50, modelName: "x" },
      durationMs: 100,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
      templateUsage: { requested: false, matched: false, skippedAiFiles: [] },
    })
    render(<MultiFileForm />)
    fireEvent.change(screen.getByTestId("multi-file-input"), {
      target: { files: [makeFakeFile("a.xlsx")] },
    })
    const toggle = screen
      .getByTestId("use-template-toggle")
      .querySelector("input") as HTMLInputElement
    fireEvent.click(toggle)
    fireEvent.click(screen.getByTestId("btn-analyze"))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const sentBody = (fetchMock.mock.calls[0] as [string, RequestInit])[1]
      .body as FormData
    expect(sentBody.get("useTemplate")).toBe("0")
  })

  it("manages entity aliases without running import preview", async () => {
    mockFetchOnce(200, {
      ok: true,
      aliases: { CPC: "AZSEKER-CPC" },
      companies: [
        { code: "AZSEKER-CPC", name: "CPC", level: 2 },
        { code: "AZSEKER-EDEN", name: "EDEN", level: 2 },
      ],
    })
    mockFetchOnce(200, {
      ok: true,
      aliases: { CPC: "AZSEKER-CPC", EDEN: "AZSEKER-EDEN" },
      companies: [
        { code: "AZSEKER-CPC", name: "CPC", level: 2 },
        { code: "AZSEKER-EDEN", name: "EDEN", level: 2 },
      ],
      rejected: [],
    })

    render(<MultiFileForm />)
    fireEvent.click(screen.getByTestId("btn-toggle-aliases"))
    await waitFor(() => {
      expect(screen.getByTestId("entity-aliases-editor")).toBeTruthy()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe(
      "/api/import/entity-aliases",
    )

    fireEvent.click(screen.getByTestId("btn-add-alias"))
    fireEvent.change(screen.getByTestId("entity-alias-input-1"), {
      target: { value: "eden" },
    })
    fireEvent.change(screen.getByTestId("entity-alias-company-1"), {
      target: { value: "AZSEKER-EDEN" },
    })
    fireEvent.click(screen.getByTestId("btn-save-aliases"))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe("/api/import/entity-aliases")
    expect(init.method).toBe("PUT")
    expect(JSON.parse(String(init.body))).toEqual({
      aliases: { CPC: "AZSEKER-CPC", EDEN: "AZSEKER-EDEN" },
    })
  })

  it("saves a GREEN preview as an approved template", async () => {
    mockFetchOnce(200, {
      ok: true,
      mode: "preview",
      perFile: [
        {
          filename: "profiled.xlsx",
          workbookProfile: {
            filename: "profiled.xlsx",
            sheetCount: 1,
            totalRows: 10,
            totalColumns: 14,
            workbookPlanHint: "actual",
            sourceLikeSheets: 1,
            summaryLikeSheets: 0,
            monthLikeSheets: 1,
            sheetsWithBuColumns: 0,
            sheetsWithFormulas: 0,
            sheetsWithEliminations: 0,
            duplicateGroups: [],
            repeatedDataHints: [],
            sheets: [{ sheetName: "PLF CPC" }],
          },
          fileTypeResult: {
            fileType: "main-financial",
            confidence: 0.95,
            reasoning: "PLF",
            sheetCounts: {},
          },
          classifications: [
            {
              sheetName: "PLF CPC",
              dataType: "PLF",
              entityCode: "AZSEKER-CPC",
              confidence: 0.95,
              reasoning: "reviewed",
              planKind: "actual",
              role: "source",
            },
          ],
          error: null,
        },
      ],
      conflicts: [],
      perGroup: [],
      overallVerdict: "green",
      llmUsage: { inputTokens: 100, outputTokens: 50, modelName: "x" },
      durationMs: 100,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
      templateUsage: { requested: true, matched: false, skippedAiFiles: [] },
    })
    mockFetchOnce(200, {
      ok: true,
      template: { name: "AI import template (profiled.xlsx)", version: 1 },
    })
    render(<MultiFileForm />)
    fireEvent.change(screen.getByTestId("multi-file-input"), {
      target: { files: [makeFakeFile("profiled.xlsx")] },
    })
    fireEvent.click(screen.getByTestId("btn-analyze"))
    await waitFor(() => {
      expect(screen.getByTestId("preview-result")).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId("btn-save-template"))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe("/api/import/ai-auto-templates")
    expect(init.method).toBe("POST")
    const body = JSON.parse(String(init.body)) as {
      files: Array<{ filename: string }>
      templateId?: string
    }
    expect(body.templateId).toBeUndefined()
    expect(body.files[0].filename).toBe("profiled.xlsx")
    expect(screen.getByTestId("template-save-status")).toBeTruthy()
  })

  it("renders conflict banner on 409 response", async () => {
    mockFetchOnce(409, {
      ok: false,
      error: "Cross-file conflicts detected",
      perFile: [],
      conflicts: [
        {
          key: "AZSEKER-CPC::PLF.01::2026-01",
          occurrences: [
            { filename: "a.xlsx", value: 100 },
            { filename: "b.xlsx", value: 150 },
          ],
          spread: 50,
          spreadPct: 0.5,
        },
      ],
      perGroup: [],
      overallVerdict: "red",
      llmUsage: { inputTokens: 0, outputTokens: 0, modelName: "x" },
      durationMs: 100,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
    })
    render(<MultiFileForm />)
    fireEvent.change(screen.getByTestId("multi-file-input"), {
      target: {
        files: [makeFakeFile("a.xlsx"), makeFakeFile("b.xlsx")],
      },
    })
    fireEvent.click(screen.getByTestId("btn-analyze"))
    await waitFor(() => {
      expect(screen.getByTestId("conflict-banner")).toBeTruthy()
    })
    expect(
      screen.getByTestId("conflict-row-AZSEKER-CPC::PLF.01::2026-01"),
    ).toBeTruthy()
  })

  it("Apply button disabled while conflicts exist (unless forceOverride)", async () => {
    mockFetchOnce(409, {
      ok: false,
      error: "Cross-file conflicts detected",
      perFile: [
        {
          filename: "a.xlsx",
          fileTypeResult: {
            fileType: "main-financial",
            confidence: 0.9,
            reasoning: "x",
            sheetCounts: {},
          },
          classifications: [],
          error: null,
        },
      ],
      conflicts: [
        {
          key: "k1",
          occurrences: [
            { filename: "a.xlsx", value: 100 },
            { filename: "b.xlsx", value: 150 },
          ],
          spread: 50,
          spreadPct: 0.5,
        },
      ],
      perGroup: [],
      overallVerdict: "red",
      llmUsage: { inputTokens: 0, outputTokens: 0, modelName: "x" },
      durationMs: 100,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
    })
    render(<MultiFileForm />)
    fireEvent.change(screen.getByTestId("multi-file-input"), {
      target: { files: [makeFakeFile("a.xlsx")] },
    })
    fireEvent.click(screen.getByTestId("btn-analyze"))
    await waitFor(() => {
      expect(screen.getByTestId("conflict-banner")).toBeTruthy()
    })
    const applyBtn = screen.getByTestId("btn-apply") as HTMLButtonElement
    expect(applyBtn.disabled).toBe(true)
    // Toggling forceOverride enables it
    fireEvent.click(screen.getByTestId("force-override"))
    expect(applyBtn.disabled).toBe(false)
  })

  // Phase 7.M Tier 6 — per-conflict resolution.
  it("per-conflict select dropdown enables Apply when every conflict resolved", async () => {
    mockFetchOnce(409, {
      ok: false,
      error: "Cross-file conflicts detected",
      perFile: [
        {
          filename: "a.xlsx",
          fileTypeResult: {
            fileType: "main-financial",
            confidence: 0.9,
            reasoning: "x",
            sheetCounts: {},
          },
          classifications: [],
          error: null,
        },
      ],
      conflicts: [
        {
          key: "k1",
          occurrences: [
            { filename: "a.xlsx", value: 100 },
            { filename: "b.xlsx", value: 150 },
          ],
          spread: 50,
          spreadPct: 0.5,
        },
      ],
      perGroup: [],
      overallVerdict: "red",
      llmUsage: { inputTokens: 0, outputTokens: 0, modelName: "x" },
      durationMs: 100,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
    })
    render(<MultiFileForm />)
    fireEvent.change(screen.getByTestId("multi-file-input"), {
      target: { files: [makeFakeFile("a.xlsx")] },
    })
    fireEvent.click(screen.getByTestId("btn-analyze"))
    await waitFor(() => {
      expect(screen.getByTestId("conflict-banner")).toBeTruthy()
    })
    const applyBtn = screen.getByTestId("btn-apply") as HTMLButtonElement
    expect(applyBtn.disabled).toBe(true)
    // Pick fileA's value for the conflict — Apply becomes enabled
    fireEvent.change(screen.getByTestId("resolution-k1"), {
      target: { value: "a.xlsx" },
    })
    expect(applyBtn.disabled).toBe(false)
    expect(screen.getByTestId("all-resolved")).toBeTruthy()
  })

  it("per-conflict resolution sent in apply payload as conflictResolutions JSON", async () => {
    // First fetch: 409 with the conflict
    mockFetchOnce(409, {
      ok: false,
      error: "Cross-file conflicts detected",
      perFile: [
        {
          filename: "a.xlsx",
          fileTypeResult: {
            fileType: "main-financial",
            confidence: 0.9,
            reasoning: "x",
            sheetCounts: {},
          },
          classifications: [],
          error: null,
        },
      ],
      conflicts: [
        {
          key: "AZSEKER-CPC::PLF.01::2026-01",
          occurrences: [
            { filename: "a.xlsx", value: 100 },
            { filename: "b.xlsx", value: 150 },
          ],
          spread: 50,
          spreadPct: 0.5,
        },
      ],
      perGroup: [],
      overallVerdict: "red",
      llmUsage: { inputTokens: 0, outputTokens: 0, modelName: "x" },
      durationMs: 100,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
    })
    // Second fetch (apply): success
    mockFetchOnce(200, {
      ok: true,
      mode: "apply",
      perFile: [],
      conflicts: [],
      perGroup: [],
      overallVerdict: "green",
      llmUsage: { inputTokens: 0, outputTokens: 0, modelName: "x" },
      durationMs: 100,
      recompute: { ok: 1, unknown: 0, failed: 0, targets: 1 },
      warnings: [],
    })
    render(<MultiFileForm />)
    fireEvent.change(screen.getByTestId("multi-file-input"), {
      target: { files: [makeFakeFile("a.xlsx")] },
    })
    fireEvent.click(screen.getByTestId("btn-analyze"))
    await waitFor(() => {
      expect(screen.getByTestId("conflict-banner")).toBeTruthy()
    })
    fireEvent.change(
      screen.getByTestId("resolution-AZSEKER-CPC::PLF.01::2026-01"),
      { target: { value: "b.xlsx" } },
    )
    fireEvent.click(screen.getByTestId("btn-apply"))
    await waitFor(() => {
      // 2nd fetch fired
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2)
    })
    const lastCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[1] as [string, { body: FormData }]
    const sentBody = lastCall[1].body
    expect(sentBody.get("conflictResolutions")).toBe(
      JSON.stringify({
        "AZSEKER-CPC::PLF.01::2026-01": { mode: "pick", filename: "b.xlsx" },
      }),
    )
  })

  it("CoA review selection enables apply and sends semanticCoaMappings", async () => {
    mockFetchOnce(200, {
      ok: true,
      mode: "preview",
      perFile: [
        {
          filename: "nocode.xlsx",
          fileTypeResult: {
            fileType: "main-financial",
            confidence: 0.9,
            reasoning: "x",
            sheetCounts: {},
          },
          classifications: [],
          semanticCoa: {
            mappings: [],
            reviewItems: [
              {
                sheetName: "PL",
                dataType: "PLF",
                sourceLabel: "Management fees",
                reason: "No high-confidence P&L code match",
                candidates: [
                  {
                    targetCode: "PLF.06.01.01",
                    accountType: "expense",
                    confidence: 0.7,
                    source: "standard-dictionary",
                    matchedLabel: "admin expenses",
                    reasoning: "similar expense label",
                  },
                ],
              },
            ],
          },
          error: null,
        },
      ],
      conflicts: [],
      perGroup: [],
      overallVerdict: "red",
      llmUsage: { inputTokens: 0, outputTokens: 0, modelName: "x" },
      durationMs: 100,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
    })
    mockFetchOnce(200, {
      ok: true,
      mode: "applied",
      perFile: [],
      conflicts: [],
      perGroup: [],
      overallVerdict: "green",
      llmUsage: { inputTokens: 0, outputTokens: 0, modelName: "x" },
      durationMs: 100,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
    })

    render(<MultiFileForm />)
    fireEvent.change(screen.getByTestId("multi-file-input"), {
      target: { files: [makeFakeFile("nocode.xlsx")] },
    })
    fireEvent.click(screen.getByTestId("btn-analyze"))
    await waitFor(() => {
      expect(screen.getByTestId("coa-review-banner")).toBeTruthy()
    })
    const applyBtn = screen.getByTestId("btn-apply") as HTMLButtonElement
    expect(applyBtn.disabled).toBe(true)

    const select = screen
      .getByTestId("coa-review-banner")
      .querySelector("select") as HTMLSelectElement
    fireEvent.change(select, { target: { value: "PLF.06.01.01" } })
    expect(applyBtn.disabled).toBe(false)
    fireEvent.click(applyBtn)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const body = (fetchMock.mock.calls[1] as [string, RequestInit])[1]
      .body as FormData
    expect(body.get("semanticCoaMappings")).toBe(
      JSON.stringify([
        {
          filename: "nocode.xlsx",
          sheetName: "PL",
          sourceLabel: "Management fees",
          targetCode: "PLF.06.01.01",
          confidence: 0.7,
          action: "map",
        },
      ]),
    )
  })

  it("renders BU routing grid with write and skipped elimination blocks", async () => {
    mockFetchOnce(200, {
      ok: true,
      mode: "preview",
      perFile: [
        {
          filename: "multi-bu.xlsx",
          fileTypeResult: {
            fileType: "main-financial",
            confidence: 0.9,
            reasoning: "x",
            sheetCounts: {},
          },
          classifications: [],
          error: null,
        },
      ],
      conflicts: [],
      perGroup: [],
      overallVerdict: "green",
      llmUsage: { inputTokens: 0, outputTokens: 0, modelName: "x" },
      durationMs: 100,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
      buColumnSplits: [
        {
          filename: "multi-bu.xlsx",
          sheetName: "PLF Actual",
          mapping: [
            {
              sheetName: "PLF Actual [AZSEKER-CPC]",
              entityCode: "AZSEKER-CPC",
              buValue: "CPC",
              rowCount: 10,
              action: "write",
            },
            {
              sheetName: "PLF Actual",
              entityCode: null,
              buValue: "EJE",
              rowCount: 3,
              action: "skip",
              reason: "elimination",
            },
          ],
          warnings: [],
        },
      ],
    })
    render(<MultiFileForm />)
    fireEvent.change(screen.getByTestId("multi-file-input"), {
      target: { files: [makeFakeFile("multi-bu.xlsx")] },
    })
    fireEvent.click(screen.getByTestId("btn-analyze"))
    await waitFor(() => {
      expect(screen.getByTestId("bu-routing-grid")).toBeTruthy()
    })
    expect(screen.getByText("CPC")).toBeTruthy()
    expect(screen.getByText("EJE")).toBeTruthy()
    expect(screen.getByText(/skip/i)).toBeTruthy()
  })

  it("guided sheet fixes mark preview stale and rerun preview with guidedSheetFixes", async () => {
    mockFetchOnce(200, {
      ok: true,
      mode: "preview",
      perFile: [
        {
          filename: "fix.xlsx",
          fileTypeResult: {
            fileType: "main-financial",
            confidence: 0.9,
            reasoning: "x",
            sheetCounts: {},
          },
          classifications: [
            {
              sheetName: "PLF",
              dataType: "PLF",
              entityCode: null,
              confidence: 0.9,
              reasoning: "entity missing",
              planKind: null,
              role: "source",
            },
            {
              sheetName: "Sales CPC",
              dataType: "SALES",
              entityCode: "AZSEKER-CPC",
              confidence: 0.95,
              reasoning: "entity signal",
              planKind: "budget",
              role: "source",
            },
          ],
          error: null,
        },
      ],
      conflicts: [],
      perGroup: [],
      overallVerdict: "green",
      llmUsage: { inputTokens: 0, outputTokens: 0, modelName: "x" },
      durationMs: 100,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
    })
    mockFetchOnce(200, {
      ok: true,
      mode: "preview",
      perFile: [],
      conflicts: [],
      perGroup: [],
      overallVerdict: "green",
      llmUsage: { inputTokens: 0, outputTokens: 0, modelName: "x" },
      durationMs: 90,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
    })

    render(<MultiFileForm />)
    fireEvent.change(screen.getByTestId("multi-file-input"), {
      target: { files: [makeFakeFile("fix.xlsx")] },
    })
    fireEvent.click(screen.getByTestId("btn-analyze"))
    await waitFor(() => {
      expect(screen.getByTestId("guided-fixes-panel")).toBeTruthy()
    })
    const fixKey = "fix.xlsx\u001fPLF"
    fireEvent.change(
      screen.getByTestId(`fix-entity-${encodeURIComponent(fixKey)}`),
      { target: { value: "AZSEKER-CPC" } },
    )
    fireEvent.change(
      screen.getByTestId(`fix-plan-${encodeURIComponent(fixKey)}`),
      { target: { value: "budget" } },
    )
    fireEvent.change(
      screen.getByTestId(`fix-role-${encodeURIComponent(fixKey)}`),
      { target: { value: "source" } },
    )
    expect(screen.getByTestId("stale-fixes-warning")).toBeTruthy()
    expect((screen.getByTestId("btn-apply") as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByTestId("btn-rerun-fixes"))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const body = (fetchMock.mock.calls[1] as [string, RequestInit])[1]
      .body as FormData
    expect(body.get("guidedSheetFixes")).toBe(
      JSON.stringify([
        {
          filename: "fix.xlsx",
          sheetName: "PLF",
          entityCode: "AZSEKER-CPC",
          planKind: "budget",
          role: "source",
        },
      ]),
    )
  })

  it("Import Doctor applies a suggested sheet fix to preview and reruns with guidedSheetFixes", async () => {
    mockFetchOnce(200, {
      ok: true,
      mode: "preview",
      perFile: [
        {
          filename: "doctor.xlsx",
          fileTypeResult: {
            fileType: "main-financial",
            confidence: 0.9,
            reasoning: "x",
            sheetCounts: {},
          },
          classifications: [
            {
              sheetName: "PLF CPC",
              dataType: "PLF",
              entityCode: null,
              confidence: 0.58,
              reasoning: "low entity confidence",
              planKind: null,
              role: "source",
            },
          ],
          error: null,
        },
      ],
      conflicts: [],
      perGroup: [],
      overallVerdict: "green",
      llmUsage: { inputTokens: 0, outputTokens: 0, modelName: "x" },
      durationMs: 100,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
    })
    mockFetchOnce(200, {
      ok: true,
      proposal: {
        kind: "sheet_fix",
        executable: true,
        title: "Route CPC",
        rationale: "The sheet name contains CPC.",
        confidence: 0.92,
        risk: "low",
        patch: {
          filename: "doctor.xlsx",
          sheetName: "PLF CPC",
          entityCode: "AZSEKER-CPC",
          planKind: "actual",
          role: "source",
        },
        requiresPreviewRerun: true,
      },
    })
    mockFetchOnce(200, {
      ok: true,
      mode: "preview",
      perFile: [],
      conflicts: [],
      perGroup: [],
      overallVerdict: "green",
      llmUsage: { inputTokens: 0, outputTokens: 0, modelName: "x" },
      durationMs: 80,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
    })

    render(<MultiFileForm />)
    fireEvent.change(screen.getByTestId("multi-file-input"), {
      target: { files: [makeFakeFile("doctor.xlsx")] },
    })
    fireEvent.click(screen.getByTestId("btn-analyze"))

    await waitFor(() => {
      expect(screen.getByTestId("import-doctor-panel")).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId("btn-doctor-suggest"))

    await waitFor(() => {
      expect(screen.getByTestId("import-doctor-fix")).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId("btn-doctor-apply-preview"))
    expect(screen.getByTestId("import-doctor-status")).toBeTruthy()
    expect((screen.getByTestId("btn-apply") as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByTestId("btn-doctor-rerun-preview"))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[0]).toBe(
      "/api/import/ai-auto-multi/doctor/suggest-fix",
    )
    const body = (fetchMock.mock.calls[2] as [string, RequestInit])[1]
      .body as FormData
    expect(body.get("guidedSheetFixes")).toBe(
      JSON.stringify([
        {
          filename: "doctor.xlsx",
          sheetName: "PLF CPC",
          entityCode: "AZSEKER-CPC",
          planKind: "actual",
          role: "source",
        },
      ]),
    )
  })

  it("Apply click POSTs with apply=1 + renders per-group results", async () => {
    mockFetchOnce(200, {
      ok: true,
      mode: "preview",
      perFile: [
        {
          filename: "fin.xlsx",
          fileTypeResult: {
            fileType: "main-financial",
            confidence: 0.95,
            reasoning: "x",
            sheetCounts: {},
          },
          classifications: [],
          error: null,
        },
      ],
      conflicts: [],
      perGroup: [],
      overallVerdict: "green",
      llmUsage: { inputTokens: 100, outputTokens: 50, modelName: "x" },
      durationMs: 100,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
    })
    mockFetchOnce(200, {
      ok: true,
      mode: "applied",
      perFile: [],
      conflicts: [],
      perGroup: [
        {
          fileType: "main-financial",
          filenames: ["fin.xlsx"],
          verdict: "green",
          committed: true,
          totalRowsInserted: 320,
          skipReason: null,
        },
      ],
      overallVerdict: "green",
      llmUsage: { inputTokens: 100, outputTokens: 50, modelName: "x" },
      durationMs: 200,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
    })
    render(<MultiFileForm />)
    fireEvent.change(screen.getByTestId("multi-file-input"), {
      target: { files: [makeFakeFile("fin.xlsx")] },
    })
    fireEvent.click(screen.getByTestId("btn-analyze"))
    await waitFor(() =>
      expect(screen.getByTestId("preview-result")).toBeTruthy(),
    )
    fireEvent.click(screen.getByTestId("btn-apply"))
    await waitFor(() => {
      expect(screen.getByTestId("apply-result")).toBeTruthy()
    })
    expect(
      screen.getByTestId("apply-group-main-financial"),
    ).toBeTruthy()
    // Verify the second fetch sent apply=1
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondCall = fetchMock.mock.calls[1] as [string, RequestInit]
    const fd = secondCall[1].body as FormData
    expect(fd.get("apply")).toBe("1")
  })

  it("filters non-xlsx files at drop", () => {
    render(<MultiFileForm />)
    fireEvent.change(screen.getByTestId("multi-file-input"), {
      target: {
        files: [
          makeFakeFile("a.xlsx"),
          new File([new Uint8Array(10)], "b.csv"),
        ],
      },
    })
    expect(screen.getByTestId("file-row-0")).toBeTruthy()
    expect(screen.queryByTestId("file-row-1")).toBeNull()
  })

  // ── Phase 11.5 — the target year is explicit, never the browser clock ──
  describe("Phase 11.5 — explicit import year", () => {
    function previewResponse() {
      return {
        ok: true,
        mode: "preview",
        perFile: [],
        conflicts: [],
        perGroup: [],
        overallVerdict: "green",
        llmUsage: { inputTokens: 1, outputTokens: 1, modelName: "x" },
        durationMs: 1,
        recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
        warnings: [],
      }
    }

    it("sends initialYear, not the browser's calendar year", async () => {
      // The regression: this component rendered with no props while its
      // three sibling tabs each received one, so `?year=` never reached the
      // only tab that writes and the year was `new Date().getFullYear()`.
      mockFetchOnce(200, previewResponse())
      render(<MultiFileForm initialYear={2025} />)
      fireEvent.change(screen.getByTestId("multi-file-input"), {
        target: { files: [makeFakeFile("a.xlsx")] },
      })
      fireEvent.click(screen.getByTestId("btn-analyze"))
      await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect((init.body as FormData).get("year")).toBe("2025")
    })

    it("sends the year the user picked", async () => {
      mockFetchOnce(200, previewResponse())
      render(<MultiFileForm initialYear={2026} />)
      fireEvent.change(screen.getByTestId("multi-year"), {
        target: { value: "2024" },
      })
      fireEvent.change(screen.getByTestId("multi-file-input"), {
        target: { files: [makeFakeFile("a.xlsx")] },
      })
      fireEvent.click(screen.getByTestId("btn-analyze"))
      await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect((init.body as FormData).get("year")).toBe("2024")
    })

    it("offers prior years so a post-January re-import stays possible", async () => {
      // After 1 January the old clock-derived year made re-importing the
      // previous year structurally impossible — with the data already erased.
      render(<MultiFileForm initialYear={2026} />)
      const select = screen.getByTestId("multi-year") as HTMLSelectElement
      const values = Array.from(select.options).map((o) => Number(o.value))
      const now = new Date().getFullYear()
      expect(values).toContain(now - 1)
      expect(values).toContain(now - 2)
    })
  })

  // ── 2026-07-30 — a blocked PREVIEW must say why ───────────────────
  //
  // The routing safety gate returns overallVerdict "red" with the reasons in
  // `warnings`, and the screen rendered them only for the APPLY result. On
  // production an operator hit a red preview with no route to the cause,
  // while the Import Doctor button — the only other explanation path — was
  // itself failing on a truncated reply.
  it("renders the gate reasons on a BLOCKED preview, not just the verdict", async () => {
    mockFetchOnce(200, {
      ok: false,
      mode: "preview",
      perFile: [],
      conflicts: [],
      perGroup: [],
      overallVerdict: "red",
      llmUsage: { inputTokens: 1, outputTokens: 1, modelName: "x" },
      durationMs: 10,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [
        'COMPLETENESS: [AZSEKER-CPC::PLF] has only derived view(s) and no source sheet',
        "Routing safety gate — 1 issue(s); aborted before any DB write.",
      ],
    })
    render(<MultiFileForm />)
    fireEvent.change(screen.getByTestId("multi-file-input") as HTMLInputElement, {
      target: { files: [makeFakeFile("a.xlsx")] },
    })
    fireEvent.click(screen.getByTestId("btn-analyze"))

    const box = await screen.findByTestId("preview-warnings")
    expect(box.textContent).toContain("COMPLETENESS")
    expect(box.textContent).toContain("AZSEKER-CPC::PLF")
    expect(box.textContent).toContain("Routing safety gate")
  })

  it("shows no warnings box when the preview is clean", async () => {
    mockFetchOnce(200, {
      ok: true,
      mode: "preview",
      perFile: [],
      conflicts: [],
      perGroup: [],
      overallVerdict: "green",
      llmUsage: { inputTokens: 1, outputTokens: 1, modelName: "x" },
      durationMs: 10,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [],
    })
    render(<MultiFileForm />)
    fireEvent.change(screen.getByTestId("multi-file-input") as HTMLInputElement, {
      target: { files: [makeFakeFile("a.xlsx")] },
    })
    fireEvent.click(screen.getByTestId("btn-analyze"))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(screen.queryByTestId("preview-warnings")).toBeNull()
  })
})
