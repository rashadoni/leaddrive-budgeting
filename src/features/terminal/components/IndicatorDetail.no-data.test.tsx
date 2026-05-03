// @vitest-environment happy-dom
/**
 * Phase 7.D regression-architect closure — IndicatorDetail no-data
 * state for missing-cell clicks.
 *
 * Pairs with `HeatMap.cell-click.test.tsx`: that file proves clicking
 * a missing HeatMap cell sets `pendingMissingCell` in the store +
 * activates Panel 3. This file proves Panel 3 (IndicatorDetail) then
 * RENDERS the no-data hint with the company + indicator codes from
 * the pending payload.
 *
 * Why a SEPARATE file from `IndicatorDetail.test.tsx`: that file's
 * single-instance store mock hardcodes `activeIndicatorValueId="iv_test"`
 * (every test exercises the loaded-detail path). For the no-data
 * branch we need `activeIndicatorValueId=null` + a populated
 * `pendingMissingCell`. Cleanest split is a separate mock / file.
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

// Store mock — null active IV + populated pending hint = the missing-
// cell click state. Same selector pattern as the hardcoded fixture in
// IndicatorDetail.test.tsx.
vi.mock("../store/terminalStore", () => ({
  useTerminalStore: <T,>(
    selector: (s: {
      activeIndicatorValueId: string | null;
      pendingMissingCell: {
        companyId: string;
        companyCode: string;
        indicatorId: string;
        indicatorCode: string;
        indicatorName: string;
      } | null;
      setActivePanel: (id: number) => void;
    }) => T,
  ) =>
    selector({
      activeIndicatorValueId: null,
      pendingMissingCell: {
        companyId: "co_aac",
        companyCode: "AAC-MAIN",
        indicatorId: "ind_fx",
        indicatorCode: "IND_FX_EXPOSURE",
        indicatorName: "FX Exposure",
      },
      setActivePanel: () => {},
    }),
}));

beforeEach(() => {
  // No fetch mock — the no-data branch must NOT issue an API call (no
  // ivId to fetch). If the component accidentally fetches, the global
  // fetch will be undefined and the test fails loud — exactly the
  // desired regression catch.
  global.fetch = vi.fn(async () => {
    throw new Error(
      "no-data branch should not fetch /api/indicators/values/[id] (no ivId set)",
    );
  }) as never;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("IndicatorDetail no-data state (Phase 7.D regression-architect closure)", () => {
  it("renders the no-data hint with company + indicator codes when pendingMissingCell set", () => {
    render(<IndicatorDetail />);

    // Anchor on the data-testid added in IndicatorDetail.tsx — proves
    // the new branch fires (vs falling through to the welcome state
    // which has no testid).
    const noData = screen.getByTestId("indicator-detail-no-data");
    expect(noData, "expected no-data hint to render").toBeTruthy();

    // Both codes surface verbatim — load-bearing for the user
    // recognising "this is the cell I clicked".
    expect(noData.textContent).toContain("AAC-MAIN");
    expect(noData.textContent).toContain("IND_FX_EXPOSURE");
  });

  it("does NOT issue a fetch (no ivId means nothing to fetch)", () => {
    render(<IndicatorDetail />);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("renders both i18n keys (hint + action) — verified via vitest mock fallback strings", () => {
    // The vitest-setup t() mock returns the camelCase key uppercased
    // when no explicit-labels table entry is found (e.g.
    // "MISSING CELL HINT"). Real-runtime renders the resolved English
    // string with `{indicator}` + `{company}` interpolation. Locking
    // both fallback markers proves the component invokes the keys via
    // `t(...)` rather than hardcoding the strings — a hardcoded
    // English would render "FX Exposure has no computed value..." and
    // the fallback markers wouldn't appear at all, failing this test
    // and signalling i18n bypass.
    render(<IndicatorDetail />);
    const noData = screen.getByTestId("indicator-detail-no-data");
    expect(noData.textContent).toContain("MISSING CELL HINT");
    expect(noData.textContent).toContain("MISSING CELL ACTION");
  });
});
