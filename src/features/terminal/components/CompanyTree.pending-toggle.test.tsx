// @vitest-environment happy-dom
/**
 * Truth-infra C.3 closure — admin "Show pending" toggle integration test.
 *
 * Locks: default state hides pending pill + button label says "+pending";
 * click flips state, useMatrix is re-called with includePending=true,
 * and PendingPill renders next to companies with status='pending'.
 */

import React from "react"
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, fireEvent, cleanup, act } from "@testing-library/react"

const { useMatrixMock } = vi.hoisted(() => ({ useMatrixMock: vi.fn() }))
vi.mock("../hooks/use-matrix", () => ({ useMatrix: useMatrixMock }))

import { CompanyTree, type CompanyNode } from "./CompanyTree"

const COMPANIES: CompanyNode[] = [
  {
    id: "aac_id",
    code: "AAC",
    name: "AAC Holding",
    industry: "industrial",
  },
  {
    id: "pending_co_id",
    code: "NEW-CO",
    name: "Pending Co",
    industry: "industrial",
  },
]

function mockMatrix(opts: { includePending: boolean }) {
  // Returns AAC always; NEW-CO only when includePending=true.
  useMatrixMock.mockImplementation((_period: string | undefined, includePending: boolean) => ({
    matrix: {
      period: "2026",
      companies: opts.includePending
        ? [
            { id: "aac_id", code: "AAC", name: "AAC Holding", industry: "industrial", status: "active" },
            { id: "pending_co_id", code: "NEW-CO", name: "Pending Co", industry: "industrial", status: "pending" },
          ]
        : [{ id: "aac_id", code: "AAC", name: "AAC Holding", industry: "industrial", status: "active" }],
      indicators: [],
      cells: [],
    },
    loading: false,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
  }))
}

afterEach(() => {
  cleanup()
  useMatrixMock.mockReset()
})

describe("CompanyTree — Truth-infra C.3 pending toggle", () => {
  it("renders toggle button with aria-pressed=false by default", () => {
    // i18n placeholder substitution isn't resolved in test env (returns
    // the SCREAMING_SNAKE_CASE key); we assert structural contract (testid
    // + aria-pressed) instead of resolved label text.
    mockMatrix({ includePending: false })
    const { getByTestId } = render(<CompanyTree companies={COMPANIES} />)
    const btn = getByTestId("company-tree-show-pending-toggle")
    expect(btn).toBeTruthy()
    expect(btn.getAttribute("aria-pressed")).toBe("false")
  })

  it("no PendingPill rendered while toggle off", () => {
    mockMatrix({ includePending: false })
    const { queryByTestId } = render(<CompanyTree companies={COMPANIES} />)
    expect(queryByTestId("company-tree-pending-pill")).toBeNull()
  })

  it("calls useMatrix with includePending=false on first render", () => {
    mockMatrix({ includePending: false })
    render(<CompanyTree companies={COMPANIES} />)
    // useMatrix was called with (undefined, false)
    expect(useMatrixMock).toHaveBeenCalledWith(undefined, false)
  })

  it("toggle flips aria-pressed to true on click", () => {
    mockMatrix({ includePending: false })
    const { getByTestId } = render(<CompanyTree companies={COMPANIES} />)
    const btn = getByTestId("company-tree-show-pending-toggle")
    act(() => {
      fireEvent.click(btn)
    })
    expect(btn.getAttribute("aria-pressed")).toBe("true")
  })

  it("after toggle: useMatrix is re-called with includePending=true", () => {
    mockMatrix({ includePending: false })
    const { getByTestId } = render(<CompanyTree companies={COMPANIES} />)
    useMatrixMock.mockClear()
    // Re-mock for the post-click render — pending company appears now
    mockMatrix({ includePending: true })
    act(() => {
      fireEvent.click(getByTestId("company-tree-show-pending-toggle"))
    })
    // After re-render, useMatrix was called with (undefined, true)
    expect(useMatrixMock).toHaveBeenCalledWith(undefined, true)
  })

  it("PendingPill renders for companies with status='pending' when toggle on", () => {
    // Start with toggle off, then click to flip on. After flip, the
    // hook returns the pending company, and the pill should render.
    mockMatrix({ includePending: false })
    const { getByTestId, getAllByTestId } = render(<CompanyTree companies={COMPANIES} />)
    mockMatrix({ includePending: true })
    act(() => {
      fireEvent.click(getByTestId("company-tree-show-pending-toggle"))
    })
    const pills = getAllByTestId("company-tree-pending-pill")
    expect(pills.length).toBeGreaterThanOrEqual(1)
  })
})
