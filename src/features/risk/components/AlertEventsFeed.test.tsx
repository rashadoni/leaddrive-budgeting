// @vitest-environment happy-dom
/**
 * Phase 7.E C6 v3.3 (Turn V) — AlertEventsFeed smoke + behavior.
 *
 * Locks: (a) initial mount fires fetch with `?period=2025`; (b) renders
 * one row per event with severity badge + message; (c) Apply with ruleId
 * adds `&ruleId=…` to next fetch; (d) Reset clears + re-fetches without
 * ruleId; (e) Load more passes the cursor; (f) HTTP error surfaces inline.
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
  waitFor,
} from "@testing-library/react";
import { AlertEventsFeed } from "./AlertEventsFeed";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockFetchResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeEvent(id: string, severity = "warning", ruleId = "RULE_X") {
  return {
    id,
    period: "2025",
    ruleId,
    ruleName: "Rule X",
    severity,
    message: `event ${id} message`,
    messageKey: `alerts.messages.${ruleId}`,
    messageParams: {},
    affectedCompanyIds: ["co_a"],
    affectedIndicatorCodes: [],
    emittedAt: "2026-05-05T10:00:00.000Z",
  };
}

describe("AlertEventsFeed (Phase 7.G C6 v3.3)", () => {
  it("initial mount fires fetch with the supplied period", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockFetchResponse({ events: [], nextCursor: null, hasMore: false }),
    );
    Object.defineProperty(window, "fetch", {
      value: fetchSpy,
      writable: true,
      configurable: true,
    });

    render(<AlertEventsFeed period="2025" />);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/api/indicators/alerts/events");
    expect(url).toContain("period=2025");
    expect(url).toContain("limit=50");
    expect(url).not.toContain("ruleId=");
    expect(url).not.toContain("cursor=");
  });

  it("renders one row per event with severity badge + message", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockFetchResponse({
        events: [
          makeEvent("ae1", "critical", "RULE_CRITICAL_INDICATOR"),
          makeEvent("ae2", "warning", "RULE_MOSTLY_RED"),
          makeEvent("ae3", "info", "RULE_X"),
        ],
        nextCursor: null,
        hasMore: false,
      }),
    );
    Object.defineProperty(window, "fetch", {
      value: fetchSpy,
      writable: true,
      configurable: true,
    });

    render(<AlertEventsFeed period="2025" />);

    await waitFor(() => {
      expect(screen.getAllByTestId("alert-event-row")).toHaveLength(3);
    });
    expect(screen.getByText("event ae1 message")).toBeTruthy();
    expect(screen.getByText("event ae2 message")).toBeTruthy();
    // Severity rendered lowercase in DOM (Tailwind `uppercase` is CSS-
    // only and doesn't affect `textContent`). Pin lowercase here.
    expect(screen.getAllByTestId("alert-event-row")[0].textContent).toContain(
      "critical",
    );
    expect(screen.getAllByTestId("alert-event-row")[2].textContent).toContain(
      "info",
    );
  });

  it("Apply with ruleId adds &ruleId=… to next fetch", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        mockFetchResponse({ events: [], nextCursor: null, hasMore: false }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ events: [], nextCursor: null, hasMore: false }),
      );
    Object.defineProperty(window, "fetch", {
      value: fetchSpy,
      writable: true,
      configurable: true,
    });

    render(<AlertEventsFeed period="2025" />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    const input = screen.getByPlaceholderText(/RULE_CRITICAL_INDICATOR/i);
    fireEvent.change(input, { target: { value: "RULE_MOSTLY_RED" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    const url = fetchSpy.mock.calls[1][0] as string;
    expect(url).toContain("ruleId=RULE_MOSTLY_RED");
    expect(url).toContain("period=2025");
  });

  it("Reset clears ruleId + re-fetches without filter", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        mockFetchResponse({ events: [], nextCursor: null, hasMore: false }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ events: [], nextCursor: null, hasMore: false }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ events: [], nextCursor: null, hasMore: false }),
      );
    Object.defineProperty(window, "fetch", {
      value: fetchSpy,
      writable: true,
      configurable: true,
    });

    render(<AlertEventsFeed period="2025" />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    const input = screen.getByPlaceholderText(/RULE_CRITICAL_INDICATOR/i);
    fireEvent.change(input, { target: { value: "RULE_MOSTLY_RED" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
    const url = fetchSpy.mock.calls[2][0] as string;
    expect(url).not.toContain("ruleId=");
    // Input itself cleared.
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("Load more passes the cursor + appends events", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        mockFetchResponse({
          events: [makeEvent("ae1")],
          nextCursor: "2026-05-05T09:00:00.000Z|ae1",
          hasMore: true,
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          events: [makeEvent("ae2")],
          nextCursor: null,
          hasMore: false,
        }),
      );
    Object.defineProperty(window, "fetch", {
      value: fetchSpy,
      writable: true,
      configurable: true,
    });

    render(<AlertEventsFeed period="2025" />);
    await waitFor(() => {
      expect(screen.getAllByTestId("alert-event-row")).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() => {
      expect(screen.getAllByTestId("alert-event-row")).toHaveLength(2);
    });
    const url = fetchSpy.mock.calls[1][0] as string;
    expect(url).toContain("cursor=2026-05-05T09");
  });

  it("HTTP error surfaces inline `role=alert`", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response("nope", { status: 500 }),
    );
    Object.defineProperty(window, "fetch", {
      value: fetchSpy,
      writable: true,
      configurable: true,
    });

    render(<AlertEventsFeed period="2025" />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(screen.getByRole("alert").textContent).toContain("HTTP 500");
  });

  it("empty state: 'No alerts on record' message when no events", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockFetchResponse({ events: [], nextCursor: null, hasMore: false }),
    );
    Object.defineProperty(window, "fetch", {
      value: fetchSpy,
      writable: true,
      configurable: true,
    });

    render(<AlertEventsFeed period="2025" />);

    await waitFor(() => {
      expect(screen.getByText(/No alerts on record/i)).toBeTruthy();
    });
    expect(screen.queryByTestId("alert-event-row")).toBeNull();
  });
});
