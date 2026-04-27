// @vitest-environment happy-dom
/**
 * Phase A5 (Bloomberg uplift plan) — store-side tests for compact-mode
 * persistence + clearState semantics.
 *
 * Locks in:
 *  - `setCompactMode(true|false)` writes the LS key.
 *  - `toggleCompactMode()` flips state + LS key in lockstep.
 *  - `hydrateCompactModeFromStorage()` reads LS on mount and patches
 *    globalState (the SSR→CSR hydration path).
 *  - `clearState()` does NOT reset compactMode (user-preference, not
 *    session state — survives logout/org-switch).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  getTerminalSnapshot,
  hydrateCompactModeFromStorage,
  useTerminalStore,
} from "./terminalStore";

const LS_KEY = "terminal-compact-mode-v1";

function useStoreActions() {
  return useTerminalStore((s) => ({
    setCompactMode: s.setCompactMode,
    toggleCompactMode: s.toggleCompactMode,
    clearState: s.clearState,
  }));
}

beforeEach(() => {
  window.localStorage.removeItem(LS_KEY);
  // Reset compactMode to false between tests via direct setter (clearState
  // intentionally does NOT touch compactMode — that's part of what we test).
  const { result } = renderHook(() => useStoreActions());
  act(() => {
    result.current.setCompactMode(false);
    result.current.clearState();
  });
});

describe("terminalStore.compactMode (Phase A5)", () => {
  it("setCompactMode(true) writes LS '1' + updates globalState", () => {
    const { result } = renderHook(() => useStoreActions());
    act(() => {
      result.current.setCompactMode(true);
    });
    expect(getTerminalSnapshot().compactMode).toBe(true);
    expect(window.localStorage.getItem(LS_KEY)).toBe("1");
  });

  it("setCompactMode(false) writes LS '0' + updates globalState", () => {
    const { result } = renderHook(() => useStoreActions());
    act(() => {
      result.current.setCompactMode(true);
      result.current.setCompactMode(false);
    });
    expect(getTerminalSnapshot().compactMode).toBe(false);
    expect(window.localStorage.getItem(LS_KEY)).toBe("0");
  });

  it("toggleCompactMode() flips state + LS in lockstep", () => {
    const { result } = renderHook(() => useStoreActions());
    expect(getTerminalSnapshot().compactMode).toBe(false);
    act(() => {
      result.current.toggleCompactMode();
    });
    expect(getTerminalSnapshot().compactMode).toBe(true);
    expect(window.localStorage.getItem(LS_KEY)).toBe("1");
    act(() => {
      result.current.toggleCompactMode();
    });
    expect(getTerminalSnapshot().compactMode).toBe(false);
    expect(window.localStorage.getItem(LS_KEY)).toBe("0");
  });

  it("hydrateCompactModeFromStorage() patches state from LS '1'", () => {
    window.localStorage.setItem(LS_KEY, "1");
    act(() => {
      hydrateCompactModeFromStorage();
    });
    expect(getTerminalSnapshot().compactMode).toBe(true);
  });

  it("hydrateCompactModeFromStorage() leaves state false when LS absent", () => {
    window.localStorage.removeItem(LS_KEY);
    act(() => {
      hydrateCompactModeFromStorage();
    });
    expect(getTerminalSnapshot().compactMode).toBe(false);
  });

  it("hydrateCompactModeFromStorage() is a no-op when LS matches state", () => {
    window.localStorage.setItem(LS_KEY, "0");
    act(() => {
      hydrateCompactModeFromStorage();
      hydrateCompactModeFromStorage();
    });
    expect(getTerminalSnapshot().compactMode).toBe(false);
  });

  it("clearState() preserves compactMode (user-preference, not session)", () => {
    const { result } = renderHook(() => useStoreActions());
    act(() => {
      result.current.setCompactMode(true);
      result.current.clearState();
    });
    expect(getTerminalSnapshot().compactMode).toBe(true);
    expect(window.localStorage.getItem(LS_KEY)).toBe("1");
  });
});
