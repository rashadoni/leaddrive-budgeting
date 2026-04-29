// @vitest-environment happy-dom
/**
 * Tier-3 sub-30 — CommentsLayer behavior tests.
 *
 * Locks in:
 *  - Initial render: closed (returns null) until `terminal:open-comments`.
 *  - Opens on event with role=dialog + aria-label.
 *  - With no active cell: shows "no active cell" guidance message.
 *  - With active cell + no thread: shows empty placeholder.
 *  - Submit form persists comment to localStorage + appends to thread.
 *  - @mention syntax produces a `data-testid="mention"` highlight span.
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
import { CommentsLayer } from "./CommentsLayer";

const STORAGE_KEY = "terminal-comments-v1";

let mockState: {
  activeCompanyCode: string | null;
  activeIndicatorValueId: string | null;
} = {
  activeCompanyCode: null,
  activeIndicatorValueId: null,
};

vi.mock("../store/terminalStore", () => ({
  useTerminalStore: <T,>(selector: (s: typeof mockState) => T) =>
    selector(mockState),
}));

beforeEach(() => {
  mockState = { activeCompanyCode: null, activeIndicatorValueId: null };
  window.localStorage.removeItem(STORAGE_KEY);
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(STORAGE_KEY);
  vi.restoreAllMocks();
});

function fireOpen(): void {
  act(() => {
    window.dispatchEvent(new Event("terminal:open-comments"));
  });
}

describe("CommentsLayer (Tier-3 sub-30)", () => {
  it("renders nothing initially", () => {
    const { container } = render(<CommentsLayer />);
    expect(container.firstChild).toBeNull();
  });

  it("opens on `terminal:open-comments` event with role=dialog + aria-label", () => {
    render(<CommentsLayer />);
    fireOpen();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Comments overlay");
  });

  it("shows no-active-cell guidance when no cell is selected", () => {
    render(<CommentsLayer />);
    fireOpen();
    expect(screen.getByTestId("comments-no-cell")).toBeTruthy();
  });

  it("shows empty-thread placeholder when active cell has no comments", () => {
    mockState = {
      activeCompanyCode: "AAC-MAIN",
      activeIndicatorValueId: "iv1",
    };
    render(<CommentsLayer />);
    fireOpen();
    expect(screen.getByTestId("comments-empty")).toBeTruthy();
    expect(screen.getByTestId("comments-cell-key")).toBeTruthy();
  });

  it("submitting a comment persists to localStorage + appends to thread", async () => {
    mockState = {
      activeCompanyCode: "AAC-MAIN",
      activeIndicatorValueId: "iv1",
    };
    render(<CommentsLayer />);
    fireOpen();
    const draft = screen.getByTestId("comments-draft") as HTMLInputElement;
    fireEvent.change(draft, { target: { value: "Why is this red?" } });
    const sendBtn = screen.getByTestId("comments-send");
    fireEvent.click(sendBtn);
    // Comment appears in thread
    expect(screen.getByText(/Why is this red\?/)).toBeTruthy();
    // Persisted to localStorage as v:1 envelope (Round-24 Stage 3)
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const env = JSON.parse(raw!);
    expect(env.v).toBe(1);
    expect(env.data["AAC-MAIN:iv1"]).toBeTruthy();
    expect(env.data["AAC-MAIN:iv1"][0].text).toBe("Why is this red?");
  });

  it("renders @mention syntax with highlight spans", () => {
    mockState = {
      activeCompanyCode: "AAC-MAIN",
      activeIndicatorValueId: "iv1",
    };
    // Pre-seed localStorage with a comment containing @mention.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "AAC-MAIN:iv1": [
          {
            id: "c1",
            author: "cfo",
            timestamp: Date.now(),
            text: "Hey @aac-finance can you explain?",
          },
        ],
      }),
    );
    render(<CommentsLayer />);
    fireOpen();
    const mentions = screen.getAllByTestId("mention");
    expect(mentions.length).toBe(1);
    expect(mentions[0].textContent).toBe("@aac-finance");
  });

  it("Esc closes the modal", () => {
    render(<CommentsLayer />);
    fireOpen();
    expect(screen.getByRole("dialog")).toBeTruthy();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("backdrop click closes; inner click does NOT", () => {
    render(<CommentsLayer />);
    fireOpen();
    const dialog = screen.getByRole("dialog");
    const header = dialog.querySelector("header")!;
    fireEvent.click(header);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Close button (X) dismisses modal", () => {
    render(<CommentsLayer />);
    fireOpen();
    const closeBtn = screen.getByLabelText("Close comments");
    fireEvent.click(closeBtn);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("removes terminal:open-comments listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<CommentsLayer />);
    unmount();
    const removed = removeSpy.mock.calls.some(
      (c) => c[0] === "terminal:open-comments",
    );
    expect(removed).toBe(true);
    removeSpy.mockRestore();
  });

  it("send button disabled when draft is empty/whitespace", () => {
    mockState = {
      activeCompanyCode: "AAC-MAIN",
      activeIndicatorValueId: "iv1",
    };
    render(<CommentsLayer />);
    fireOpen();
    const sendBtn = screen.getByTestId("comments-send") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
    const draft = screen.getByTestId("comments-draft") as HTMLInputElement;
    fireEvent.change(draft, { target: { value: "   " } });
    expect(sendBtn.disabled).toBe(true);
    fireEvent.change(draft, { target: { value: "real text" } });
    expect(sendBtn.disabled).toBe(false);
  });

  // Round-24 Stage 3 fix-before-close coverage:

  it("uses session.user.name as comment author (not hardcoded 'cfo')", () => {
    // vitest.setup.ts mock returns session.user.name = "Test User"
    mockState = {
      activeCompanyCode: "AAC-MAIN",
      activeIndicatorValueId: "iv1",
    };
    render(<CommentsLayer />);
    fireOpen();
    const draft = screen.getByTestId("comments-draft") as HTMLInputElement;
    fireEvent.change(draft, { target: { value: "test message" } });
    fireEvent.click(screen.getByTestId("comments-send"));
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const envelope = JSON.parse(raw!);
    // v:1 envelope shape
    expect(envelope.v).toBe(1);
    expect(envelope.data["AAC-MAIN:iv1"][0].author).toBe("Test User");
  });

  it("v:1 envelope persists with versioning on write", () => {
    mockState = {
      activeCompanyCode: "AAC-MAIN",
      activeIndicatorValueId: "iv1",
    };
    render(<CommentsLayer />);
    fireOpen();
    const draft = screen.getByTestId("comments-draft") as HTMLInputElement;
    fireEvent.change(draft, { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("comments-send"));
    const envelope = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(envelope.v).toBe(1);
    expect(envelope.data).toBeDefined();
    expect(typeof envelope.data).toBe("object");
  });

  it("read path accepts legacy bare-object shape (pre-v1) AND v:1 envelope", () => {
    mockState = {
      activeCompanyCode: "AAC-MAIN",
      activeIndicatorValueId: "iv1",
    };
    // Legacy bare-object shape (pre-Round-24).
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "AAC-MAIN:iv1": [
          {
            id: "legacy",
            author: "old-user",
            timestamp: Date.now(),
            text: "Legacy comment",
          },
        ],
      }),
    );
    render(<CommentsLayer />);
    fireOpen();
    expect(screen.getByText("Legacy comment")).toBeTruthy();
  });

  it("defensive filter rejects malformed JSON entries (shape-mismatch)", () => {
    mockState = {
      activeCompanyCode: "AAC-MAIN",
      activeIndicatorValueId: "iv1",
    };
    // Malformed: missing required fields (no `text`)
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        data: {
          "AAC-MAIN:iv1": [
            { id: "valid", author: "x", timestamp: 1, text: "valid" },
            { id: "invalid", author: "x" }, // missing timestamp + text
            null, // not an object
            "string-not-object",
          ],
        },
      }),
    );
    render(<CommentsLayer />);
    fireOpen();
    expect(screen.getByText("valid")).toBeTruthy();
    // Malformed entries silently dropped — only 1 row visible.
    const dialog = screen.getByRole("dialog");
    const items = dialog.querySelectorAll("[data-testid^='comment-row-']");
    expect(items.length).toBe(1);
  });

  it("defensive filter on entirely malformed JSON gracefully returns empty", () => {
    mockState = {
      activeCompanyCode: "AAC-MAIN",
      activeIndicatorValueId: "iv1",
    };
    window.localStorage.setItem(STORAGE_KEY, "not-valid-json{{{");
    expect(() => render(<CommentsLayer />)).not.toThrow();
    fireOpen();
    expect(screen.getByTestId("comments-empty")).toBeTruthy();
  });
});
