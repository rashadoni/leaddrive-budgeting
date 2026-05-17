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

const APPLY_MULTI_RESPONSE_OK = {
  stagingId: "staging_multi_123",
  status: "applied" as const,
  year: 2026,
  inserted: 3,
  deleted: 0,
  successCount: 2,
  failureCount: 0,
  perSheet: [
    {
      sheetName: "P&L",
      inserted: 2,
      warnings: 0,
      parentRollupsDropped: 0,
      parentRollupsUnallocated: 0,
    },
    {
      sheetName: "BS",
      inserted: 1,
      warnings: 1,
      parentRollupsDropped: 2,
      parentRollupsUnallocated: 0,
    },
  ],
  recompute: { ok: 5, unknown: 1, failed: 0, targets: 6 },
  indicatorsStale: false,
  auditStale: false,
}

type RouteHandler = (init: RequestInit | undefined) => Promise<Response> | Response

interface RouteOverrides {
  companies?: RouteHandler
  analyzeMulti?: RouteHandler
  applyMulti?: RouteHandler
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
    if (u.startsWith("/api/onboarding/import/staging/") && u.endsWith("/apply-multi")) {
      if (overrides.applyMulti) return overrides.applyMulti(init)
      return new Response(JSON.stringify(APPLY_MULTI_RESPONSE_OK), {
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
  // Session 9 UX redesign: the submit button is now disabled until BOTH
  // company and file are picked, so erroneous submits can't fire. The
  // prerequisite-hint text below the button replaces the previous
  // error-after-submit pattern. Tests are updated to assert the new
  // contract (better UX: blocked before user clicks vs error after).
  it("submit disabled + hint shown without file", async () => {
    render(<ImportWizardMulti />)
    await waitFor(() => expect(screen.queryByTestId("companies-loading")).toBeNull())
    fireEvent.change(screen.getByTestId("company-select"), {
      target: { value: "co_op_a" },
    })
    // waitFor so the controlled-state update flushes + re-renders before
    // reading the hint text. fireEvent dispatches sync but React state
    // updates and re-render run in the next microtask.
    await waitFor(() => {
      const hint = screen.getByTestId("analyze-prereq-hint")
      expect(hint.textContent?.toLowerCase()).toMatch(/file|xlsx/)
    })
    const btn = screen.getByTestId("analyze-submit") as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it("submit disabled + hint shown without company", async () => {
    render(<ImportWizardMulti />)
    await waitFor(() => expect(screen.queryByTestId("companies-loading")).toBeNull())
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [makeXlsxFile()] },
    })
    await waitFor(() => {
      const hint = screen.getByTestId("analyze-prereq-hint")
      expect(hint.textContent?.toLowerCase()).toMatch(/company/)
    })
    const btn = screen.getByTestId("analyze-submit") as HTMLButtonElement
    expect(btn.disabled).toBe(true)
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

// Phase 7.G Turn CXIII (slice 2) — apply-multi flow
describe("ImportWizardMulti — apply-multi flow (slice 2)", () => {
  /** Run select → analyze pipeline so the apply button is reachable. */
  async function reachAnalyzedStep(extraOverrides: RouteOverrides = {}) {
    installFetchMock(extraOverrides)
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

  it("Apply button NOT rendered when successCount=0 (nothing to apply)", async () => {
    const ALL_FAIL = {
      stagingId: "staging_x",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      successCount: 0,
      failureCount: 2,
      perSheet: [
        { sheetName: "P&L", error: "extract failed" },
        { sheetName: "BS", error: "extract failed" },
      ],
    }
    await reachAnalyzedStep({
      analyzeMulti: () =>
        new Response(JSON.stringify(ALL_FAIL), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    })
    expect(screen.queryByTestId("apply-submit")).toBeNull()
    // restart button still visible
    expect(screen.getByTestId("restart")).toBeTruthy()
  })

  it("happy path: clicks Apply → POST apply-multi → transitions to 'applied' step with stats", async () => {
    let capturedForm: FormData | null = null
    let capturedUrl: string | null = null
    await reachAnalyzedStep({
      applyMulti: async (init) => {
        capturedForm = init?.body as FormData
        return new Response(JSON.stringify(APPLY_MULTI_RESPONSE_OK), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      },
    })
    // Re-install fetch mock to capture the apply-multi URL string
    const originalFetch = global.fetch
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url)
      capturedUrl = u
      capturedForm = init?.body as FormData
      return originalFetch(url, init)
    }) as never

    await act(async () => {
      fireEvent.click(screen.getByTestId("apply-submit"))
    })
    await waitFor(() => expect(screen.getByTestId("applied-results")).toBeTruthy())

    // URL targets apply-multi for the right stagingId
    expect(capturedUrl).toContain("/api/onboarding/import/staging/")
    expect(capturedUrl).toContain("/apply-multi")
    expect(capturedForm).not.toBeNull()
    expect(capturedForm!.get("file")).toBeInstanceOf(File)

    // Summary panel renders inserted + year + per-sheet count
    const summary = screen.getByTestId("applied-results")
    expect(summary.textContent).toContain("3") // inserted
    expect(summary.textContent).toContain("2026") // year
    expect(summary.textContent).toContain("Recompute")
  })

  it("apply 410 → renders staging-terminal error + Restart link", async () => {
    await reachAnalyzedStep({
      applyMulti: () =>
        new Response(JSON.stringify({ error: "Staging proposal has expired" }), {
          status: 410,
          headers: { "content-type": "application/json" },
        }),
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId("apply-submit"))
    })
    await waitFor(() => {
      expect(screen.getByTestId("apply-error")).toBeTruthy()
    })
    // Apply button hidden (stagingTerminal=true gate); Restart link shown
    expect(screen.queryByTestId("apply-submit")).toBeNull()
    const restartAfter = screen.getByTestId("restart-after-terminal")
    expect(restartAfter).toBeTruthy()
    fireEvent.click(restartAfter)
    await waitFor(() => expect(screen.queryByTestId("apply-error")).toBeNull())
    expect(screen.getByTestId("select-form")).toBeTruthy()
  })

  it("indicatorsStale=true → renders warning banner", async () => {
    await reachAnalyzedStep({
      applyMulti: () =>
        new Response(
          JSON.stringify({
            ...APPLY_MULTI_RESPONSE_OK,
            recompute: { ok: 4, unknown: 1, failed: 2, targets: 7 },
            indicatorsStale: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId("apply-submit"))
    })
    await waitFor(() => expect(screen.getByTestId("applied-results")).toBeTruthy())
    expect(screen.getByTestId("indicators-stale-warning")).toBeTruthy()
    // No audit-stale warning when audit succeeded
    expect(screen.queryByTestId("audit-stale-warning")).toBeNull()
  })

  it("auditStale=true → renders audit-stale warning banner", async () => {
    await reachAnalyzedStep({
      applyMulti: () =>
        new Response(
          JSON.stringify({ ...APPLY_MULTI_RESPONSE_OK, auditStale: true }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId("apply-submit"))
    })
    await waitFor(() => expect(screen.getByTestId("applied-results")).toBeTruthy())
    expect(screen.getByTestId("audit-stale-warning")).toBeTruthy()
    // No indicators-stale when recompute clean
    expect(screen.queryByTestId("indicators-stale-warning")).toBeNull()
  })
})
