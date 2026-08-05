// @vitest-environment happy-dom
/**
 * 2026-08-05 — `?` is what a user presses to ask "what does this mean", and
 * it opened the keyboard cheatsheet, which said nothing about the glyphs on
 * the grid. The legend lived in HelpModal, reachable only from `HELP GO` or
 * from a toolbar button deliberately collapsed into the ⌘K palette.
 *
 * The fix is a HAND-OFF, and these tests exist because the obvious
 * implementation — open the legend on top of the cheatsheet — is broken:
 * both components keep window-level keydown listeners, so two open dialogs
 * mean one Escape closes both and the reader loses the one they were in.
 *
 * Rendered together the way TerminalOverlayHost mounts them.
 */

import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { HelpModal } from "./HelpModal";

afterEach(() => {
  cleanup();
});

function bothModals() {
  return render(
    <>
      <HelpModal />
      <KeyboardShortcutsModal />
    </>,
  );
}

function pressQuestionMark(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
  });
}

function pressEscape(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
}

function openDialogs(): Element[] {
  return Array.from(document.querySelectorAll('[role="dialog"]'));
}

describe("cheatsheet → legend hand-off", () => {
  it("`?` then the legend button leaves exactly ONE dialog open — the legend", () => {
    bothModals();
    pressQuestionMark();
    expect(openDialogs()).toHaveLength(1);

    act(() => {
      fireEvent.click(screen.getByTestId("shortcuts-open-legend"));
    });

    // One dialog, and it is the command reference — not the cheatsheet, and
    // not both.
    expect(openDialogs()).toHaveLength(1);
    expect(screen.getByTestId("help-modal")).toBeTruthy();
    expect(screen.queryByTestId("shortcuts-open-legend")).toBeNull();
  });

  it("hands off ONTO the legend, not to the top of the command list", () => {
    bothModals();
    pressQuestionMark();
    act(() => {
      fireEvent.click(screen.getByTestId("shortcuts-open-legend"));
    });
    expect(document.activeElement).toBe(screen.getByTestId("help-legend"));
  });

  it("one Escape closes the legend and leaves nothing behind", () => {
    bothModals();
    pressQuestionMark();
    act(() => {
      fireEvent.click(screen.getByTestId("shortcuts-open-legend"));
    });
    pressEscape();
    expect(openDialogs()).toHaveLength(0);
  });

  it("`?` while the legend is open does not stack a second dialog behind it", () => {
    bothModals();
    act(() => {
      window.dispatchEvent(new Event("terminal:open-help"));
    });
    expect(openDialogs()).toHaveLength(1);

    pressQuestionMark();
    // Without the guard the cheatsheet mounts underneath (z-50 vs z-[100]),
    // invisible, and the next Escape closes both.
    expect(openDialogs()).toHaveLength(1);
    expect(screen.getByTestId("help-modal")).toBeTruthy();

    pressEscape();
    expect(openDialogs()).toHaveLength(0);
  });

  it("`?` still toggles its own dialog closed", () => {
    bothModals();
    pressQuestionMark();
    expect(openDialogs()).toHaveLength(1);
    pressQuestionMark();
    expect(openDialogs()).toHaveLength(0);
  });

  it("`?` still opens when nothing else is on screen", () => {
    bothModals();
    expect(openDialogs()).toHaveLength(0);
    pressQuestionMark();
    expect(openDialogs()).toHaveLength(1);
  });
});
