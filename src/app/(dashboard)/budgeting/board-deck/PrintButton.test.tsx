// @vitest-environment happy-dom
/**
 * Phase C3 v1 — PrintButton smoke + behavior.
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
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PrintButton } from "./PrintButton";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PrintButton (Phase C3 v1)", () => {
  // Phase 8 D7 (2026-05-28) — assertions updated for i18n. The global
  // next-intl mock in vitest.setup.ts returns fallback labels derived
  // from the key (camelCase → SPACED UPPERCASE), so `t("printLabel")`
  // renders as "PRINT LABEL". Tests target the button via aria-label
  // (mapped from `t("printAriaLabel")` → "PRINT ARIA LABEL").
  const PRINT_ARIA = "PRINT ARIA LABEL";

  it("renders aria-label + visible label", () => {
    render(<PrintButton />);
    const btn = screen.getByLabelText(PRINT_ARIA);
    expect(btn.textContent).toMatch(/PRINT/);
  });

  it("clicking calls window.print()", () => {
    // happy-dom doesn't define `window.print` — assign a fresh spy
    // function (rather than spyOn'ing undefined). Reset after the test
    // via afterEach's vi.restoreAllMocks().
    const printFn = vi.fn();
    Object.defineProperty(window, "print", {
      value: printFn,
      writable: true,
      configurable: true,
    });
    render(<PrintButton />);
    fireEvent.click(screen.getByLabelText(PRINT_ARIA));
    expect(printFn).toHaveBeenCalledOnce();
  });

  it("uses print:hidden so the button does NOT print itself", () => {
    render(<PrintButton />);
    const btn = screen.getByLabelText(PRINT_ARIA);
    expect(btn.className).toContain("print:hidden");
  });
});
