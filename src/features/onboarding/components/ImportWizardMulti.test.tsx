// @vitest-environment happy-dom
/**
 * Phase 7.G Turn CXII (Phase 7.B v2 Day 4 — multi-sheet wizard slice 1) —
 * tests for `ImportWizardMulti`. Locks the select → analyzed state machine
 * + the 2 fetch contracts the wizard speaks (`/api/companies` on mount,
 * `/api/onboarding/import/analyze-multi` on submit).
 *
 * Apply flow + per-sheet review tabs ship in slice 2 (Turn CXIII).
 */

import React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react"
import { ImportWizardMulti } from "./ImportWizardMulti"

const COMPANIES_PAYLOAD = {
  companies: [
    {
      id: "co_op_solo",
      code: "C-OP",
      name: "Operational C",
      industry: "hospitality",
      level: 2,
    },
    {
      id: "co_op_a",
      code: "A-OP",
      name: "Operational A",
      industry: "agro_crops",
      level: 2,
    },
  ],
}

const ANALYZE_MULTI_RESPONSE_OK = {
  stagingId: "staging_multi_123",
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  successCount: 2,
  failureCount: 0,
  perSheet: [
    {
      sheetName: "P&L",
      proposal: {
        sourceFile: "test.xlsx",
        sourceSheet: "P&L",
        columns: [
          { sourceIndex: 0, role: "code" as const, confidence: 0.9, reasoning: "x" },
          { sourceIndex: 1, role: "skip" as const, confidence: 0.4, reasoning: "y" },
        ],
        anomalies: [],
        overallConfidence: 0.85,
        summary: "P&L sheet",
      },
      sourceColumns: [
        { sourceIndex: 0, headerText: "KOD" },
        { sourceIndex: 1, headerText: "Description" },
      ],
    },
    {
      sheetName: "BS",
      proposal: {
        sourceFile: "test.xlsx",
        sourceSheet: "BS",
        columns: [
          { sourceIndex: 0, role: "code" as const, confidence: 0.95, reasoning: "x" },
        ],
        anomalies: [],
        overallConfidence: 0.93,
        summary: "Balance sheet",
      },
      sourceColumns: [{ sourceIndex: 0, headerText: "KOD" }],
    },
  ],
}

const ANALYZE_MULTI_RESPONSE_MIXED = {
  stagingId: "staging_multi_456",
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  successCount: 1,
  failureCount: 1,
  perSheet: [
    { sheetName: "P&L", error: "mapper failed: LLM transient error" },
    {
      sheetName: "BS",
      proposal: {
        sourceFile: "test.xlsx",
        sourceSheet: "BS",
        columns: [
          { sourceIndex: 0, role: "code" as const, confidence: 0.95, reasoning: "x" },
        ],
        anomalies: [],
        overallConfidence: 0.93,
        summary: "Balance sheet",
      },
      sourceColumns: [{ sourceIndex: 0, headerText: "KOD" }],
    },
  ],
}

type RouteHandler = (init: RequestInit | undefined) => Promise<Response> | Response

interface RouteOverrides {
  companies?: RouteHandler
  analyzeMulti?: RouteHandler
}

function installFetchMock(overrides: RouteOverrides = {}): void {
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    if (u === "/api/companies") {
      if (overrides.companies) return overrides.companies(init)
      return new Response(JSON.stringify(COMPANIES_PAYLOAD), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    if (u === "/api/onboarding/import/analyze-multi") {
      if (overrides.analyzeMulti) return overrides.analyzeMulti(init)
      return new Response(JSON.stringify(ANALYZE_MULTI_RESPONSE_OK), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    return new Response("not found", { status: 404 })
  }) as never
}

function makeXlsxFile(name = "test.xlsx"): File {
  return new File(["dummy-bytes"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
}

beforeEach(() => {
  installFetchMock()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("ImportWizardMulti — initial render + companies fetch", () => {
  it("mounts in 'select' step with select-form rendered", async () => {
    render(<ImportWizardMulti />)
    expect(screen.getByTestId("import-wizard-multi")).toBeTruthy()
    expect(screen.getByTestId("select-form")).toBeTruthy()
  })

  it("populates company dropdown with operational companies sorted by code", async () => {
    render(<ImportWizardMulti />)
    await waitFor(() => {
      expect(screen.queryByTestId("companies-loading")).toBeNull()
    })
    const select = screen.getByTestId("company-select") as HTMLSelectElement
    const options = Array.from(select.options).map((o) => o.value)
    // First is the placeholder "" + companies sorted alphabetically by code
    expect(options[0]).toBe("")
    expect(options.slice(1)).toEqual(["co_op_a", "co_op_solo"]) // A-OP before C-OP
  })

  it("companies fetch failure renders inline error", async () => {
    installFetchMock({
      companies: () => new Response("server boom", { status: 500 }),
    })
    render(<ImportWizardMulti />)
    await waitFor(() => {
      expect(screen.getByTestId("companies-error")).toBeTruthy()
    })
  })
})

describe("ImportWizardMulti — analyze-multi POST", () => {
  it("submit without file shows analyze-error", async () => {
    render(<ImportWizardMulti />)
    await waitFor(() => expect(screen.queryByTestId("companies-loading")).toBeNull())
    fireEvent.change(screen.getByTestId("company-select"), {
      target: { value: "co_op_a" },
    })
    fireEvent.click(screen.getByTestId("analyze-submit"))
    await waitFor(() => {
      const err = screen.getByTestId("analyze-error")
      expect(err.textContent).toMatch(/.xlsx file/)
    })
  })

  it("submit without company shows analyze-error", async () => {
    render(<ImportWizardMulti />)
    await waitFor(() => expect(screen.queryByTestId("companies-loading")).toBeNull())
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [makeXlsxFile()] },
    })
    fireEvent.click(screen.getByTestId("analyze-submit"))
    await waitFor(() => {
      const err = screen.getByTestId("analyze-error")
      expect(err.textContent).toMatch(/target company/)
    })
  })

  it("happy path: posts FormData with file + companyId; transitions to 'analyzed'", async () => {
    let capturedForm: FormData | null = null
    installFetchMock({
      analyzeMulti: async (init) => {
        capturedForm = init?.body as FormData
        return new Response(JSON.stringify(ANALYZE_MULTI_RESPONSE_OK), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      },
    })
    render(<ImportWizardMulti />)
    await waitFor(() => expect(screen.queryByTestId("companies-loading")).toBeNull())
    fireEvent.change(screen.getByTestId("company-select"), {
      target: { value: "co_op_a" },
    })
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [makeXlsxFile()] },
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId("analyze-submit"))
    })
    await waitFor(() => {
      expect(screen.getByTestId("analyzed-results")).toBeTruthy()
    })
    expect(capturedForm).not.toBeNull()
    expect(capturedForm!.get("companyId")).toBe("co_op_a")
    expect(capturedForm!.get("file")).toBeInstanceOf(File)
  })

  it("appends optional sheetNames + industryHint when filled", async () => {
    let capturedForm: FormData | null = null
    installFetchMock({
      analyzeMulti: async (init) => {
        capturedForm = init?.body as FormData
        return new Response(JSON.stringify(ANALYZE_MULTI_RESPONSE_OK), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      },
    })
    render(<ImportWizardMulti />)
    await waitFor(() => expect(screen.queryByTestId("companies-loading")).toBeNull())
    fireEvent.change(screen.getByTestId("company-select"), {
      target: { value: "co_op_a" },
    })
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [makeXlsxFile()] },
    })
    fireEvent.change(screen.getByTestId("sheet-filter-input"), {
      target: { value: "P&L, BS" },
    })
    fireEvent.change(screen.getByTestId("industry-select"), {
      target: { value: "industrial" },
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId("analyze-submit"))
    })
    await waitFor(() => expect(screen.getByTestId("analyzed-results")).toBeTruthy())
    expect(capturedForm!.get("sheetNames")).toBe("P&L, BS")
    expect(capturedForm!.get("industryHint")).toBe("industrial")
  })

  it("analyze 4xx surfaces server error message", async () => {
    installFetchMock({
      analyzeMulti: () =>
        new Response(JSON.stringify({ error: "Sheet 'Foo' not found" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    })
    render(<ImportWizardMulti />)
    await waitFor(() => expect(screen.queryByTestId("companies-loading")).toBeNull())
    fireEvent.change(screen.getByTestId("company-select"), {
      target: { value: "co_op_a" },
    })
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [makeXlsxFile()] },
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId("analyze-submit"))
    })
    await waitFor(() => {
      const err = screen.getByTestId("analyze-error")
      expect(err.textContent).toContain("Sheet 'Foo' not found")
    })
  })
})

describe("ImportWizardMulti — analyzed step rendering", () => {
  async function reachAnalyzedStep() {
    render(<ImportWizardMulti />)
    await waitFor(() => expect(screen.queryByTestId("companies-loading")).toBeNull())
    fireEvent.change(screen.getByTestId("company-select"), {
      target: { value: "co_op_a" },
    })
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [makeXlsxFile()] },
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId("analyze-submit"))
    })
    await waitFor(() => expect(screen.getByTestId("analyzed-results")).toBeTruthy())
  }

  it("renders OK chip for each successful sheet + ERROR chip for failures", async () => {
    installFetchMock({
      analyzeMulti: () =>
        new Response(JSON.stringify(ANALYZE_MULTI_RESPONSE_MIXED), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    })
    await reachAnalyzedStep()
    const list = screen.getByTestId("per-sheet-list")
    expect(list).toBeTruthy()
    expect(screen.getByTestId("sheet-row-P&L")).toBeTruthy()
    expect(screen.getByTestId("sheet-row-BS")).toBeTruthy()
    // Error chip on the failed sheet
    const pnlRow = screen.getByTestId("sheet-row-P&L")
    expect(pnlRow.textContent).toContain("ERROR")
    expect(pnlRow.textContent).toContain("LLM transient error")
    // OK chip on success
    const bsRow = screen.getByTestId("sheet-row-BS")
    expect(bsRow.textContent).toContain("OK")
    expect(bsRow.textContent).toContain("93%") // overallConfidence
  })

  it("renders summary line with success/failure counts + stagingId", async () => {
    installFetchMock({
      analyzeMulti: () =>
        new Response(JSON.stringify(ANALYZE_MULTI_RESPONSE_MIXED), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    })
    await reachAnalyzedStep()
    const summary = screen.getByTestId("analyzed-results")
    expect(summary.textContent).toContain("staging_multi_456")
    expect(summary.textContent).toContain("succeeded")
    expect(summary.textContent).toContain("failed")
  })

  it("Start over button resets back to 'select' step", async () => {
    await reachAnalyzedStep()
    fireEvent.click(screen.getByTestId("restart"))
    await waitFor(() => expect(screen.queryByTestId("analyzed-results")).toBeNull())
    expect(screen.getByTestId("select-form")).toBeTruthy()
  })
})
