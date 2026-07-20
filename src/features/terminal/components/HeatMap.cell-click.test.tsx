// @vitest-environment happy-dom
/**
 * Phase 7.D regression — HeatMap cell-click → store contract.
 *
 * User reported (twice over Phase 7.D / 7.E) that clicks on HeatMap
 * cells in the EN-locale terminal didn't expand Panel 3 (IndicatorDetail).
 * The bug was intermittent — code review showed the contract was
 * correct, browser drives could not reproduce. This test locks the
 * contract permanently so the next regression is caught at CI time
 * instead of a CFO-facing demo.
 *
 * Contract under test (HeatMap.tsx onCellClick handler):
 *   onCellClick fires →
 *     1. setCompany(co.code)             for every applicable cell
 *     2. setActivePanel(3)               for every applicable cell
 *     3. branch on cell.indicatorValueId:
 *        • present  → setActiveIndicatorValue(ivId)  (computed cell drill-down)
 *        • missing  → setPendingMissingCell({company,indicator metadata})
 *                     (Panel 3 renders no-data hint with both codes)
 *
 * Phase 7.D regression-architect closure: previously missing-cell click
 * silently no-op'd Panel 3 — user reported "клики не работают" twice.
 * New contract guarantees Panel 3 opens for every applicable cell; no-data
 * state shows the codes the user clicked so the action is never silently
 * swallowed. Known N/A pairs are covered by the applicability-filter suite.
 *
 * What this test does NOT cover (separate concerns):
 *   - The Panel 3 (`IndicatorDetail`) component's render contract —
 *     covered by `IndicatorDetail.test.tsx`.
 *   - The matrix endpoint's promise to include `indicatorValueId` —
 *     enforced via TypeScript on `HeatMapCell` shape; runtime API
 *     contract test would belong in matrix-route integration tests.
 *   - Hover tooltip / AI summary — `HeatMap.test.tsx` covers i18n keys.
 *   - Composite badge rendering — `HeatMap.test.tsx` covers that flow.
 */

import React from "react";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { HeatMap } from "./HeatMap";

vi.mock("@/lib/events/use-event-stream", () => ({
  useEventStream: () => {},
}));

// Capturing store mock — every action is a vi.fn() so we can assert
// what was called with what arguments after a click. The selector
// pattern (`useTerminalStore((s) => s.foo)`) is preserved so the
// component reads what it always reads.
const setCompanyMock = vi.fn();
const setActiveIvMock = vi.fn();
const setPendingMissingCellMock = vi.fn();
const setPendingRollupCellMock = vi.fn();
const setActivePanelMock = vi.fn();

vi.mock("../store/terminalStore", () => ({
  useTerminalStore: <T,>(
    selector: (s: {
      activeCompanyCode: string | null;
      activeIndicatorValueId: string | null;
      pendingMissingCell: null;
      pendingRollupCell: null;
      searchByPanel: Record<number, string>;
      compactMode: boolean;
      selectCompany: typeof setCompanyMock;
      setActiveIndicatorValue: typeof setActiveIvMock;
      setPendingMissingCell: typeof setPendingMissingCellMock;
      setPendingRollupCell: typeof setPendingRollupCellMock;
      setActivePanel: typeof setActivePanelMock;
      setSearchForPanel: () => void;
      clearSearchForPanel: () => void;
      setAlertsCount: () => void;
      setAlertedCompanyCodes: () => void;
      setAlertMatches: () => void;
    }) => T,
  ) =>
    selector({
      activeCompanyCode: null,
      activeIndicatorValueId: null,
      pendingMissingCell: null,
      pendingRollupCell: null,
      searchByPanel: {},
      compactMode: false,
      selectCompany: setCompanyMock,
      setActiveIndicatorValue: setActiveIvMock,
      setPendingMissingCell: setPendingMissingCellMock,
      setPendingRollupCell: setPendingRollupCellMock,
      setActivePanel: setActivePanelMock,
      setSearchForPanel: () => {},
      clearSearchForPanel: () => {},
      setAlertsCount: () => {},
      setAlertedCompanyCodes: () => {},
      setAlertMatches: () => {},
    }),
}));

beforeEach(() => {
  setCompanyMock.mockClear();
  setActiveIvMock.mockClear();
  setPendingMissingCellMock.mockClear();
  setPendingRollupCellMock.mockClear();
  setActivePanelMock.mockClear();

  // Mock matrix endpoint with 1 ops co × 2 indicators:
  //  - ind_red: red status WITH indicatorValueId="iv_red"   ← clickable, drill-downable
  //  - ind_missing: NO cell entry at all                     ← renders as "missing", no ivId
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes("/api/indicators/matrix")) {
      return new Response(
        JSON.stringify({
          period: "2026",
          companies: [
            {
              id: "co_aac",
              code: "AAC-MAIN",
              name: "AAC Main",
              industry: "Industrial",
            },
            // Phase 7.G Turn VI — sub-group row (level=1) with synthetic-
            // rollup cell. `isSubgroup` flag mirrors the matrix endpoint
            // shape; the HeatMap renders this row at the bottom.
            {
              id: "co_aac_sg",
              code: "AAC",
              name: "AAC",
              industry: "Industrial",
              isSubgroup: true,
            },
          ],
          indicators: [
            {
              id: "ind_red",
              code: "IND_NET_MARGIN",
              nameEn: "Net Margin",
              direction: "higher_better",
              unit: "%",
            },
            {
              id: "ind_missing",
              code: "IND_FX_EXPOSURE",
              nameEn: "FX Exposure",
              direction: "lower_better",
              unit: "%",
            },
          ],
          // ind_red has a real cell on the op-co. ind_missing has NO cell on
          // the op-co (AAC-MAIN), so that pair renders as a gray "missing"
          // cell with no indicatorValueId — the case these click tests exercise.
          // It carries a real rollup value on the sub-group row, though, so the
          // "hide empty columns" default keeps IND_FX_EXPOSURE visible (an
          // indicator with a value on ANY visible company is not empty). The
          // sub-group row (co_aac_sg) also gets a synthetic-rollup cell for
          // ind_red — `kind='synthetic-rollup'`, `indicatorValueId: null`,
          // value+status set, with the `contributingChildCount` field.
          cells: [
            {
              indicatorValueId: "iv_red",
              companyId: "co_aac",
              indicatorId: "ind_red",
              value: -9.46,
              status: "red" as const,
            },
            {
              indicatorValueId: null,
              companyId: "co_aac_sg",
              indicatorId: "ind_red",
              value: -9.46,
              status: "red" as const,
              kind: "synthetic-rollup" as const,
              contributingChildCount: 1,
            },
            {
              indicatorValueId: null,
              companyId: "co_aac_sg",
              indicatorId: "ind_missing",
              value: 3.2,
              status: "amber" as const,
              kind: "synthetic-rollup" as const,
              contributingChildCount: 1,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  }) as never;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function findCellButton(
  companyCode: string,
  indicatorCode: string,
): HTMLElement | undefined {
  const labelPrefix = `${companyCode}, ${indicatorCode}:`;
  return screen
    .getAllByRole("button")
    .find((button) => button.getAttribute("aria-label")?.startsWith(labelPrefix));
}

describe("HeatMap cell-click → store contract (Phase 7.D regression)", () => {
  it("click on cell WITH indicatorValueId fires setCompany + setActivePanel(3) + setActiveIv (no pending)", async () => {
    render(<HeatMap />);
    await waitFor(() => {
      expect(screen.getByText("AAC-MAIN")).toBeTruthy();
    });

    // The cell trigger is a native button so focus plus Enter/Space work
    // without custom keyboard event emulation. Its localized aria-label starts
    // with the stable company/indicator pair.
    const cell = findCellButton("AAC-MAIN", "IND_NET_MARGIN");
    expect(cell, "expected to find AAC-MAIN × IND_NET_MARGIN cell").toBeTruthy();

    fireEvent.click(cell!);

    // ALWAYS-fire: company select + Panel 3 focus.
    expect(setCompanyMock).toHaveBeenCalledTimes(1);
    expect(setCompanyMock).toHaveBeenCalledWith("AAC-MAIN");
    expect(setActivePanelMock).toHaveBeenCalledTimes(1);
    expect(setActivePanelMock).toHaveBeenCalledWith(3);

    // BRANCH (cell has ivId): drill-down via setActiveIv; pending NOT touched.
    expect(setActiveIvMock).toHaveBeenCalledTimes(1);
    expect(setActiveIvMock).toHaveBeenCalledWith("iv_red");
    expect(setPendingMissingCellMock).not.toHaveBeenCalled();
  });

  it("click on MISSING cell fires setCompany + setActivePanel(3) + setPendingMissingCell (no setActiveIv)", async () => {
    // Phase 7.D regression-architect closure: NEW contract — missing
    // cell click is no longer silent. Panel 3 opens, store gets a
    // pending hint with company + indicator codes; IndicatorDetail
    // renders the no-data state from those codes.
    render(<HeatMap />);
    await waitFor(() => {
      expect(screen.getByText("AAC-MAIN")).toBeTruthy();
    });

    // ind_missing has no matrix cell and therefore renders a localized
    // no-data button rather than a non-semantic clickable table cell.
    const missingCell = findCellButton("AAC-MAIN", "IND_FX_EXPOSURE");
    expect(missingCell, "expected to find AAC-MAIN × IND_FX_EXPOSURE missing cell").toBeTruthy();

    fireEvent.click(missingCell!);

    // ALWAYS-fire: company select + Panel 3 focus (NEW — was missing
    // pre-regression-fix, this assertion is the load-bearing one
    // against the user's "клики не работают" report).
    expect(setCompanyMock).toHaveBeenCalledTimes(1);
    expect(setCompanyMock).toHaveBeenCalledWith("AAC-MAIN");
    expect(setActivePanelMock).toHaveBeenCalledTimes(1);
    expect(setActivePanelMock).toHaveBeenCalledWith(3);

    // BRANCH (missing cell): pending hint set with ALL the metadata
    // IndicatorDetail needs to render the no-data state without a
    // second fetch (companyId + companyCode + indicatorId +
    // indicatorCode + indicatorName).
    expect(setPendingMissingCellMock).toHaveBeenCalledTimes(1);
    expect(setPendingMissingCellMock).toHaveBeenCalledWith({
      companyId: "co_aac",
      companyCode: "AAC-MAIN",
      indicatorId: "ind_missing",
      indicatorCode: "IND_FX_EXPOSURE",
      indicatorName: "FX Exposure",
    });

    // setActiveIv must NOT fire on a missing cell — the mutual-exclusion
    // invariant in the store would clear the pending hint we just set.
    expect(setActiveIvMock).not.toHaveBeenCalled();
  });

  it("two consecutive clicks on the same cell call store actions twice (no de-dup)", async () => {
    // Defensive lock: confirm no internal de-dup. If a future change
    // adds memoization that skips the second click (e.g. "ivId already
    // active"), Panel 3 wouldn't refresh on a second click — useful
    // when re-fetching after a recompute event. Lock the unconditional
    // contract here.
    render(<HeatMap />);
    await waitFor(() => {
      expect(screen.getByText("AAC-MAIN")).toBeTruthy();
    });

    const cell = findCellButton("AAC-MAIN", "IND_NET_MARGIN");
    expect(cell).toBeTruthy();

    fireEvent.click(cell!);
    fireEvent.click(cell!);

    expect(setCompanyMock).toHaveBeenCalledTimes(2);
    expect(setActiveIvMock).toHaveBeenCalledTimes(2);
    expect(setActivePanelMock).toHaveBeenCalledTimes(2);
  });

  it("switches tooltip content when moving directly from a missing cell to a computed cell", async () => {
    render(<HeatMap />);
    await waitFor(() => {
      expect(screen.getByText("AAC-MAIN")).toBeTruthy();
    });

    const missingTrigger = findCellButton("AAC-MAIN", "IND_FX_EXPOSURE");
    const computedTrigger = findCellButton("AAC-MAIN", "IND_NET_MARGIN");

    expect(missingTrigger).toBeTruthy();
    expect(computedTrigger).toBeTruthy();

    fireEvent.pointerMove(missingTrigger!, { pointerType: "mouse" });
    await waitFor(() => {
      expect(screen.getByRole("tooltip").textContent).toContain("no data");
    });

    fireEvent.pointerLeave(missingTrigger!, { pointerType: "mouse" });
    fireEvent.pointerMove(computedTrigger!, { pointerType: "mouse" });
    await waitFor(() => {
      const tooltip = screen.getByRole("tooltip");
      expect(tooltip.textContent).toContain("IND_NET_MARGIN");
      expect(tooltip.textContent).toContain("-9.46 %");
      expect(tooltip.textContent).not.toContain("no data");
    });
  });

  // Phase 7.G Turn VI — synthetic-rollup click route. Closes architect
  // Round-1 ⚠️ (test gap surfaced after IndicatorDetail.rollup.test.tsx
  // claimed it pairs with this file but no rollup case existed).
  it("click on a synthetic-rollup cell fires setPendingRollupCell with the aggregate payload (no setActiveIv, no setPendingMissing)", async () => {
    render(<HeatMap />);
    await waitFor(() => {
      expect(screen.getByText("AAC")).toBeTruthy();
    });

    const cell = findCellButton("AAC", "IND_NET_MARGIN");
    expect(cell, "expected synthetic-rollup cell to render").toBeTruthy();

    fireEvent.click(cell!);

    expect(setCompanyMock).toHaveBeenCalledTimes(1);
    expect(setCompanyMock).toHaveBeenCalledWith("AAC");
    expect(setActivePanelMock).toHaveBeenCalledWith(3);

    // BRANCH (synthetic-rollup): setPendingRollupCell with aggregate
    // payload — value, status, child count, indicator metadata. The
    // OTHER two store actions MUST stay un-called (mutual-exclusion).
    expect(setPendingRollupCellMock).toHaveBeenCalledTimes(1);
    expect(setPendingRollupCellMock).toHaveBeenCalledWith({
      companyId: "co_aac_sg",
      companyCode: "AAC",
      indicatorId: "ind_red",
      indicatorCode: "IND_NET_MARGIN",
      indicatorName: expect.any(String),
      indicatorUnit: "%",
      value: -9.46,
      status: "red",
      contributingChildCount: 1,
    });
    expect(setActiveIvMock).not.toHaveBeenCalled();
    expect(setPendingMissingCellMock).not.toHaveBeenCalled();
  });
});
