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
