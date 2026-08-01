// @vitest-environment happy-dom
/**
 * What the operator is told afterwards. The 207 case is the one that matters:
 * some data is already gone, and the old form threw the breakdown away and
 * printed a bare error string.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (!vars) return key
    return `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(",")})`
  },
}))
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

import { RunResult } from "./RunResult"

afterEach(cleanup)

describe("RunResult", () => {
  it("shows the green panel with the breakdown that came BACK, not the preview", () => {
    render(
      <RunResult
        outcome={{
          kind: "done",
          rowsAffected: 1284,
          breakdown: { budgetLine: 1147, budgetActualManual: 137 },
          recomputed: 42,
          companiesDeleted: ["A", "B"],
        }}
      />,
    )
    expect(screen.getByTestId("run-result-done")).toBeTruthy()
    expect(screen.getByText("result.done.title(rows=1284,companies=2)")).toBeTruthy()
    expect(screen.getByText("result.done.recompute(count=42)")).toBeTruthy()
    expect(screen.getByText("category.budgetLine")).toBeTruthy()
  })

  it("does not count records as rows — the preview headline spent three keys on that", () => {
    // The server's `rowsAffected` is Σ breakdown, records included. The
    // preview says "1877 rows + 17 records"; this panel used to say
    // "1894 rows deleted" for the same operation.
    render(
      <RunResult
        outcome={{
          kind: "done",
          rowsAffected: 1894,
          breakdown: { budgetLine: 1877, recordsCompliance: 5, complianceWriteBacks: 12 },
          recomputed: 0,
          companiesDeleted: ["A"],
        }}
      />,
    )
    expect(screen.getByText("result.done.title(rows=1877,companies=1)")).toBeTruthy()
    expect(screen.queryByText(/rows=1894/)).toBeNull()
    expect(screen.getByTestId("result-done-records").textContent).toBe(
      "result.done.records(records=17)",
    )
    // …and a row is no longer typographically identical to a record.
    expect(screen.getByText("unit.rows(count=1877)")).toBeTruthy()
    expect(screen.getByText("unit.items(count=12)")).toBeTruthy()
  })

  it("renders 207 as PARTLY DONE, never as the green panel, and names both lists", () => {
    render(
      <RunResult
        outcome={{
          kind: "partial",
          rowsAffected: 600,
          breakdown: { budgetLine: 600 },
          companiesDeleted: ["A"],
          companiesFailed: ["B", "C"],
          orphanTailRemains: false,
        }}
      />,
    )
    expect(screen.queryByTestId("run-result-done")).toBeNull()
    expect(screen.getByTestId("run-result-partial")).toBeTruthy()
    expect(screen.getByText("result.partial.deleted(list=A)")).toBeTruthy()
    // "Not deleted" has to name them — "partly done" alone is unactionable.
    expect(screen.getByText("result.partial.untouched(list=B, C)")).toBeTruthy()
    // The breakdown describes data that is ALREADY GONE. It must be shown.
    expect(screen.getByText("category.budgetLine")).toBeTruthy()
  })

  it("offers a retry for exactly the companies that failed, and only re-checks", () => {
    const onRetryFailed = vi.fn()
    render(
      <RunResult
        outcome={{
          kind: "partial",
          rowsAffected: 0,
          breakdown: {},
          companiesDeleted: [],
          companiesFailed: ["B", "C"],
          orphanTailRemains: false,
        }}
        onRetryFailed={onRetryFailed}
      />,
    )
    fireEvent.click(screen.getByText("result.partial.retry(count=2)"))
    expect(onRetryFailed).toHaveBeenCalledWith(["B", "C"])
  })

  it("reports the org-level tail when the companies all succeeded but the sweep did not", () => {
    render(
      <RunResult
        outcome={{
          kind: "partial",
          rowsAffected: 10,
          breakdown: { budgetLine: 10 },
          companiesDeleted: ["A"],
          companiesFailed: [],
          orphanTailRemains: true,
        }}
      />,
    )
    expect(screen.getByText("result.partial.orphan")).toBeTruthy()
  })

  it("says nothing was deleted on a drift 409, and shows both numbers", () => {
    render(
      <RunResult
        outcome={{
          kind: "drift",
          expected: 1284,
          actual: 1290,
          preview: { breakdown: {}, rowsAffected: 1290 } as never,
        }}
      />,
    )
    expect(screen.getByTestId("run-result-drift").textContent).toContain("result.drift")
    // Labelled, not a bare arrow: "1284 → 1290" says nothing about which is
    // which, or that neither of them was deleted.
    expect(
      screen.getByText("result.driftNumbers(expected=1284,actual=1290)"),
    ).toBeTruthy()
  })

  it("counts down on a 429 instead of just saying no", () => {
    render(<RunResult outcome={{ kind: "rateLimited", retryAfterSeconds: 37 }} />)
    expect(screen.getByText("result.rateLimited(seconds=37)")).toBeTruthy()
  })

  it("names the closed period on a 423", () => {
    render(<RunResult outcome={{ kind: "locked", period: "2025", reason: "Audit period" }} />)
    expect(screen.getByText("result.locked(year=2025)")).toBeTruthy()
    expect(screen.getByText("Audit period")).toBeTruthy()
  })

  it("says nothing was changed on a hard failure", () => {
    render(<RunResult outcome={{ kind: "failed", message: "ECONNRESET" }} />)
    expect(screen.getByText("result.failed")).toBeTruthy()
    expect(screen.getByText("ECONNRESET")).toBeTruthy()
  })
})
