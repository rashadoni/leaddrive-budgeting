// @vitest-environment happy-dom
/**
 * Comparing a company that has figures against one that has none must not
 * produce a delta.
 *
 * 2026-08-04 audit. An IndicatorValue row with `status: 'unknown'` still stores
 * a numeric `value`, almost always 0 — 'unknown' means the classifier had
 * nothing to score, not that the answer was zero. ComparePanel read `.value`
 * with no status check, so an unscored side rendered a bright `0.0` and then
 * went into the subtraction:
 *
 *     delta = rhsValue - lhsValue   // 12.5 - 0 = "+12.5"
 *
 * The displayed 0 at least carried a ◇ glyph. The delta carried nothing — a
 * precise, confident, coloured number derived from data that does not exist,
 * on the screen used to decide which subsidiary is doing worse.
 *
 * The evidenced zero is asserted in the same file: a measured 0 must still
 * compare normally, or the fix would hide real findings.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import { ComparePanel } from "./ComparePanel";

function matrix(lhsStatus: "unknown" | "green", lhsValue: number) {
  return {
    period: "2026",
    companies: [
      { id: "co_a", code: "CO-A", name: "Co A", industry: "Agro" },
      { id: "co_b", code: "CO-B", name: "Co B", industry: "Agro" },
    ],
    indicators: [
      {
        id: "ind_margin",
        code: "IND_NET_MARGIN",
        nameEn: "Net Margin",
        nameRu: "Чистая маржа",
        nameAz: "Xalis marja",
        unit: "%",
        direction: "higher_better",
      },
    ],
    cells: [
      { indicatorValueId: "iv1", companyId: "co_a", indicatorId: "ind_margin", value: lhsValue, status: lhsStatus },
      { indicatorValueId: "iv2", companyId: "co_b", indicatorId: "ind_margin", value: 12.5, status: "green" },
    ],
  };
}

async function openCompare(lhsStatus: "unknown" | "green", lhsValue: number) {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify(matrix(lhsStatus, lhsValue)), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as never;
  render(<ComparePanel />);
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent("terminal:open-compare", { detail: { lhs: "CO-A", rhs: "CO-B" } }),
    );
  });
  await waitFor(() => expect(screen.getByText(/Net Margin/i)).toBeTruthy());
  const row = screen.getByText(/Net Margin/i).closest("tr");
  expect(row).toBeTruthy();
  return (row!.textContent ?? "").replace(/\s+/g, " ");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ComparePanel with an unscored side", () => {
  it("shows no figure for the side that has no data", async () => {
    const row = await openCompare("unknown", 0);
    // The scored side keeps its number; the unscored one must not invent one.
    expect(row).toContain("12.5");
    expect(row).toContain("—");
  });

  it("does not compute a delta against data that does not exist", async () => {
    const row = await openCompare("unknown", 0);
    // "+12.5" would be the fabricated delta (12.5 - 0).
    expect(row).not.toContain("+12.5");
    expect(row).not.toContain("12.50");
  });
});

describe("ComparePanel with an evidenced zero", () => {
  it("compares a measured zero normally", async () => {
    const row = await openCompare("green", 0);
    // A real 0 is a real finding and must still produce its delta.
    expect(row).toMatch(/12\.5/);
  });
});
