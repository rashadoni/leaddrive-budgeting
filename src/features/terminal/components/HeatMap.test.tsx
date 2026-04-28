// @vitest-environment happy-dom
/**
 * Phase C5 architect Round-1 sub-8 closure (Turn 42 sub-16) — RTL
 * integration test for HeatMap composite-by-company rendering.
 *
 * Locks the contract from sub-8 inline closure:
 *   - Operational companies show numeric composite scores in their
 *     row-header CompositeBadge.
 *   - Sub-group companies (rendered with `isSubgroupRollup: true` cells
 *     by the matrix endpoint) get filtered out of the composite
 *     average, so their badges show "—" (rollup row, not measurable
 *     entity) — NOT a misleadingly low score from the aggregated rollup.
 *
 * Why integration-level test (vs the 18 helper-level tests in
 * composite-score.test.ts): the helper-level tests prove
 * `computeCompositeByCompany(cells, companyIds)` does the right thing
 * given pre-filtered cells. This file proves the HeatMap actually
 * USES the helper that way (sub-group rollup cells flow through with
 * `isSubgroupRollup: true` and the badge renders "—").
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
} from "@testing-library/react";
import { HeatMap } from "./HeatMap";

vi.mock("@/lib/events/use-event-stream", () => ({
  useEventStream: () => {},
}));

// Store mock — minimal slices HeatMap reads + a no-op SetState.
vi.mock("../store/terminalStore", () => ({
  useTerminalStore: <T,>(
    selector: (s: {
      activeCompanyCode: string | null;
      activeIndicatorValueId: string | null;
      searchByPanel: Record<number, string>;
      compactMode: boolean;
      selectCompany: () => void;
      setActiveIndicatorValue: () => void;
      setActivePanel: () => void;
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
      searchByPanel: {},
      compactMode: false,
      selectCompany: () => {},
      setActiveIndicatorValue: () => {},
      setActivePanel: () => {},
      setSearchForPanel: () => {},
      clearSearchForPanel: () => {},
      setAlertsCount: () => {},
      setAlertedCompanyCodes: () => {},
      setAlertMatches: () => {},
    }),
}));

beforeEach(() => {
  // Mock matrix endpoint: 1 sub-group + 4 ops cos × 5 indicators.
  // Ops cos all-green (composite=100). Sub-group has rollup-cells
  // marked isSubgroupRollup=true with all-amber status — these MUST
  // be filtered out so sub-group's composite is null → "—" badge.
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes("/api/indicators/matrix")) {
      return new Response(
        JSON.stringify({
          period: "2026",
          companies: [
            { id: "sg_aac", code: "AAC", name: "AAC Group", industry: "Industrial", isSubgroup: true },
            { id: "co_a", code: "AAC-MAIN", name: "AAC Main", industry: "Industrial" },
            { id: "co_b", code: "AAC-2", name: "AAC #2", industry: "Industrial" },
            { id: "co_c", code: "AAC-3", name: "AAC #3", industry: "Industrial" },
            { id: "co_d", code: "AAC-4", name: "AAC #4", industry: "Industrial" },
          ],
          indicators: [
            { id: "ind_a", code: "IND_A", nameEn: "A", direction: "higher_better", unit: "%" },
            { id: "ind_b", code: "IND_B", nameEn: "B", direction: "higher_better", unit: "%" },
            { id: "ind_c", code: "IND_C", nameEn: "C", direction: "higher_better", unit: "%" },
            { id: "ind_d", code: "IND_D", nameEn: "D", direction: "higher_better", unit: "%" },
            { id: "ind_e", code: "IND_E", nameEn: "E", direction: "higher_better", unit: "%" },
          ],
          cells: [
            // Ops co cells — all green.
            ...["co_a", "co_b", "co_c", "co_d"].flatMap((co) =>
              ["ind_a", "ind_b", "ind_c", "ind_d", "ind_e"].map((ind) => ({
                companyId: co,
                indicatorId: ind,
                value: 50,
                status: "green" as const,
              })),
            ),
            // Sub-group rollup cells — all amber. MUST be skipped by
            // compositeByCompany via the isSubgroupRollup flag.
            ...["ind_a", "ind_b", "ind_c", "ind_d", "ind_e"].map((ind) => ({
              companyId: "sg_aac",
              indicatorId: ind,
              value: 25,
              status: "amber" as const,
              isSubgroupRollup: true,
            })),
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

describe("HeatMap composite-by-company integration (Phase C5 sub-8 contract)", () => {
  it("operational companies render numeric composite scores", async () => {
    render(<HeatMap />);
    // Wait for matrix fetch + render.
    await waitFor(() => {
      expect(screen.getByText("AAC-MAIN")).toBeTruthy();
    });
    // Each ops co has 5 green cells → composite = 100.
    // The CompositeBadge `title` attribute carries the precise
    // diagnostic; query by aria-label-equivalent role pattern.
    const opsBadges = screen.getAllByTitle(/^Composite 100\/100/);
    // 4 ops cos × 1 badge each = 4.
    expect(opsBadges).toHaveLength(4);
  });

  it("sub-group company renders '—' badge (rollup-skip contract)", async () => {
    render(<HeatMap />);
    await waitFor(() => {
      expect(screen.getByText("AAC")).toBeTruthy();
    });
    // Sub-group's CompositeBadge renders "—" with title "No scoreable
    // indicators" — proves rollup cells were filtered before the
    // helper computed the average. Without the filter the sub-group
    // would show ~50/100 (5 amber cells) and this test would fail.
    const dashBadges = screen.getAllByTitle("No scoreable indicators");
    // Exactly ONE dash badge (the sub-group). Ops cos have numeric badges.
    expect(dashBadges).toHaveLength(1);
    expect(dashBadges[0].textContent).toBe("—");
  });

  it("regression: rollup cells did NOT leak into ops co composite", async () => {
    render(<HeatMap />);
    await waitFor(() => {
      expect(screen.getByText("AAC-MAIN")).toBeTruthy();
    });
    // If rollup cells (amber) leaked across to ops cos via shared
    // companyId or other bug, ops cos composite would drop below 100.
    // Lock at 100 for all 4 ops cos.
    const titles = screen
      .getAllByTitle(/^Composite \d+\/100/)
      .map((el) => el.getAttribute("title"));
    for (const t of titles) {
      expect(t).toMatch(/^Composite 100\/100/);
    }
  });
});
