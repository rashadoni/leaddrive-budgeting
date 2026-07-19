// @vitest-environment happy-dom

import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetCompaniesCacheForTests } from "../hooks/use-companies";
import { __resetMatrixCacheForTests } from "../hooks/use-matrix";
import { TerminalOverlayHost } from "./TerminalOverlayHost";

function setMobileViewport() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

beforeEach(() => {
  setMobileViewport();
  __resetCompaniesCacheForTests();
  __resetMatrixCacheForTests();
});

afterEach(() => {
  cleanup();
  __resetCompaniesCacheForTests();
  __resetMatrixCacheForTests();
  vi.restoreAllMocks();
});

describe("TerminalOverlayHost mobile data lifecycle", () => {
  it("opens and closes every route-owned overlay event", async () => {
    global.fetch = vi.fn(async () => new Response("not found", { status: 404 })) as never;
    render(<TerminalOverlayHost />);
    await act(async () => Promise.resolve());

    const events: Array<[string, unknown?]> = [
      ["terminal:open-audit"],
      ["terminal:open-help"],
      ["terminal:open-compare", { lhs: "A", rhs: "B" }],
      ["terminal:open-peer", { codes: ["A", "B"] }],
      ["terminal:open-alerts"],
      ["terminal:open-scenario"],
      ["terminal:open-action-center"],
      ["terminal:open-comments"],
      ["terminal:open-subco-chat"],
      ["terminal:open-subscriptions"],
      ["terminal:open-intel"],
      ["terminal:open-breach"],
      ["terminal:open-whatif"],
      ["terminal:open-shortcuts"],
    ];

    for (const [name, detail] of events) {
      act(() => {
        window.dispatchEvent(
          detail === undefined
            ? new Event(name)
            : new CustomEvent(name, { detail }),
        );
      });
      await waitFor(() =>
        expect(document.querySelectorAll("[role=\"dialog\"]")).toHaveLength(1),
      );

      act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
      await waitFor(() =>
        expect(document.querySelectorAll("[role=\"dialog\"]")).toHaveLength(0),
      );
    }
  });

  it("keeps company/matrix cold until an overlay requests them", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/indicators/matrix")) {
        return new Response(
          JSON.stringify({
            period: "2026",
            companies: [],
            indicators: [],
            cells: [],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/api/companies")) {
        return new Response("[]", { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    global.fetch = fetchSpy as never;

    render(<TerminalOverlayHost />);
    await act(async () => Promise.resolve());

    const targetCalls = () =>
      fetchSpy.mock.calls.filter(([input]) =>
        /\/api\/(companies|indicators\/matrix)/.test(String(input)),
      );
    expect(targetCalls()).toHaveLength(0);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("terminal:open-compare", {
          detail: { lhs: "A", rhs: "B" },
        }),
      );
    });
    await waitFor(() =>
      expect(
        targetCalls().some(([input]) =>
          String(input).includes("/api/indicators/matrix"),
        ),
      ).toBe(true),
    );

    act(() => window.dispatchEvent(new Event("terminal:open-alerts")));
    await waitFor(() =>
      expect(
        targetCalls().some(([input]) => String(input).includes("/api/companies")),
      ).toBe(true),
    );
  });
});
