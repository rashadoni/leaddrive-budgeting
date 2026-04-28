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

  // Regression test for bug fix #3 shipped in commit e66263a:
  //   "Per-row StarToggle in CompanyTree.tsx — was literal ★/☆ chars.
  //    Now lucide <Star/> with fill="currentColor" when starred,
  //    no-fill when not (preserves filled-vs-outline visual distinction)."
  // Locks the lucide-SVG rendering shape so a future "let's just use
  // emoji again" refactor can't silently regress cross-platform parity
  // (Linux/Windows often miss color emoji fonts).
  describe("regression: per-row StarToggle uses lucide <Star/> (e66263a fix #3)", () => {
    it("starred=true → SVG rendered with fill='currentColor' and strokeWidth=0", () => {
      const { result } = renderHook(() => useStoreActions());
      act(() => {
        result.current.toggleStarredCompany("AAC-MAIN");
      });
      render(<CompanyTree companies={COMPANIES} />);
      const button = screen.getByLabelText("Unstar AAC-MAIN");
      // The button should NOT contain a literal ★ character anymore.
      expect(button.textContent ?? "").not.toContain("★");
      expect(button.textContent ?? "").not.toContain("☆");
      // The button should contain a real <svg> (lucide-react renders SVG).
      const svg = button.querySelector("svg");
      expect(svg).toBeTruthy();
      // Filled state: fill="currentColor". Stroke-width parsed as a
      // number (lucide-react impl detail: today emits "0" string, but a
      // future minor bump emitting "0px" or omitting the attr at zero
      // would flip an exact-string assertion red without a real
      // regression). Symmetric with the false-branch assertion below.
      expect(svg!.getAttribute("fill")).toBe("currentColor");
      expect(parseFloat(svg!.getAttribute("stroke-width") ?? "1")).toBe(0);
    });

    it("starred=false → SVG rendered with fill='none' and non-zero stroke", () => {
      // Default state: nothing starred.
      render(<CompanyTree companies={COMPANIES} />);
      const button = screen.getByLabelText("Star AAC-MAIN");
      // No literal star char.
      expect(button.textContent ?? "").not.toContain("★");
      expect(button.textContent ?? "").not.toContain("☆");
      const svg = button.querySelector("svg");
      expect(svg).toBeTruthy();
      // Outline state: fill="none", stroke-width must be a positive
      // number (lucide-react sets it as a string).
      expect(svg!.getAttribute("fill")).toBe("none");
      const strokeWidth = parseFloat(svg!.getAttribute("stroke-width") ?? "0");
      expect(strokeWidth).toBeGreaterThan(0);
    });

    it("toggling star flips fill='none' ↔ fill='currentColor' on the SAME row in place", () => {
      // Locks "the row's icon updates without re-rendering the row" —
      // catches a future regression where the toggle works on store but
      // the SVG attribute drift goes unnoticed.
      render(<CompanyTree companies={COMPANIES} />);
      const starBtn = screen.getByLabelText("Star AAC-MAIN");
      let svg = starBtn.querySelector("svg");
      expect(svg!.getAttribute("fill")).toBe("none");

      fireEvent.click(starBtn);

      // The same DOM cell is now an "Unstar" button.
      const unstarBtn = screen.getByLabelText("Unstar AAC-MAIN");
      svg = unstarBtn.querySelector("svg");
      expect(svg!.getAttribute("fill")).toBe("currentColor");
    });
  });
});
