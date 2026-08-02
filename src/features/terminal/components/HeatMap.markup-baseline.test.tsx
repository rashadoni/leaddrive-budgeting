// @vitest-environment happy-dom
/**
 * A layout baseline the Linux box can actually run.
 *
 * The pixel gate (`e2e/smoke/visual-baseline.spec.ts`) is a Mac-only step:
 * Playwright names snapshots per platform, every committed baseline here is
 * `*-chromium-darwin.png`, and on Linux a run either fails as "snapshot
 * missing" or writes a fresh Linux baseline compared against nothing — a green
 * tick proving nothing. Verified 2026-08-02 with a throwaway probe; see
 * CLAUDE.md. CI is Linux too and does not run it.
 *
 * So every layout-touching commit made from that box has shipped with the gate
 * unrun, on the reasoning that the change was data-conditional and the data was
 * absent. That reasoning happened to be correct — checked by rendering this
 * exact payload at `9bd287f5` (pre-11.91) and at HEAD and diffing: **17,352
 * bytes, byte-identical.** But it was reasoning, repeated five times, and the
 * sixth would eventually be wrong.
 *
 * This pins the markup instead. It is not a substitute for the pixel gate —
 * DOM equality says nothing about padding, font metrics or colour — but it
 * catches the structural drift that the pixel gate was mostly catching anyway,
 * and it catches it on the machine where the work is done.
 *
 * **The payload deliberately carries no reconciliation fields**, because that
 * is what production carries: measured the same day, all 6,460 indicator values
 * read `reconStatus = NULL`. A marker that renders only on a state the data
 * does not have must add nothing here, and if it ever does, this file says so
 * before the Mac does.
 *
 * When the snapshot legitimately changes: read the diff, confirm it is the
 * change you meant, update the companion file, and run the pixel gate on the
 * Mac — this test cannot replace it.
 */

import React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, cleanup, waitFor, screen } from "@testing-library/react"
import { HeatMap } from "./HeatMap"
import { __resetMatrixCacheForTests } from "../hooks/use-matrix"

vi.mock("@/lib/events/use-event-stream", () => ({ useEventStream: () => {} }))
vi.mock("../store/terminalStore", () => ({
  useTerminalStore: <T,>(s: (x: Record<string, unknown>) => T) =>
    s({
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
 * Two companies × two indicators, fixed values, and — the point — no
 * `reconStatus`, no `reconExpected`, no `computedAt`. Nothing time-dependent,
 * so the markup is deterministic across runs.
 */
const PAYLOAD = {
  period: "2026",
  companies: [
    { id: "co_a", code: "AZSEKER-EDEN", name: "Eden", industry: "Food" },
    { id: "co_b", code: "AZSEKER-CPC", name: "CPC", industry: "Food" },
  ],
  indicators: [
    {
      id: "i1",
      code: "IND_REVENUE_TOTAL",
      nameEn: "Revenue",
      direction: "higher_better",
      unit: "AZN",
    },
    {
      id: "i2",
      code: "IND_GROSS_MARGIN",
      nameEn: "Gross margin",
      direction: "higher_better",
      unit: "%",
    },
  ],
  cells: [
    { indicatorValueId: "v1", companyId: "co_a", indicatorId: "i1", value: 31_986_950, status: "green" },
    { indicatorValueId: "v2", companyId: "co_a", indicatorId: "i2", value: 35.6, status: "amber" },
    { indicatorValueId: "v3", companyId: "co_b", indicatorId: "i1", value: 18_334_363, status: "green" },
    { indicatorValueId: "v4", companyId: "co_b", indicatorId: "i2", value: 31.5, status: "red" },
  ],
}

beforeEach(() => {
  __resetMatrixCacheForTests()
  global.fetch = vi.fn(async (url: RequestInfo | URL) =>
    String(url).includes("/api/indicators/matrix")
      ? new Response(JSON.stringify(PAYLOAD), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      : new Response("not found", { status: 404 }),
  ) as never
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("HeatMap markup baseline (the gate the Linux box can run)", () => {
  it("renders the committed markup for production's current data", async () => {
    const { container } = render(<HeatMap />)
    await waitFor(() => expect(screen.getByText("AZSEKER-EDEN")).toBeTruthy())
    await expect(container.innerHTML).toMatchFileSnapshot(
      "./__snapshots__/heat-map-no-recon.html",
    )
  })

  it("adds nothing at all for a state the data does not have", async () => {
    // The specific claim made on five commits and never verified until
    // 2026-08-02. Stated as its own assertion so a failure names the cause
    // rather than dumping a 17KB diff.
    const { container } = render(<HeatMap />)
    await waitFor(() => expect(screen.getByText("AZSEKER-EDEN")).toBeTruthy())
    expect(container.querySelectorAll("[data-recon]")).toHaveLength(0)
    expect(screen.queryAllByTestId("tile-statement-mismatch")).toHaveLength(0)
    expect(screen.queryByTestId("heatmap-statement-mismatch-badge")).toBeNull()
  })

  it("is deterministic — the same payload renders the same bytes twice", async () => {
    // Without this the file snapshot would be a flake generator, and a flaky
    // baseline gets deleted rather than fixed.
    const first = render(<HeatMap />)
    await waitFor(() => expect(screen.getByText("AZSEKER-EDEN")).toBeTruthy())
    const a = first.container.innerHTML
    cleanup()
    __resetMatrixCacheForTests()
    const second = render(<HeatMap />)
    await waitFor(() => expect(screen.getByText("AZSEKER-EDEN")).toBeTruthy())
    expect(second.container.innerHTML).toBe(a)
  })
})
