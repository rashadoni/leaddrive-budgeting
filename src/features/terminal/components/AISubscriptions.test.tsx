// @vitest-environment happy-dom
/**
 * Tier-3 sub-30 — AISubscriptions behavior tests.
 *
 * Locks in:
 *  - Initial render: closed (returns null) until `terminal:open-subscriptions`.
 *  - Opens on event with role=dialog + aria-label.
 *  - Empty state when no subscriptions.
 *  - Create form: label + scope + comparator + threshold → persists +
 *    appends to list.
 *  - Pause / resume toggle persists.
 *  - Delete removes from list + persists.
 *  - Esc / backdrop / X dismiss.
 *  - Listener cleanup on unmount.
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
import { AISubscriptions } from "./AISubscriptions";

const STORAGE_KEY = "terminal-subscriptions-v1";

beforeEach(() => {
  window.localStorage.removeItem(STORAGE_KEY);
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(STORAGE_KEY);
  vi.restoreAllMocks();
});

function fireOpen(): void {
  act(() => {
    window.dispatchEvent(new Event("terminal:open-subscriptions"));
  });
}

describe("AISubscriptions (Tier-3 sub-30)", () => {
  it("renders nothing initially", () => {
    const { container } = render(<AISubscriptions />);
    expect(container.firstChild).toBeNull();
  });

  it("opens on `terminal:open-subscriptions` event with role=dialog + aria-label", () => {
    render(<AISubscriptions />);
    fireOpen();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe(
      "AI subscriptions manager",
    );
  });

  it("shows empty placeholder when no subscriptions exist", () => {
    render(<AISubscriptions />);
    fireOpen();
    expect(screen.getByTestId("subscriptions-empty")).toBeTruthy();
  });

  it("create form: label + scope + comparator + threshold → persists + appends", () => {
    render(<AISubscriptions />);
    fireOpen();
    const labelInput = screen.getByTestId(
      "subscriptions-label",
    ) as HTMLInputElement;
    fireEvent.change(labelInput, { target: { value: "AAC composite drop" } });
    const scopeSelect = screen.getByTestId(
      "subscriptions-scope",
    ) as HTMLSelectElement;
    fireEvent.change(scopeSelect, { target: { value: "company" } });
    const scopeValueInput = screen.getByTestId(
      "subscriptions-scope-value",
    ) as HTMLInputElement;
    fireEvent.change(scopeValueInput, { target: { value: "AAC-MAIN" } });
    const thresholdInput = screen.getByTestId(
      "subscriptions-threshold",
    ) as HTMLInputElement;
    fireEvent.change(thresholdInput, { target: { value: "50" } });
    fireEvent.click(screen.getByTestId("subscriptions-create-submit"));
    // List entry rendered
    expect(screen.getByText("AAC composite drop")).toBeTruthy();
    // Persisted
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].label).toBe("AAC composite drop");
    expect(parsed[0].scope).toBe("company");
    expect(parsed[0].scopeValue).toBe("AAC-MAIN");
    expect(parsed[0].threshold).toBe(50);
    expect(parsed[0].status).toBe("active");
  });

  it("pause toggle flips status + persists", () => {
    // Pre-seed one active subscription.
    const seed = [
      {
        id: "s1",
        label: "test sub",
        scope: "any",
        scopeValue: null,
        metric: "composite",
        comparator: "<",
        threshold: 50,
        indicatorCode: null,
        status: "active",
        lastFiredAt: null,
      },
    ];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    render(<AISubscriptions />);
    fireOpen();
    const toggle = screen.getByTestId("subscriptions-toggle-s1");
    fireEvent.click(toggle);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed[0].status).toBe("paused");
    // Click again → resumes
    fireEvent.click(toggle);
    const raw2 = window.localStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw2!)[0].status).toBe("active");
  });

  it("delete removes from list + persists", () => {
    const seed = [
      {
        id: "s1",
        label: "test sub",
        scope: "any",
        scopeValue: null,
        metric: "composite",
        comparator: "<",
        threshold: 50,
        indicatorCode: null,
        status: "active",
        lastFiredAt: null,
      },
    ];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    render(<AISubscriptions />);
    fireOpen();
    expect(screen.getByTestId("subscriptions-row-s1")).toBeTruthy();
    fireEvent.click(screen.getByTestId("subscriptions-delete-s1"));
    expect(screen.queryByTestId("subscriptions-row-s1")).toBeNull();
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw!)).toHaveLength(0);
  });

  it("create button disabled when label is empty/whitespace", () => {
    render(<AISubscriptions />);
    fireOpen();
    const submitBtn = screen.getByTestId(
      "subscriptions-create-submit",
    ) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
    const labelInput = screen.getByTestId(
      "subscriptions-label",
    ) as HTMLInputElement;
    fireEvent.change(labelInput, { target: { value: "   " } });
    expect(submitBtn.disabled).toBe(true);
    fireEvent.change(labelInput, { target: { value: "real label" } });
    expect(submitBtn.disabled).toBe(false);
  });

  it("scope=any disables scope-value input", () => {
    render(<AISubscriptions />);
    fireOpen();
    const scopeValueInput = screen.getByTestId(
      "subscriptions-scope-value",
    ) as HTMLInputElement;
    expect(scopeValueInput.disabled).toBe(true);
    const scopeSelect = screen.getByTestId(
      "subscriptions-scope",
    ) as HTMLSelectElement;
    fireEvent.change(scopeSelect, { target: { value: "company" } });
    expect(scopeValueInput.disabled).toBe(false);
  });

  it("Esc closes the modal", () => {
    render(<AISubscriptions />);
    fireOpen();
    expect(screen.getByRole("dialog")).toBeTruthy();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("backdrop click closes; inner click does NOT", () => {
    render(<AISubscriptions />);
    fireOpen();
    const dialog = screen.getByRole("dialog");
    const header = dialog.querySelector("header")!;
    fireEvent.click(header);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Close button (X) dismisses modal", () => {
    render(<AISubscriptions />);
    fireOpen();
    fireEvent.click(screen.getByLabelText("Close subscriptions"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("removes terminal:open-subscriptions listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<AISubscriptions />);
    unmount();
    const removed = removeSpy.mock.calls.some(
      (c) => c[0] === "terminal:open-subscriptions",
    );
    expect(removed).toBe(true);
    removeSpy.mockRestore();
  });
});
