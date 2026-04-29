// @vitest-environment happy-dom
/**
 * Tier-3 sub-30 — SubCoFinanceChat behavior tests.
 *
 * Locks in:
 *  - Initial render: closed (returns null) until `terminal:open-subco-chat`.
 *  - Opens on event with role=dialog + aria-label.
 *  - Channel list populates from useCompanies() codes.
 *  - No-channel selected: shows pick-channel guidance.
 *  - Selecting channel + sending message persists to localStorage +
 *    appends to thread.
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
  waitFor,
} from "@testing-library/react";
import { SubCoFinanceChat } from "./SubCoFinanceChat";
import { __resetCompaniesCacheForTests } from "../hooks/use-companies";

const STORAGE_KEY = "terminal-subco-chat-v1";

beforeEach(() => {
  __resetCompaniesCacheForTests();
  window.localStorage.removeItem(STORAGE_KEY);
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes("/api/companies")) {
      return new Response(
        JSON.stringify([
          { id: "co_a", code: "AAC-MAIN" },
          { id: "co_b", code: "ATL-DBZ" },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  }) as never;
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(STORAGE_KEY);
  vi.restoreAllMocks();
});

function fireOpen(): void {
  act(() => {
    window.dispatchEvent(new Event("terminal:open-subco-chat"));
  });
}

describe("SubCoFinanceChat (Tier-3 sub-30)", () => {
  it("renders nothing initially", () => {
    const { container } = render(<SubCoFinanceChat />);
    expect(container.firstChild).toBeNull();
  });

  it("opens on `terminal:open-subco-chat` event with role=dialog + aria-label", () => {
    render(<SubCoFinanceChat />);
    fireOpen();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Sub-co finance chat");
  });

  it("renders channel list from useCompanies()", async () => {
    render(<SubCoFinanceChat />);
    fireOpen();
    await waitFor(() => {
      expect(screen.queryByTestId("subco-chat-channel-AAC-MAIN")).toBeTruthy();
    });
    expect(screen.getByTestId("subco-chat-channel-ATL-DBZ")).toBeTruthy();
  });

  it("shows pick-channel guidance when no channel is selected", async () => {
    render(<SubCoFinanceChat />);
    fireOpen();
    await waitFor(() => {
      expect(screen.queryByTestId("subco-chat-no-channel")).toBeTruthy();
    });
  });

  it("selecting a channel + sending message persists + appends", async () => {
    render(<SubCoFinanceChat />);
    fireOpen();
    await waitFor(() => {
      expect(screen.queryByTestId("subco-chat-channel-AAC-MAIN")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("subco-chat-channel-AAC-MAIN"));
    expect(screen.getByTestId("subco-chat-empty")).toBeTruthy();
    const draft = screen.getByTestId("subco-chat-draft") as HTMLInputElement;
    fireEvent.change(draft, {
      target: { value: "Why is gross margin 8% red?" },
    });
    fireEvent.click(screen.getByTestId("subco-chat-send"));
    // Message rendered
    expect(screen.getByText(/Why is gross margin 8% red\?/)).toBeTruthy();
    // Persisted
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed["AAC-MAIN"]).toHaveLength(1);
    expect(parsed["AAC-MAIN"][0].direction).toBe("outgoing");
    expect(parsed["AAC-MAIN"][0].text).toBe("Why is gross margin 8% red?");
  });

  it("Esc closes the modal", async () => {
    render(<SubCoFinanceChat />);
    fireOpen();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeTruthy();
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("backdrop click closes; inner click does NOT", async () => {
    render(<SubCoFinanceChat />);
    fireOpen();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeTruthy();
    });
    const dialog = screen.getByRole("dialog");
    const header = dialog.querySelector("header")!;
    fireEvent.click(header);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Close button (X) dismisses modal", async () => {
    render(<SubCoFinanceChat />);
    fireOpen();
    await waitFor(() => {
      expect(screen.queryByLabelText("Close chat")).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("Close chat"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("removes terminal:open-subco-chat listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<SubCoFinanceChat />);
    unmount();
    const removed = removeSpy.mock.calls.some(
      (c) => c[0] === "terminal:open-subco-chat",
    );
    expect(removed).toBe(true);
    removeSpy.mockRestore();
  });

  it("renders past-thread channels even when companies list is empty (localStorage fallback)", async () => {
    // Reset companies cache and mock /api/companies to return empty.
    __resetCompaniesCacheForTests();
    global.fetch = vi.fn(async () =>
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as never;
    // Pre-seed a thread for a channel that's NOT in /api/companies.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "GHOST-CO": [
          {
            id: "m1",
            direction: "outgoing",
            timestamp: Date.now(),
            text: "Old message",
          },
        ],
      }),
    );
    render(<SubCoFinanceChat />);
    fireOpen();
    await waitFor(() => {
      expect(screen.queryByTestId("subco-chat-channel-GHOST-CO")).toBeTruthy();
    });
  });
});
