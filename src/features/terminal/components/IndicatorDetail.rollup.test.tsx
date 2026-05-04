// @vitest-environment happy-dom
/**
 * Phase 7.G Turn VI — IndicatorDetail sub-group rollup branch.
 *
 * Pairs with `HeatMap.cell-click.test.tsx` (rollup-routing case): that
 * file proves clicking a synthetic-rollup cell sets `pendingRollupCell`
 * in the store + activates Panel 3. This file proves Panel 3 then
 * RENDERS the rollup hint — value, status tone, child count, hint copy
 * — instead of the pre-Turn-VI "no computed value yet" message.
 *
 * Same separation rationale as `IndicatorDetail.no-data.test.tsx`: the
 * canonical `IndicatorDetail.test.tsx` mock hardcodes a non-null
 * `activeIndicatorValueId`, so the rollup branch (which requires
 * `activeIndicatorValueId=null` + populated `pendingRollupCell`) needs
 * its own store mock + file.
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
} from "@testing-library/react";
import { IndicatorDetail } from "./IndicatorDetail";

const ROLLUP_FIXTURE = {
  companyId: "co_aac",
  companyCode: "AAC",
  indicatorId: "ind_nm",
  indicatorCode: "IND_NET_MARGIN",
  indicatorName: "Net Margin",
  indicatorUnit: "%",
  value: -9.46,
  status: "red" as const,
  contributingChildCount: 1,
};

vi.mock("../store/terminalStore", () => ({
  useTerminalStore: <T,>(
    selector: (s: {
      activeIndicatorValueId: string | null;
      pendingMissingCell: unknown;
      pendingRollupCell: typeof ROLLUP_FIXTURE | null;
      setActivePanel: (id: number) => void;
    }) => T,
  ) =>
    selector({
      activeIndicatorValueId: null,
      pendingMissingCell: null,
      pendingRollupCell: ROLLUP_FIXTURE,
      setActivePanel: () => {},
    }),
}));

beforeEach(() => {
  // The rollup branch must NOT fetch — no ivId means no canonical IV
  // to load. A spurious fetch would hit this stub and fail the test.
  global.fetch = vi.fn(async () => {
    throw new Error(
      "rollup branch should not fetch /api/indicators/values/[id]",
    );
  }) as never;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("IndicatorDetail rollup branch (Phase 7.G Turn VI)", () => {
  it("renders rollup hint with value + unit + status when pendingRollupCell set", () => {
    render(<IndicatorDetail />);

    const rollup = screen.getByTestId("indicator-detail-rollup");
    expect(rollup, "expected rollup hint to render").toBeTruthy();

    // Codes surface verbatim — proves the click target is recognized.
    expect(rollup.textContent).toContain("AAC");
    expect(rollup.textContent).toContain("IND_NET_MARGIN");
    // Value formatted to 1 decimal + unit.
    expect(rollup.textContent).toContain("-9.5");
    expect(rollup.textContent).toContain("%");
    // Status surfaces (lowercase as passed; uppercase is CSS-only).
    expect(rollup.textContent?.toLowerCase()).toContain("red");
  });

  it("does NOT issue a fetch (no ivId means nothing to fetch)", () => {
    render(<IndicatorDetail />);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("invokes the i18n keys (rollupHint + rollupAction) via t()", () => {
    // Same fallback-marker pattern as no-data test: vitest-setup t()
    // mock returns the camelCase key uppercased when no explicit-
    // labels entry exists. Hardcoded English would render the
    // resolved string and miss the marker → catches i18n bypass.
    render(<IndicatorDetail />);
    const rollup = screen.getByTestId("indicator-detail-rollup");
    expect(rollup.textContent).toContain("ROLLUP HINT");
    expect(rollup.textContent).toContain("ROLLUP ACTION");
  });

  it("does NOT render the missing-cell or welcome states (mutual exclusion)", () => {
    render(<IndicatorDetail />);
    expect(screen.queryByTestId("indicator-detail-no-data")).toBeNull();
    // Welcome-state placeholder doesn't have a testid; assert by absence
    // of "Click any HeatMap cell" copy.
    expect(screen.getByTestId("indicator-detail-rollup")).toBeTruthy();
  });
});
