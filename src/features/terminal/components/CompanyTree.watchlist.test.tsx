// @vitest-environment happy-dom
/**
 * Phase B4 — CompanyTree integration tests for watchlist filter behavior.
 *
 * Covers the bug fixes shipped in `6b99986` (architect Round-2 closures)
 * plus the setCompany split (Round-1 #5 escalation, closed inline post-
 * sub-4-Round-2):
 *   - Filter applies correctly per active tab (ALL / STARRED / ALERTED / RECENT)
 *   - StarToggle on a company → STARRED filter immediately includes it
 *   - StarToggle on sub-group container works (intentional unit-pin)
 *   - ALERTED tab shows "Loading alerts…" when matrix not yet published
 *   - ALERTED tab shows correct codes after HeatMap publishes
 *   - Sub-group rows survive as headers when child matches but parent doesn't
 *   - 'recent' tab uses array, 'starred'/'alerted' use Set — both work via
 *     the Array.isArray discriminator
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
  renderHook,
} from "@testing-library/react";
import { CompanyTree, type CompanyNode } from "./CompanyTree";
import { getTerminalSnapshot, useTerminalStore } from "../store/terminalStore";

const COMPANIES: CompanyNode[] = [
  {
    id: "aac_id",
    code: "AAC",
    name: "AAC Holding",
    industry: "Industrial",
    children: [
      { id: "aac_main_id", code: "AAC-MAIN", name: "AAC Main", industry: "Industrial" },
    ],
  },
  {
    id: "atl_id",
    code: "ATL",
    name: "ATL Holding",
    industry: "Industrial",
    children: [
      { id: "atl_main_id", code: "ATL-MAIN", name: "ATL Main", industry: "Industrial" },
      { id: "atl_dbz_id", code: "ATL-DBZ", name: "ATL DBZ", industry: "Industrial" },
    ],
  },
];

function useStoreActions() {
  return useTerminalStore((s) => ({
    setWatchlistTab: s.setWatchlistTab,
    toggleStarredCompany: s.toggleStarredCompany,
    setCompany: s.setCompany,
    selectCompany: s.selectCompany,
    setAlertedCompanyCodes: s.setAlertedCompanyCodes,
    clearState: s.clearState,
  }));
}

function resetStore() {
  const { result } = renderHook(() => useStoreActions());
  act(() => {
    window.localStorage.clear();
    // Read starred set via snapshot (sync read, no hook context needed)
    const starred = Array.from(getTerminalSnapshot().starredCompanyCodes);
    starred.forEach((c) => result.current.toggleStarredCompany(c));
    result.current.setWatchlistTab("all");
    result.current.clearState();
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => cleanup());

describe("CompanyTree watchlist filter (Phase B4 + Round-2)", () => {
  it("ALL tab shows full tree by default", () => {
    render(<CompanyTree companies={COMPANIES} />);
    // All 5 codes (3 leaves + 2 sub-group headers) visible
    expect(screen.queryByText("AAC")).toBeTruthy();
    expect(screen.queryByText("AAC-MAIN")).toBeTruthy();
    expect(screen.queryByText("ATL")).toBeTruthy();
    expect(screen.queryByText("ATL-MAIN")).toBeTruthy();
    expect(screen.queryByText("ATL-DBZ")).toBeTruthy();
  });

  it("STARRED tab with no stars → empty tree (No match for '')", () => {
    const { result } = renderHook(() => useStoreActions());
    act(() => {
      result.current.setWatchlistTab("starred");
    });
    render(<CompanyTree companies={COMPANIES} />);
    expect(screen.queryByText("AAC-MAIN")).toBeNull();
    expect(screen.queryByText(/No match/i)).toBeTruthy();
  });

  it("StarToggle on AAC-MAIN → STARRED tab includes AAC-MAIN + parent header", () => {
    const { result } = renderHook(() => useStoreActions());
    render(<CompanyTree companies={COMPANIES} />);
    // Click ☆ on AAC-MAIN
    const starButton = screen.getByLabelText("Star AAC-MAIN");
    fireEvent.click(starButton);
    // Switch to starred tab
    act(() => {
      result.current.setWatchlistTab("starred");
    });
    expect(screen.queryByText("AAC-MAIN")).toBeTruthy();
    expect(screen.queryByText("AAC")).toBeTruthy(); // parent as header
    // ATL family dropped
    expect(screen.queryByText("ATL-MAIN")).toBeNull();
    expect(screen.queryByText("ATL-DBZ")).toBeNull();
  });

  it("Star sub-group container (AAC) → AAC visible alone in STARRED tab (unit-pin semantic, NOT auto-pin children)", () => {
    const { result } = renderHook(() => useStoreActions());
    render(<CompanyTree companies={COMPANIES} />);
    const starButton = screen.getByLabelText("Star AAC");
    fireEvent.click(starButton);
    act(() => {
      result.current.setWatchlistTab("starred");
    });
    // AAC sub-group itself is starred → it passes the filter
    expect(screen.queryByText("AAC")).toBeTruthy();
    // AAC-MAIN is NOT starred → does NOT auto-show under starred AAC
    // (per StarToggle jsdoc: "starring AAC pins the sub-group itself
    //  for the STARRED tab filter. It does NOT auto-pin children.")
    expect(screen.queryByText("AAC-MAIN")).toBeNull();
    // ATL not starred → dropped
    expect(screen.queryByText("ATL")).toBeNull();
  });

  it("ALERTED tab shows 'Loading alerts…' when matrix not yet published", () => {
    const { result } = renderHook(() => useStoreActions());
    act(() => {
      result.current.setWatchlistTab("alerted");
      // alertedCompanyCodes intentionally not set → null
    });
    render(<CompanyTree companies={COMPANIES} />);
    expect(screen.queryByText(/Loading alerts/i)).toBeTruthy();
    // Tree itself NOT rendered yet
    expect(screen.queryByText("AAC-MAIN")).toBeNull();
  });

  it("ALERTED tab filters to published codes after HeatMap publishes", () => {
    const { result } = renderHook(() => useStoreActions());
    act(() => {
      result.current.setWatchlistTab("alerted");
      result.current.setAlertedCompanyCodes(new Set(["ATL-DBZ"]));
    });
    render(<CompanyTree companies={COMPANIES} />);
    expect(screen.queryByText("ATL-DBZ")).toBeTruthy();
    expect(screen.queryByText("ATL")).toBeTruthy(); // parent header
    expect(screen.queryByText("ATL-MAIN")).toBeNull(); // not alerted
    expect(screen.queryByText("AAC-MAIN")).toBeNull(); // not alerted
  });

  it("RECENT tab uses array (not Set) — filter still works via Array.isArray dispatch", () => {
    const { result } = renderHook(() => useStoreActions());
    act(() => {
      result.current.selectCompany("ATL-MAIN");
      result.current.selectCompany("AAC-MAIN");
      result.current.setWatchlistTab("recent");
    });
    render(<CompanyTree companies={COMPANIES} />);
    expect(screen.queryByText("AAC-MAIN")).toBeTruthy();
    expect(screen.queryByText("ATL-MAIN")).toBeTruthy();
    expect(screen.queryByText("ATL-DBZ")).toBeNull(); // not in recent
  });

  it("setCompany (no-track) does NOT add to recent tab filter", () => {
    const { result } = renderHook(() => useStoreActions());
    act(() => {
      result.current.setCompany("AAC-MAIN"); // programmatic, no-track
      result.current.setWatchlistTab("recent");
    });
    render(<CompanyTree companies={COMPANIES} />);
    // AAC-MAIN was set as active but NOT pushed to recent → not visible
    expect(screen.queryByText("AAC-MAIN")).toBeNull();
    expect(screen.queryByText(/No match/i)).toBeTruthy();
  });

  it("Sub-group survives as header when child matches but parent doesn't", () => {
    const { result } = renderHook(() => useStoreActions());
    act(() => {
      result.current.toggleStarredCompany("ATL-DBZ");
      result.current.setWatchlistTab("starred");
    });
    render(<CompanyTree companies={COMPANIES} />);
    // ATL parent NOT starred but child ATL-DBZ is → ATL renders as header
    expect(screen.queryByText("ATL")).toBeTruthy();
    expect(screen.queryByText("ATL-DBZ")).toBeTruthy();
    expect(screen.queryByText("ATL-MAIN")).toBeNull(); // not starred
  });

  it("Toggle star OFF → company removed from STARRED filter on next render", () => {
    const { result } = renderHook(() => useStoreActions());
    render(<CompanyTree companies={COMPANIES} />);
    // Star then unstar
    fireEvent.click(screen.getByLabelText("Star AAC-MAIN"));
    fireEvent.click(screen.getByLabelText("Unstar AAC-MAIN"));
    act(() => {
      result.current.setWatchlistTab("starred");
    });
    expect(screen.queryByText("AAC-MAIN")).toBeNull();
  });

  it("WatchlistTabs renders 4 tabs with correct ARIA roles", () => {
    render(<CompanyTree companies={COMPANIES} />);
    const tablist = screen.getByRole("tablist");
    expect(tablist.getAttribute("aria-label")).toMatch(/watchlist/i);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(tabs[0].textContent).toContain("ALL");
    expect(tabs[3].textContent).toContain("RECENT");
  });
});
