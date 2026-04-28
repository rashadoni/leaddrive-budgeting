// @vitest-environment happy-dom
/**
 * Regression test for bug fix #5 shipped in commit e66263a:
 *   "LayoutMenu PRESET/SAVED name collision — was: user saving a layout
 *    literally named 'Bloomberg' produced 2 dropdown entries. Now:
 *    client-side filter hides saved layouts whose name matches a
 *    BUILT_IN_PRESETS label."
 *
 * Locks the de-dup behavior so the dropdown never double-shows a name
 * that is also a built-in preset label. The API-side reservation (a
 * separate 🔄) is independent — this test covers the read-side guard.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LayoutMenu } from "./LayoutMenu";
import { BUILT_IN_PRESETS, DEFAULT_LAYOUT_SIZES } from "../lib/layout-sizes";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LayoutMenu PRESET/SAVED collision (e66263a fix #5)", () => {
  it("hides a saved layout whose name matches a built-in preset label", async () => {
    // Mock GET /api/terminal/layouts to return a user-saved layout
    // literally named "Bloomberg" — same string as the bloomberg preset's
    // label. Pre-fix: dropdown rendered TWO rows labeled "Bloomberg"
    // (one preset + one saved). Post-fix: only the preset row appears.
    const collidingName = BUILT_IN_PRESETS.bloomberg.label; // "Bloomberg"
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "/api/terminal/layouts") {
        return new Response(
          JSON.stringify({
            layouts: [
              {
                id: "saved-bloomberg",
                name: collidingName,
                sizes: DEFAULT_LAYOUT_SIZES,
                updatedAt: new Date().toISOString(),
              },
              {
                id: "saved-other",
                name: "My Custom Layout",
                sizes: DEFAULT_LAYOUT_SIZES,
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    }) as never;

    render(
      <LayoutMenu
        readCurrent={() => DEFAULT_LAYOUT_SIZES}
        applyLayout={() => {}}
      />,
    );

    // Open the dropdown.
    fireEvent.click(screen.getByText("▢ Layouts"));

    // Wait for the saved-list refresh to land + render.
    await waitFor(() => {
      expect(screen.queryByText("My Custom Layout")).toBeTruthy();
    });

    // The "Bloomberg" string must appear EXACTLY ONCE in the dropdown
    // (under the Presets section). The saved-Bloomberg row must be
    // filtered out.
    const matches = screen.getAllByText(collidingName);
    expect(matches).toHaveLength(1);

    // Sanity: that single "Bloomberg" lives in the Presets list, not
    // the Saved list. The preset button has title "Apply Bloomberg
    // preset" (per LayoutMenu.tsx render), saved buttons have title
    // starting with `Load "<name>"`.
    expect(matches[0].getAttribute("title")).toMatch(/Apply .* preset/i);

    // The non-colliding saved layout still renders.
    expect(screen.getByText("My Custom Layout")).toBeTruthy();
  });

  it("shows BOTH preset row and saved row when names differ", async () => {
    // Sanity check: the filter must be name-equality, not "always hide
    // saved". A saved layout with a unique name still appears.
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "/api/terminal/layouts") {
        return new Response(
          JSON.stringify({
            layouts: [
              {
                id: "saved-unique",
                name: "Bloomberg Custom",
                sizes: DEFAULT_LAYOUT_SIZES,
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    }) as never;

    render(
      <LayoutMenu
        readCurrent={() => DEFAULT_LAYOUT_SIZES}
        applyLayout={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("▢ Layouts"));
    await waitFor(() => {
      expect(screen.queryByText("Bloomberg Custom")).toBeTruthy();
    });
    // "Bloomberg" preset still renders.
    expect(screen.getByText("Bloomberg")).toBeTruthy();
    // "Bloomberg Custom" saved layout also renders (different name).
    expect(screen.getByText("Bloomberg Custom")).toBeTruthy();
  });
});
