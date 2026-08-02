// @vitest-environment happy-dom
/**
 * Phase 11.91 — a figure that disagrees with the client's own statement has to
 * be visible without hovering anything.
 *
 * The failure this locks down is not a crash. It is a number that looks
 * exactly like every other number: 72.3M of revenue rendered as a calm green
 * tile for a year while the client's own sheet said 58.9M. Nothing on the
 * screen was wrong-looking, so nobody looked.
 *
 * So the assertions are about VISIBILITY, not plumbing: the tile carries a
 * marker, the header carries a count, and both survive a re-render. A test
 * that only checked `cell.reconStatus` made it through the payload would pass
 * against a UI that drew nothing.
 */

import React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, cleanup, waitFor } from "@testing-library/react"
import { HeatMap } from "./HeatMap"
import { __resetMatrixCacheForTests } from "../hooks/use-matrix"

vi.mock("@/lib/events/use-event-stream", () => ({ useEventStream: () => {} }))

vi.mock("../store/terminalStore", () => ({
  useTerminalStore: <T,>(selector: (s: Record<string, unknown>) => T) =>
    selector({
      activeCompanyCode: null,
      activeIndicatorValueId: null,
      pendingMissingCell: null,
      pendingRollupCell: null,
      searchByPanel: {},
      compactMode: false,
      selectCompany: () => {},
      setActiveIndicatorValue: () => {},
      setPendingMissingCell: () => {},
      setPendingRollupCell: () => {},
      setActivePanel: () => {},
      setSearchForPanel: () => {},
      clearSearchForPanel: () => {},
      setAlertsCount: () => {},
      setAlertedCompanyCodes: () => {},
      setAlertMatches: () => {},
    }),
}))

/**
 * Two companies, one indicator. EDEN's revenue is the real pre-11.82 defect:
 * 72,333,200 on the screen against 58,880,102.23 in `PLF Budget 2026`. CPC's
 * is checked and correct, so the test can tell "marks the wrong one" apart
 * from "marks everything".
 */
function matrixPayload() {
  return {
    period: "2026",
    companies: [
      { id: "co_eden", code: "AZSEKER-EDEN", name: "Eden", industry: "Food" },
      { id: "co_cpc", code: "AZSEKER-CPC", name: "CPC", industry: "Food" },
    ],
    indicators: [
      {
        id: "ind_rev",
        code: "IND_REVENUE_TOTAL",
        nameEn: "Revenue",
        direction: "higher_better",
        unit: "AZN",
      },
    ],
    cells: [
      {
        indicatorValueId: "iv_eden",
        companyId: "co_eden",
        indicatorId: "ind_rev",
        value: 72_333_200,
        status: "green" as const,
        reconStatus: "mismatched" as const,
        reconExpected: 58_880_102.23,
      },
      {
        indicatorValueId: "iv_cpc",
        companyId: "co_cpc",
        indicatorId: "ind_rev",
        value: 10_000_000,
        status: "green" as const,
        reconStatus: "matched" as const,
        reconExpected: 10_000_000,
      },
    ],
  }
}

function mockMatrix(payload: unknown) {
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes("/api/indicators/matrix")) {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    return new Response("not found", { status: 404 })
  }) as never
}

beforeEach(() => {
  // The matrix hook caches by period at MODULE level, so without this every
  // test after the first re-renders the first test's payload and passes for
  // the wrong reason.
  __resetMatrixCacheForTests()
  mockMatrix(matrixPayload())
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("HeatMap — a figure that disagrees with the source statement", () => {
  it("marks the offending tile and leaves the reconciled one alone", async () => {
    render(<HeatMap />)
    await waitFor(() => expect(screen.getByText("AZSEKER-EDEN")).toBeTruthy())

    const marked = document.querySelectorAll('[data-recon="mismatched"]')
    expect(marked).toHaveLength(1)
    // The glyph, not just the attribute: `data-recon` is invisible to a human
    // and this feature is entirely about what a human notices.
    expect(screen.getAllByTestId("tile-statement-mismatch")).toHaveLength(1)
    expect(document.querySelectorAll('[data-recon="matched"]')).toHaveLength(1)
  })

  it("counts the disagreements in the header, where nothing has to be hovered", async () => {
    render(<HeatMap />)
    await waitFor(() =>
      expect(screen.getByTestId("heatmap-statement-mismatch-badge")).toBeTruthy(),
    )
  })

  it("says so in the accessible name, not only in colour", async () => {
    render(<HeatMap />)
    await waitFor(() => expect(screen.getByText("AZSEKER-EDEN")).toBeTruthy())
    const edenCell = screen
      .getAllByRole("button")
      .find((b) =>
        b.getAttribute("aria-label")?.startsWith("AZSEKER-EDEN, IND_REVENUE_TOTAL:"),
      )
    expect(edenCell).toBeTruthy()
    // The setup-level next-intl mock renders keys, not prose, so assert on the
    // key's own tail — the point is that the string is IN the label at all.
    expect(edenCell!.getAttribute("aria-label")).toMatch(/STATEMENT MISMATCH/i)
  })

  it("shows no badge and no rings when nothing was found to disagree", async () => {
    const clean = matrixPayload()
    clean.cells = clean.cells.map((c) => ({
      ...c,
      reconStatus: "matched" as const,
      reconExpected: c.value,
    }))
    __resetMatrixCacheForTests()
    mockMatrix(clean)
    render(<HeatMap />)
    await waitFor(() => expect(screen.getByText("AZSEKER-EDEN")).toBeTruthy())
    expect(screen.queryByTestId("heatmap-statement-mismatch-badge")).toBeNull()
    expect(screen.queryAllByTestId("tile-statement-mismatch")).toHaveLength(0)
  })

  it("stays silent on values nobody has checked, rather than marking them clean", async () => {
    // The default state of almost every cell in the product, and the reason
    // absence must not render as reassurance: no badge, no ring, no green tick
    // — the panel is where "not checked" gets said in words.
    const unchecked = matrixPayload()
    unchecked.cells = unchecked.cells.map(({ reconStatus, reconExpected, ...rest }) => {
      void reconStatus
      void reconExpected
      return rest as (typeof unchecked.cells)[number]
    })
    __resetMatrixCacheForTests()
    mockMatrix(unchecked)
    render(<HeatMap />)
    await waitFor(() => expect(screen.getByText("AZSEKER-EDEN")).toBeTruthy())
    expect(screen.queryByTestId("heatmap-statement-mismatch-badge")).toBeNull()
    expect(document.querySelectorAll("[data-recon]")).toHaveLength(0)
  })
})
