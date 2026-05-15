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
import { useMatrix } from "../hooks/use-matrix";

// Sub-40 (Phase 7.E phase 2 hardening) — HotkeyToolbar now reads the
// rendered period from the matrix hook so RECOMPUTE can send a valid
// body. Mock the hook at module level — tests should not transitively
// hit `/api/indicators/matrix` (that's a use-matrix concern, locked in
// `use-matrix.test.tsx`). Default mock returns a loaded matrix with
// `period: "2026-04"`; individual tests override via `vi.mocked(useMatrix)`
// when they need to exercise the loading / period-undefined branches.
vi.mock("../hooks/use-matrix", () => ({
  useMatrix: vi.fn(),
}));

const DEFAULT_MATRIX_RESULT = {
  matrix: {
    period: "2026-04",
    companies: [],
    indicators: [],
    cells: [],
  },
  loading: false,
  error: null as string | null,
  refresh: vi.fn(),
};

beforeEach(() => {
  // Reset store
  const setCompactMode = useTerminalStore.bind(null);
  // We can't call hooks here, but compactMode default is false; just
  // make sure LS is clean
  window.localStorage.clear();
  // Default useMatrix → loaded matrix with a known period. Tests that
  // need a different state override this AFTER beforeEach runs.
  vi.mocked(useMatrix).mockReturnValue(DEFAULT_MATRIX_RESULT);
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

  it("renders the pinned hotkey set + ⌘K palette trigger + COMPACT (Phase 7.I Variant C)", () => {
    render(<HotkeyToolbar />);
    // Pinned set — high-frequency triage + system ops (non-agro context).
    // Test mock returns key.split('.').pop().toUpperCase() so all labels
    // arrive uppercased (see vitest.setup.ts fallbackLabel).
    expect(screen.queryByText("ALERTS")).toBeTruthy();
    expect(screen.queryByText("BREACH")).toBeTruthy();
    expect(screen.queryByText("ACTIONS")).toBeTruthy();
    expect(screen.queryByText("RECOMPUTE")).toBeTruthy();
    expect(screen.queryByText("HELP")).toBeTruthy();
    // Overflow buttons NOT rendered (only reachable via CommandBar verbs).
    expect(screen.queryByText("NEW PLAN")).toBeNull();
    expect(screen.queryByText("COMPARE")).toBeNull();
    expect(screen.queryByText("STARRED")).toBeNull();
    expect(screen.queryByText("RECENT")).toBeNull();
    expect(screen.queryByText("SEARCH")).toBeNull();
    expect(screen.queryByText("IMPORT")).toBeNull();
    // ⌘K palette trigger present (aria-label test-mock value = "PALETTE ARIA LABEL").
    expect(screen.queryByLabelText(/palette/i)).toBeTruthy();
    expect(screen.queryByText("⌘K")).toBeTruthy();
    // Compact toggle still pinned ml-auto.
    expect(screen.queryByLabelText(/Toggle compact/i)).toBeTruthy();
  });

  it("⌘K palette trigger focuses input[data-cmd-bar] when clicked (Phase 7.I)", () => {
    let lastInputValue = "";
    const Harness = (): React.ReactElement => {
      const [v, setV] = React.useState("");
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
    const input = document.querySelector('input[data-cmd-bar]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(document.activeElement).not.toBe(input);
    // Test mock renders aria-label as "PALETTE ARIA LABEL" — match via
    // /palette/i regex on the aria-label attribute.
    fireEvent.click(screen.getByLabelText(/palette/i));
    expect(document.activeElement).toBe(input);
    expect(lastInputValue).toBe("");
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

  // Phase 7.I Variant C — SEARCH/STARRED/RECENT moved to overflow.
  // They're now reachable via CommandBar verbs (or `/` keyboard shortcut
  // for search). The toolbar-button code paths still exist in the
  // hotkeys array (verified by unit logic) but are not rendered, so
  // these click-based tests no longer apply. Skipping with rationale:
  it.skip("SEARCH click fires terminal:focus-search with active panel id (moved to overflow)", () => {
    /* see comment above */
  });
  it.skip("STARRED click sets watchlistTab to 'starred' (moved to overflow)", () => {
    /* see comment above */
  });
  it.skip("RECENT click sets watchlistTab to 'recent' (moved to overflow)", () => {
    /* see comment above */
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

  it("RECOMPUTE click POSTs to /api/indicators with {period} from useMatrix (sub-40)", () => {
    // Sub-40 bug fix: pre-fix this button sent no body and the route
    // 400'd silently behind a swallowed `.catch()`. Lock the body shape
    // so the period plumbing through `useMatrix` can't be silently
    // re-broken.
    let posted: { url?: string; method?: string; body?: unknown } | null = null;
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      posted = {
        url: typeof url === "string" ? url : url.toString(),
        method: init?.method,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as never;
    render(<HotkeyToolbar />);
    fireEvent.click(screen.getByText("RECOMPUTE"));
    expect(posted).toEqual({
      url: "/api/indicators",
      method: "POST",
      body: { period: "2026-04" },
    });
  });

  it("RECOMPUTE button disabled while matrix has no period yet (sub-40)", () => {
    // Defense-in-depth against the sub-40 bug: even if a future
    // refactor re-introduces a body-less POST, the button stays
    // un-clickable in the loading window so users can't trigger a 400.
    vi.mocked(useMatrix).mockReturnValue({
      matrix: null,
      loading: true,
      error: null,
      refresh: vi.fn(),
    });
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as never;
    render(<HotkeyToolbar />);
    const btn = screen.getByText("RECOMPUTE").closest("button")!;
    expect(btn.disabled).toBe(true);
    // Strip the disabled attr to exercise the in-component guard
    // (mirror of the stampede-guard test below).
    btn.removeAttribute("disabled");
    fireEvent.click(btn);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Regression tests for bug fixes shipped in commit e66263a:
  //   "fix(terminal): Round-1 closures from final architect review"
  // These lock the post-fix behavior so future refactors can't silently
  // re-break them.

  describe.skip("regression: COMPARE button (e66263a fix #1) — moved to overflow in Phase 7.I Variant C", () => {
    // Pre-Phase-7.I COMPARE was a pinned toolbar button. Variant C moved
    // it to overflow (reachable via CommandBar `CMP A,B GO` or via the
    // ⌘K palette trigger). The underlying `prefillCmdBar('CMP ')` action
    // still exists in the hotkeys array; only the rendering changed. The
    // ⌘K palette test above covers the equivalent code path (focus the
    // CommandBar input). If COMPARE is re-pinned, un-skip this block.
    it.skip("focuses an input[data-cmd-bar] and prefills it with 'CMP '", () => {});
    it.skip("is a no-op when no input[data-cmd-bar] is present (does not throw)", () => {});
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

    it("ignores a second click while pending (no second fetch) — verifies in-component guard, not just disabled UI", () => {
      const fetchSpy = vi.fn(() => new Promise(() => {}));
      global.fetch = fetchSpy as never;

      render(<HotkeyToolbar />);
      act(() => {
        fireEvent.click(screen.getByText("RECOMPUTE"));
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // The button is now disabled at the DOM level (UI feedback). But
      // a vacuous "click on disabled button does nothing" test would
      // green-pass even if the in-component `if (recomputing) return false`
      // stampede guard were deleted — happy-dom (and browsers) drop
      // click events on disabled buttons before React's synthetic handler
      // runs. We need to actually deliver the click to the handler so
      // the in-component guard is exercised.
      //
      // Workaround: temporarily strip `disabled` from the DOM node so the
      // click reaches React. React's onClick still has `recomputing=true`
      // closed over (state hasn't changed), so the in-component guard
      // must early-return → fetch counter stays at 1.
      const btn = screen.getByText("RUNNING…").closest("button")!;
      btn.removeAttribute("disabled");
      act(() => {
        fireEvent.click(btn);
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
    // Phase 7.I Variant C — pinned set is smaller now: ALERTS, BREACH,
    // ACTIONS, RECOMPUTE, HELP + ⌘K palette + COMPACT = 7 minimum.
    expect(buttons.length).toBeGreaterThanOrEqual(7);
    buttons.forEach((b) => {
      expect(b.getAttribute("title")).toBeTruthy();
      expect(b.getAttribute("aria-label")).toBeTruthy();
    });
  });
});
