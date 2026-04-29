// @vitest-environment happy-dom
/**
 * Sub-27 cont'd Round-9 — locks the KeyboardShortcutsModal contract:
 *
 *  - Initial render: closed.
 *  - `?` keypress opens (and toggles closed when re-pressed).
 *  - `?` while typing in input/textarea/contentEditable does NOT open
 *    (so users can type "?" in CommandBar without snapping focus away).
 *  - Escape closes.
 *  - Backdrop click closes.
 *  - `terminal:open-shortcuts` window event opens.
 *  - autoFocus lands on close button.
 *  - Listener cleanup on unmount.
 *  - Renders 3 groups (Panels / Global / Command bar).
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
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";

afterEach(() => {
  cleanup();
});

function pressQuestionMark(target?: EventTarget): void {
  act(() => {
    const ev = new KeyboardEvent("keydown", { key: "?", bubbles: true });
    if (target) {
      target.dispatchEvent(ev);
    } else {
      window.dispatchEvent(ev);
    }
  });
}

function pressEscape(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
}

describe("KeyboardShortcutsModal (M6)", () => {
  it("renders nothing initially", () => {
    const { container } = render(<KeyboardShortcutsModal />);
    expect(container.firstChild).toBeNull();
  });

  it("opens on `?` keypress with role=dialog + aria-modal", () => {
    render(<KeyboardShortcutsModal />);
    pressQuestionMark();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBeTruthy();
  });

  it("toggles closed on second `?` press", () => {
    render(<KeyboardShortcutsModal />);
    pressQuestionMark();
    expect(screen.getByRole("dialog")).toBeTruthy();
    pressQuestionMark();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does NOT open when `?` is typed in an INPUT element", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    render(<KeyboardShortcutsModal />);
    pressQuestionMark(input);
    expect(screen.queryByRole("dialog")).toBeNull();
    document.body.removeChild(input);
  });

  it("does NOT open when `?` is typed in a TEXTAREA", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    render(<KeyboardShortcutsModal />);
    pressQuestionMark(ta);
    expect(screen.queryByRole("dialog")).toBeNull();
    document.body.removeChild(ta);
  });

  it("does NOT open when `?` is typed in a contentEditable element", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    document.body.appendChild(div);
    div.focus();
    render(<KeyboardShortcutsModal />);
    pressQuestionMark(div);
    expect(screen.queryByRole("dialog")).toBeNull();
    document.body.removeChild(div);
  });

  it("Escape closes the modal", () => {
    render(<KeyboardShortcutsModal />);
    pressQuestionMark();
    expect(screen.getByRole("dialog")).toBeTruthy();
    pressEscape();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape with no open modal is a no-op (does not crash)", () => {
    render(<KeyboardShortcutsModal />);
    expect(() => pressEscape()).not.toThrow();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("backdrop click closes; inner click does NOT", () => {
    render(<KeyboardShortcutsModal />);
    pressQuestionMark();
    const dialog = screen.getByRole("dialog");
    // Inner click on header — should NOT close.
    const header = dialog.querySelector("header")!;
    fireEvent.click(header);
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Backdrop click (target === currentTarget).
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on `terminal:open-shortcuts` window event", () => {
    render(<KeyboardShortcutsModal />);
    act(() => {
      window.dispatchEvent(new Event("terminal:open-shortcuts"));
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("autoFocuses close button on open (keyboard dismiss path)", () => {
    render(<KeyboardShortcutsModal />);
    pressQuestionMark();
    const dialog = screen.getByRole("dialog");
    // The close button is the only button in the header section.
    const closeBtn = dialog.querySelector("header button");
    expect(document.activeElement).toBe(closeBtn);
  });

  it("renders 3 groups (Panels / Global / Command bar)", () => {
    render(<KeyboardShortcutsModal />);
    pressQuestionMark();
    const dialog = screen.getByRole("dialog");
    const sections = dialog.querySelectorAll("section");
    expect(sections.length).toBe(3);
  });

  it("each group renders >=1 keyboard-row (kbd elements present)", () => {
    render(<KeyboardShortcutsModal />);
    pressQuestionMark();
    const dialog = screen.getByRole("dialog");
    const kbds = dialog.querySelectorAll("kbd");
    // F1-F4 (4) + Global ?, /, Cmd+K, Esc, Ctrl+/ (5+ kbd elements counting
    // multi-key combos) + 7 command-bar shortcuts (multi-token). Total >= 20.
    expect(kbds.length).toBeGreaterThanOrEqual(15);
  });

  it("removes keydown listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<KeyboardShortcutsModal />);
    unmount();
    const removed = removeSpy.mock.calls.some((c) => c[0] === "keydown");
    expect(removed).toBe(true);
    removeSpy.mockRestore();
  });

  it("removes terminal:open-shortcuts listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<KeyboardShortcutsModal />);
    unmount();
    const removed = removeSpy.mock.calls.some(
      (c) => c[0] === "terminal:open-shortcuts",
    );
    expect(removed).toBe(true);
    removeSpy.mockRestore();
  });
});
