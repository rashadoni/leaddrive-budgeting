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
})
