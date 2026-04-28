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
  it("renders aria-label + visible label", () => {
    render(<PrintButton />);
    const btn = screen.getByLabelText("Print board snapshot to PDF");
    expect(btn.textContent).toContain("Print to PDF");
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
    fireEvent.click(screen.getByLabelText("Print board snapshot to PDF"));
    expect(printFn).toHaveBeenCalledOnce();
  });

  it("uses print:hidden so the button does NOT print itself", () => {
    render(<PrintButton />);
    const btn = screen.getByLabelText("Print board snapshot to PDF");
    expect(btn.className).toContain("print:hidden");
  });
});
