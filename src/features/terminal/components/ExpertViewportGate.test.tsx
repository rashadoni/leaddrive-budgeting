// @vitest-environment happy-dom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpertViewportGate } from "./ExpertViewportGate";

function setViewportMatches(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ExpertViewportGate", () => {
  it("shows the explicit desktop recommendation and does not mount Expert on mobile", () => {
    setViewportMatches(false);
    render(
      <ExpertViewportGate>
        <div data-testid="expert-child">Expert</div>
      </ExpertViewportGate>,
    );

    expect(screen.getByRole("heading", { name: "TITLE" })).toBeTruthy();
    expect(screen.queryByTestId("expert-child")).toBeNull();
    expect(screen.getByTestId("expert-mobile-fallback").className).toContain("md:hidden");
  });

  it("provides a 44px touch target back to Budgeting", () => {
    setViewportMatches(false);
    render(<ExpertViewportGate>Expert</ExpertViewportGate>);

    const link = screen.getByRole("link", { name: "BACK TO BUDGETING" });
    expect(link.getAttribute("href")).toBe("/budgeting");
    expect(link.className).toContain("min-h-11");
  });

  it("mounts the unchanged Expert content at and above the 768px contract breakpoint", () => {
    setViewportMatches(true);
    render(
      <ExpertViewportGate>
        <div data-testid="expert-child">Expert</div>
      </ExpertViewportGate>,
    );

    expect(screen.getByTestId("expert-child")).toBeTruthy();
    expect(screen.getByTestId("expert-desktop-content").className).toContain("md:flex");
    expect(screen.queryByTestId("expert-desktop-placeholder")).toBeNull();
  });
});
