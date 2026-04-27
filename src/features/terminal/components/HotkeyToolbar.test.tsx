// @vitest-environment happy-dom
/**
 * Phase B6 — HotkeyToolbar smoke + behavior.
 *
 * Locks in:
 *   - Renders 8 hotkey buttons + COMPACT toggle.
 *   - ALERTS button fires terminal:open-audit.
 *   - SEARCH button fires terminal:focus-search.
 *   - STARRED button sets watchlistTab → 'starred'.
 *   - RECENT button sets watchlistTab → 'recent'.
 *   - COMPACT button toggles compactMode.
 *   - Toolbar has role=toolbar with aria-label.
 *   - All buttons have descriptive title + aria-label (a11y).
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { HotkeyToolbar } from "./HotkeyToolbar";
import { getTerminalSnapshot, useTerminalStore } from "../store/terminalStore";

beforeEach(() => {
  // Reset store
  const setCompactMode = useTerminalStore.bind(null);
  // We can't call hooks here, but compactMode default is false; just
  // make sure LS is clean
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HotkeyToolbar (Phase B6)", () => {
  it("renders toolbar with role=toolbar + aria-label", () => {
    render(<HotkeyToolbar />);
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar.getAttribute("aria-label")).toMatch(/hotkey/i);
  });

  it("renders 8 default hotkey buttons + COMPACT", () => {
    render(<HotkeyToolbar />);
    expect(screen.queryByText("NEW PLAN")).toBeTruthy();
    expect(screen.queryByText("COMPARE")).toBeTruthy();
    expect(screen.queryByText("ALERTS")).toBeTruthy();
    expect(screen.queryByText("STARRED")).toBeTruthy();
    expect(screen.queryByText("RECENT")).toBeTruthy();
    expect(screen.queryByText("RECOMPUTE")).toBeTruthy();
    expect(screen.queryByText("SEARCH")).toBeTruthy();
    expect(screen.queryByText("IMPORT")).toBeTruthy();
    // Compact toggle
    expect(screen.queryByLabelText(/Toggle compact/i)).toBeTruthy();
  });

  it("ALERTS click fires terminal:open-audit", () => {
    render(<HotkeyToolbar />);
    let fired = 0;
    const handler = () => {
      fired += 1;
    };
    window.addEventListener("terminal:open-audit", handler);
    fireEvent.click(screen.getByText("ALERTS"));
    window.removeEventListener("terminal:open-audit", handler);
    expect(fired).toBe(1);
  });

  it("SEARCH click fires terminal:focus-search with active panel id", () => {
    render(<HotkeyToolbar />);
    let received: { panelId?: number } | null = null;
    const handler = (e: Event) => {
      received = (e as CustomEvent<{ panelId: number }>).detail;
    };
    window.addEventListener("terminal:focus-search", handler);
    fireEvent.click(screen.getByText("SEARCH"));
    window.removeEventListener("terminal:focus-search", handler);
    expect(received).toBeTruthy();
    expect(typeof received!.panelId).toBe("number");
  });

  it("STARRED click sets watchlistTab to 'starred'", () => {
    render(<HotkeyToolbar />);
    act(() => {
      fireEvent.click(screen.getByText("STARRED"));
    });
    expect(getTerminalSnapshot().watchlistTab).toBe("starred");
  });

  it("RECENT click sets watchlistTab to 'recent'", () => {
    render(<HotkeyToolbar />);
    act(() => {
      fireEvent.click(screen.getByText("RECENT"));
    });
    expect(getTerminalSnapshot().watchlistTab).toBe("recent");
  });

  it("COMPACT click toggles compactMode", () => {
    render(<HotkeyToolbar />);
    const before = getTerminalSnapshot().compactMode;
    act(() => {
      fireEvent.click(screen.getByLabelText(/Toggle compact/i));
    });
    expect(getTerminalSnapshot().compactMode).toBe(!before);
    // Restore for other tests
    act(() => {
      fireEvent.click(screen.getByLabelText(/Toggle compact/i));
    });
  });

  it("RECOMPUTE click POSTs to /api/indicators (fire-and-forget)", () => {
    let posted: { url?: string; method?: string } | null = null;
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      posted = {
        url: typeof url === "string" ? url : url.toString(),
        method: init?.method,
      };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as never;
    render(<HotkeyToolbar />);
    fireEvent.click(screen.getByText("RECOMPUTE"));
    expect(posted).toEqual({ url: "/api/indicators", method: "POST" });
  });

  it("every button has descriptive title + aria-label (a11y)", () => {
    render(<HotkeyToolbar />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(9);
    buttons.forEach((b) => {
      expect(b.getAttribute("title")).toBeTruthy();
      expect(b.getAttribute("aria-label")).toBeTruthy();
    });
  });
});
