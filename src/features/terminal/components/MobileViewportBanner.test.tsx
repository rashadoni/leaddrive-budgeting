// @vitest-environment happy-dom
/**
 * Tier-3 sub-30 Stage 3f — MobileViewportBanner (M8-lite) tests.
 *
 * Locks in:
 *  - Renders by default (no localStorage flag)
 *  - Has `lg:hidden` Tailwind class (auto-hidden ≥1024px viewports
 *    via CSS — verified via className substring; happy-dom doesn't
 *    enforce media-query rules so we test the directive intent, not
 *    visibility computed by browser)
 *  - Dismiss click sets localStorage flag + removes banner
 *  - Banner stays hidden on subsequent renders when flag is set
 *  - SSR-safe (no localStorage access during initial render path)
 */

import React from "react";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MobileViewportBanner } from "./MobileViewportBanner";

const STORAGE_KEY = "terminal-mobile-banner-dismissed-v1";

beforeEach(() => {
  window.localStorage.removeItem(STORAGE_KEY);
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(STORAGE_KEY);
});

describe("MobileViewportBanner (Tier-3 sub-30 Stage 3f / M8-lite)", () => {
  it("renders by default when no dismissal flag", () => {
    render(<MobileViewportBanner />);
    expect(screen.getByTestId("mobile-viewport-banner")).toBeTruthy();
  });

  it("has lg:hidden class so it auto-hides at ≥1024px viewports", () => {
    render(<MobileViewportBanner />);
    const banner = screen.getByTestId("mobile-viewport-banner");
    expect(banner.className).toContain("lg:hidden");
  });

  it("renders the localized banner text", () => {
    render(<MobileViewportBanner />);
    const banner = screen.getByTestId("mobile-viewport-banner");
    expect(banner.textContent).toContain("Risk Terminal is optimized");
  });

  it("dismiss click sets localStorage flag + removes banner", () => {
    render(<MobileViewportBanner />);
    const dismissBtn = screen.getByTestId("mobile-viewport-banner-dismiss");
    fireEvent.click(dismissBtn);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
    expect(screen.queryByTestId("mobile-viewport-banner")).toBeNull();
  });

  it("hidden on subsequent render when dismissal flag is set", () => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    const { container } = render(<MobileViewportBanner />);
    expect(container.querySelector("[data-testid='mobile-viewport-banner']")).toBeNull();
  });

  it("aria-live polite + aria-label for screen readers", () => {
    render(<MobileViewportBanner />);
    const banner = screen.getByTestId("mobile-viewport-banner");
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.getAttribute("aria-live")).toBe("polite");
    expect(banner.getAttribute("aria-label")).toBe("Mobile viewport advisory");
  });

  it("dismiss button has accessible aria-label", () => {
    render(<MobileViewportBanner />);
    const dismissBtn = screen.getByLabelText(
      "Dismiss mobile viewport advisory",
    );
    expect(dismissBtn).toBeTruthy();
  });
});
