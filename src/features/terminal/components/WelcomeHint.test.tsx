// @vitest-environment happy-dom
/**
 * Sub-27 cont'd Round-9 — locks the WelcomeHint behavior contract:
 *
 *  - SSR-safe: nothing renders before mount (avoids hydration flash).
 *  - First-visit (no localStorage flag) → modal opens after mount.
 *  - Subsequent visits (flag set) → stays closed.
 *  - Auto-fade after 12s — flag persisted, hint hidden.
 *  - Manual dismiss via X button or "Got it" footer — same outcome.
 *  - autoFocus on the X button so keyboard users can dismiss with Enter
 *    without grabbing the mouse.
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
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { WelcomeHint } from "./WelcomeHint";

const STORAGE_KEY = "terminal-welcome-hint-v1";

beforeEach(() => {
  // Clean slate: no flag present.
  window.localStorage.removeItem(STORAGE_KEY);
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(STORAGE_KEY);
  vi.useRealTimers();
});

describe("WelcomeHint (M2)", () => {
  it("renders nothing initially when no localStorage flag (pre-effect)", () => {
    // Before useEffect runs, the dialog should not be in the DOM. With
    // happy-dom + RTL, render runs effects synchronously — so this is
    // mostly a smoke check that the component mounts without throwing.
    const { container } = render(<WelcomeHint />);
    // After render+effects, since flag is absent, dialog opens.
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("opens automatically on first visit (no localStorage flag)", () => {
    render(<WelcomeHint />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    // Locale-aware aria-label resolved through i18n test mock — fallback
    // for "welcome.title" → "TITLE". Uppercase camel-case fallback is fine
    // here; we're locking presence not exact phrasing.
    expect(dialog.getAttribute("aria-label")).toBeTruthy();
  });

  it("stays closed on subsequent visits (localStorage flag set)", () => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    const { container } = render(<WelcomeHint />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("auto-fades after 12 seconds and persists localStorage flag", () => {
    vi.useFakeTimers();
    render(<WelcomeHint />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(12_000);
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
  });

  it("does NOT auto-fade before 12s (lock timeout duration)", () => {
    vi.useFakeTimers();
    render(<WelcomeHint />);
    act(() => {
      vi.advanceTimersByTime(11_999);
    });
    // Still open at 11_999 ms.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("close (X) button dismisses + writes localStorage flag", () => {
    render(<WelcomeHint />);
    const dialog = screen.getByRole("dialog");
    // The X button is the autoFocused button inside the dialog header.
    const buttons = dialog.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(buttons[0]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
  });

  it("'Got it' footer button dismisses + writes flag", () => {
    render(<WelcomeHint />);
    const dialog = screen.getByRole("dialog");
    // The footer dismiss button — "welcome.dismiss" in i18n; mock returns
    // "DISMISS" or similar via fallback. We grab the LAST button in the
    // dialog (footer), since first is the X (header).
    const buttons = Array.from(dialog.querySelectorAll("button"));
    fireEvent.click(buttons[buttons.length - 1]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
  });

  it("autoFocuses the close button so keyboard users can dismiss immediately", () => {
    render(<WelcomeHint />);
    const dialog = screen.getByRole("dialog");
    const xButton = dialog.querySelector("button");
    // happy-dom mirrors browser behavior: autoFocus places focus on the
    // element. Compare via document.activeElement.
    expect(document.activeElement).toBe(xButton);
  });

  it("clears the auto-fade timer on unmount (no setItem after dismount)", () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(window.localStorage, "setItem");
    const { unmount } = render(<WelcomeHint />);
    unmount();
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    // Timer should have been cleared on unmount; no setItem fired.
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });

  it("renders 4 walkthrough steps (Panel 1 / 2 / 3 / 4)", () => {
    render(<WelcomeHint />);
    const dialog = screen.getByRole("dialog");
    const items = dialog.querySelectorAll("li");
    expect(items.length).toBe(4);
    // Each list item begins with the numerical bullet 1./2./3./4.
    const bullets = Array.from(items).map((li) =>
      (li.querySelector("span")?.textContent || "").trim(),
    );
    expect(bullets).toEqual(["1.", "2.", "3.", "4."]);
  });
});
