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

  // Regression tests for bug fixes shipped in commit e66263a:
  //   "fix(terminal): Round-1 closures from final architect review"
  // These lock the post-fix behavior so future refactors can't silently
  // re-break them.

  describe("regression: COMPARE button (e66263a fix #1)", () => {
    // Pre-fix: COMPARE dispatched a panelId:0 focus-search event which
    // matched no listener — button was dead. Now it directly focuses the
    // CommandBar input + prefills "CMP " via the native value setter.
    it("focuses an input[data-cmd-bar] and prefills it with 'CMP '", () => {
      // Render a controlled <input data-cmd-bar="true" /> alongside the
      // toolbar so we can isolate COMPARE's DOM-side wiring without
      // pulling the full CommandBar (which has its own fetch + store
      // dependencies). The selector in HotkeyToolbar is `input[data-cmd-bar]`
      // — any value of the attribute matches.
      let lastInputValue = "";
      const Harness = (): React.ReactElement => {
        const [v, setV] = React.useState("");
        // Mirror to outer scope so the assertion can read it post-event.
        lastInputValue = v;
        return (
          <>
            <HotkeyToolbar />
            <input
              data-cmd-bar="true"
              value={v}
              onChange={(e) => setV(e.target.value)}
              aria-label="cmd-bar harness"
            />
          </>
        );
      };
      render(<Harness />);
      const input = document.querySelector(
        'input[data-cmd-bar]',
      ) as HTMLInputElement;
      expect(input).toBeTruthy();
      // Pre-click: input is empty, not focused.
      expect(input.value).toBe("");
      expect(document.activeElement).not.toBe(input);

      fireEvent.click(screen.getByText("COMPARE"));

      // After click: input is focused AND its value is exactly "CMP "
      // (the prefill string the user types codes after).
      expect(document.activeElement).toBe(input);
      // The native-setter + 'input' event path makes the React-controlled
      // harness re-render with the new value.
      expect(input.value).toBe("CMP ");
      expect(lastInputValue).toBe("CMP ");
    });

    it("is a no-op when no input[data-cmd-bar] is present (does not throw)", () => {
      // Pre-fix would dispatch a dead event; post-fix should silently
      // no-op when the selector finds nothing.
      render(<HotkeyToolbar />);
      // Nothing else rendered — no input[data-cmd-bar] in DOM.
      expect(document.querySelector('input[data-cmd-bar]')).toBeNull();
      // Clicking must not throw.
      expect(() => fireEvent.click(screen.getByText("COMPARE"))).not.toThrow();
    });
  });

  describe("regression: RECOMPUTE pending UX (e66263a fix #2)", () => {
    // Pre-fix: RECOMPUTE was fire-and-forget with zero feedback —
    // user-stampede risk (rapid double-clicks fired N requests). Post-
    // fix: disabled-while-pending with "RUNNING…" label + 800ms minimum-
    // visible feedback window so even fast servers don't flash too
    // briefly to be perceptible.

    it("flips label RECOMPUTE → RUNNING… on click and disables the button", () => {
      // Use a never-resolving fetch so the pending state is observable.
      const fetchSpy = vi.fn(() => new Promise(() => {}));
      global.fetch = fetchSpy as never;

      render(<HotkeyToolbar />);
      // Pre-click: label is RECOMPUTE, button enabled.
      const beforeBtn = screen.getByText("RECOMPUTE").closest("button");
      expect(beforeBtn).toBeTruthy();
      expect(beforeBtn!.disabled).toBe(false);

      act(() => {
        fireEvent.click(screen.getByText("RECOMPUTE"));
      });

      // Post-click while pending: label flipped to RUNNING…, button disabled.
      expect(screen.queryByText("RECOMPUTE")).toBeNull();
      const runningBtn = screen.getByText("RUNNING…").closest("button");
      expect(runningBtn).toBeTruthy();
      expect(runningBtn!.disabled).toBe(true);
    });

    it("ignores a second click while pending (no second fetch)", () => {
      const fetchSpy = vi.fn(() => new Promise(() => {}));
      global.fetch = fetchSpy as never;

      render(<HotkeyToolbar />);
      act(() => {
        fireEvent.click(screen.getByText("RECOMPUTE"));
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Second click on the now-RUNNING… (disabled) button.
      // fireEvent.click on a disabled button doesn't fire onClick in
      // happy-dom either, but exercise the early-return guard anyway by
      // bypassing disabled state via the underlying button element.
      const btn = screen.getByText("RUNNING…").closest("button")!;
      // Manually fire — the in-component `if (recomputing) return false`
      // is the actual stampede guard; disabled-on-button is just UI.
      act(() => {
        btn.click();
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("resets label back to RECOMPUTE after fetch resolves + 800ms minimum window", async () => {
      vi.useFakeTimers();
      let resolveFetch: ((value: Response) => void) | undefined;
      const pending = new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
      global.fetch = vi.fn(() => pending) as never;

      render(<HotkeyToolbar />);
      act(() => {
        fireEvent.click(screen.getByText("RECOMPUTE"));
      });
      expect(screen.queryByText("RUNNING…")).toBeTruthy();

      // Resolve fetch — the .finally() schedules setTimeout(..., 800).
      // We must let the microtask resolving `pending` flush BEFORE
      // advancing fake timers so the 800ms timeout actually exists.
      await act(async () => {
        resolveFetch?.(new Response("{}", { status: 200 }));
        // Flush the microtask queue so .finally() runs and queues setTimeout.
        await Promise.resolve();
        await Promise.resolve();
      });

      // Still RUNNING… because the 800ms minimum-visible window hasn't
      // elapsed yet — locks the perceptible-feedback contract.
      expect(screen.queryByText("RUNNING…")).toBeTruthy();
      expect(screen.queryByText("RECOMPUTE")).toBeNull();

      // Advance timers past the 800ms window.
      await act(async () => {
        vi.advanceTimersByTime(800);
      });

      expect(screen.queryByText("RECOMPUTE")).toBeTruthy();
      expect(screen.queryByText("RUNNING…")).toBeNull();
      vi.useRealTimers();
    });
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
