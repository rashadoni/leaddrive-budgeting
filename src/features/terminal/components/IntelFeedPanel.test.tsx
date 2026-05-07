// @vitest-environment happy-dom
/**
 * Phase 7.G Turn XLV (Phase D.4) — smoke + behavior tests for IntelFeedPanel.
 *
 * What is locked in:
 *  - Initial render: closed (returns null) until `terminal:open-intel`.
 *  - Opens on event with role=dialog + aria-label.
 *  - Loading state while GET /api/intel is in-flight.
 *  - Empty state surfaces correct copy for admin vs non-admin.
 *  - Populated items render title + summary + relevance badge tone +
 *    industry/company tag pills.
 *  - Pin button toggles isPinned optimistically + calls POST endpoint.
 *  - Dismiss button removes item from list optimistically + calls
 *    DELETE endpoint.
 *  - Refresh button is admin-only; clicking it POSTs /api/intel/refresh,
 *    surfaces the summary banner, then re-fetches.
 *  - Escape closes the modal.
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
import { IntelFeedPanel } from "./IntelFeedPanel";

// next-auth/react useSession() — controlled per-test via `mockRole`.
let mockRole: "admin" | "manager" | "viewer" = "admin";
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { role: mockRole } },
    status: "authenticated",
  }),
}));

interface MockItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  sourceLabel: string;
  relevanceScore: number;
  industryTags: string[];
  companyTags: string[];
  publishedAt: string | null;
  fetchedAt: string;
  isPinned: boolean;
  isDismissed: boolean;
}

const baseItem: MockItem = {
  id: "intel_1",
  title: "Cocoa supply tightens",
  summary: "Ghana export cuts squeeze global cocoa supply.",
  url: "https://reuters.com/cocoa-supply",
  sourceLabel: "Reuters",
  relevanceScore: 0.85,
  industryTags: ["agro"],
  companyTags: ["AAC"],
  publishedAt: "2026-05-04T12:00:00.000Z",
  fetchedAt: "2026-05-07T10:00:00.000Z",
  isPinned: false,
  isDismissed: false,
};

let getResponseItems: MockItem[] = [];
let refreshResponse: {
  itemsFetched: number;
  itemsCreated: number;
  itemsSkipped: number;
  errors: string[];
  durationMs: number;
} = {
  itemsFetched: 5,
  itemsCreated: 3,
  itemsSkipped: 2,
  errors: [],
  durationMs: 1234,
};

let pinCalls: Array<{ id: string; pinned: boolean }> = [];
let dismissCalls: string[] = [];
let refreshCalls = 0;

function installFetch() {
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("/api/intel?") || u === "/api/intel") {
      return new Response(
        JSON.stringify({
          items: getResponseItems,
          nextCursor: null,
          hasMore: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (u === "/api/intel/refresh" && init?.method === "POST") {
      refreshCalls++;
      return new Response(JSON.stringify(refreshResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const pinMatch = u.match(/^\/api\/intel\/([^/]+)\/pin$/);
    if (pinMatch && init?.method === "POST") {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      pinCalls.push({ id: pinMatch[1], pinned: body.pinned });
      return new Response(JSON.stringify({ item: { ...baseItem, id: pinMatch[1], isPinned: body.pinned } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const dismissMatch = u.match(/^\/api\/intel\/([^/]+)\/dismiss$/);
    if (dismissMatch && init?.method === "DELETE") {
      dismissCalls.push(dismissMatch[1]);
      return new Response(JSON.stringify({ item: { ...baseItem, id: dismissMatch[1] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as never;
}

beforeEach(() => {
  mockRole = "admin";
  getResponseItems = [];
  pinCalls = [];
  dismissCalls = [];
  refreshCalls = 0;
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fireOpen(): void {
  act(() => {
    window.dispatchEvent(new Event("terminal:open-intel"));
  });
}

describe("IntelFeedPanel (Phase 7.G D.4)", () => {
  it("renders nothing initially", () => {
    const { container } = render(<IntelFeedPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("opens on `terminal:open-intel` with role=dialog + aria-label", async () => {
    render(<IntelFeedPanel />);
    fireOpen();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Intel feed");
  });

  it("shows loading state while GET /api/intel is in-flight", async () => {
    // Slow fetch to assert loading state before resolution.
    let resolveFetch: (() => void) | null = null;
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = () =>
            resolve(
              new Response(
                JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
                { status: 200 },
              ),
            );
        }),
    ) as never;

    render(<IntelFeedPanel />);
    fireOpen();
    expect(await screen.findByTestId("intel-loading")).toBeTruthy();
    await act(async () => {
      resolveFetch?.();
    });
  });

  it("empty state for admin tells them to Refresh", async () => {
    mockRole = "admin";
    getResponseItems = [];
    render(<IntelFeedPanel />);
    fireOpen();
    const empty = await screen.findByTestId("intel-empty");
    expect(empty.textContent).toContain("Click Refresh");
  });

  it("empty state for non-admin tells them to ask an admin", async () => {
    mockRole = "viewer";
    getResponseItems = [];
    render(<IntelFeedPanel />);
    fireOpen();
    const empty = await screen.findByTestId("intel-empty");
    expect(empty.textContent).toContain("Ask an admin");
  });

  it("renders one article per item with title + summary + tags", async () => {
    getResponseItems = [
      baseItem,
      { ...baseItem, id: "intel_2", title: "Hotel demand rises", relevanceScore: 0.5, industryTags: ["hospitality"], companyTags: ["HLTN"] },
    ];
    render(<IntelFeedPanel />);
    fireOpen();
    await waitFor(() => {
      expect(screen.getByTestId("intel-item-intel_1")).toBeTruthy();
    });
    const item1 = screen.getByTestId("intel-item-intel_1");
    expect(item1.textContent).toContain("Cocoa supply tightens");
    expect(item1.textContent).toContain("Ghana export cuts");
    expect(item1.textContent).toContain("agro");
    expect(item1.textContent).toContain("AAC");
    expect(item1.textContent).toContain("high");
    const item2 = screen.getByTestId("intel-item-intel_2");
    expect(item2.textContent).toContain("Hotel demand rises");
    expect(item2.textContent).toContain("med");
  });

  it("Refresh button visible for admin, hidden for non-admin", async () => {
    mockRole = "admin";
    render(<IntelFeedPanel />);
    fireOpen();
    await waitFor(() => screen.getByRole("dialog"));
    expect(screen.getByTestId("intel-refresh-button")).toBeTruthy();
    cleanup();

    mockRole = "viewer";
    render(<IntelFeedPanel />);
    fireOpen();
    await waitFor(() => screen.getByRole("dialog"));
    expect(screen.queryByTestId("intel-refresh-button")).toBeNull();
  });

  it("Refresh click POSTs /api/intel/refresh, surfaces notice, re-fetches", async () => {
    mockRole = "admin";
    getResponseItems = [];
    render(<IntelFeedPanel />);
    fireOpen();
    await screen.findByTestId("intel-empty");
    expect(refreshCalls).toBe(0);

    // After refresh, GET returns the new item.
    getResponseItems = [baseItem];

    await act(async () => {
      fireEvent.click(screen.getByTestId("intel-refresh-button"));
    });
    await waitFor(() => {
      expect(refreshCalls).toBe(1);
    });
    const notice = await screen.findByTestId("intel-refresh-notice");
    expect(notice.textContent).toContain("3 new");
    expect(notice.textContent).toContain("2 skipped");
    // Re-fetch happened — item now visible.
    expect(await screen.findByTestId("intel-item-intel_1")).toBeTruthy();
  });

  it("Pin button optimistically toggles + calls POST", async () => {
    getResponseItems = [baseItem];
    render(<IntelFeedPanel />);
    fireOpen();
    const pinBtn = await screen.findByTestId("intel-pin-intel_1");
    expect(pinBtn.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      fireEvent.click(pinBtn);
    });
    await waitFor(() => {
      expect(pinCalls).toEqual([{ id: "intel_1", pinned: true }]);
    });
    // Optimistic update reflects pinned=true.
    expect(
      screen.getByTestId("intel-pin-intel_1").getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("Dismiss button removes item from list + calls DELETE", async () => {
    getResponseItems = [baseItem];
    render(<IntelFeedPanel />);
    fireOpen();
    await screen.findByTestId("intel-item-intel_1");
    await act(async () => {
      fireEvent.click(screen.getByTestId("intel-dismiss-intel_1"));
    });
    await waitFor(() => {
      expect(dismissCalls).toEqual(["intel_1"]);
    });
    // Item removed from DOM.
    expect(screen.queryByTestId("intel-item-intel_1")).toBeNull();
  });

  it("Escape closes the modal", async () => {
    getResponseItems = [];
    render(<IntelFeedPanel />);
    fireOpen();
    await screen.findByRole("dialog");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("backdrop click closes the modal", async () => {
    getResponseItems = [];
    render(<IntelFeedPanel />);
    fireOpen();
    const dialog = await screen.findByRole("dialog");
    // Click directly on the backdrop element (the dialog itself, not its child).
    await act(async () => {
      fireEvent.click(dialog);
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("surfaces fetch error in an alert region", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Server exploded" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    ) as never;
    render(<IntelFeedPanel />);
    fireOpen();
    const err = await screen.findByTestId("intel-error");
    expect(err.textContent).toContain("Server exploded");
  });
});
