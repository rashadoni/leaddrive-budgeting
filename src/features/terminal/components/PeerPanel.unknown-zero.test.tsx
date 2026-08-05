// @vitest-environment happy-dom
/**
 * Peer comparison must not crown a company that has no data.
 *
 * 2026-08-04 sweep, found by four independent search angles. The guard here was
 * `Number.isFinite(cell.value)`, and an unscored row's stored 0 is finite. On
 * any `lower_better` indicator — customer HHI, DSO, opex ratio, leverage — that
 * fabricated 0 is the minimum of the cohort, so:
 *
 *   - the company with NO data was marked "▲ 0.00" in bold emerald as the best
 *     performer of the group, and
 *   - the company that had actually reported a figure was pushed into the "▼"
 *     worst slot in rose.
 *
 * The inversion landed on the one screen whose entire purpose is ranking, and
 * it is the original fabricated-zero defect reproduced in the ordering rather
 * than in the display — which is worse, because a rank carries no marker
 * saying which number produced it.
 */

import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";

/** CO-A has no measurement; CO-B reported a real, worse-looking 0.30. */
function matrix(aStatus: "unknown" | "green") {
  return {
    period: "2026",
    companies: [
      { id: "a", code: "CO-A", name: "Co A", industry: "Agro" },
      { id: "b", code: "CO-B", name: "Co B", industry: "Agro" },
    ],
    indicators: [
      {
        id: "hhi",
        code: "CUSTOMER_HHI",
        nameEn: "Customer Concentration",
        nameRu: "Концентрация клиентов",
        nameAz: "Müştəri konsentrasiyası",
        unit: "index",
        direction: "lower_better",
      },
    ],
    cells: [
      { indicatorValueId: "iv1", companyId: "a", indicatorId: "hhi", value: 0, status: aStatus },
      { indicatorValueId: "iv2", companyId: "b", indicatorId: "hhi", value: 0.3, status: "amber" },
    ],
  };
}

async function openPeer(aStatus: "unknown" | "green") {
  // `use-matrix` keeps a module-level cache with no eviction, so without a
  // module reset the second mount in this file would be served the first
  // mount's payload. (That cache is itself one of the audit's findings.)
  vi.resetModules();
  const { PeerPanel } = await import("./PeerPanel");
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify(matrix(aStatus)), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as never;
  render(<PeerPanel />);
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent("terminal:open-peer", { detail: { codes: ["CO-A", "CO-B"] } }),
    );
  });
  await waitFor(() => expect(screen.getByText(/Customer Concentration/i)).toBeTruthy());
  const row = screen.getByText(/Customer Concentration/i).closest("tr");
  expect(row).toBeTruthy();
  // Assert on the VALUE cells only. The label column also renders ▲/▼ as the
  // indicator's direction glyph, so a whole-row text match cannot tell a
  // direction marker from a ranking marker.
  const valueCells = [...row!.querySelectorAll("td")]
    .slice(1)
    .map((td) => (td.textContent ?? "").replace(/\s+/g, " ").trim());
  return valueCells;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PeerPanel with an unmeasured company in the cohort", () => {
  it("shows no figure for the company that has no data", async () => {
    const [coA, coB] = await openPeer("unknown");
    expect(coA).toBe("—");
    expect(coB).toContain("0.3");
  });

  it("does not award it the best-in-cohort marker", async () => {
    const [coA, coB] = await openPeer("unknown");
    // ▲ marks best, ▼ worst. With one measured company left there is no cohort
    // to rank, so no value cell carries either marker.
    expect(coA).not.toContain("▲");
    expect(coB).not.toContain("▲");
    expect(coB).not.toContain("▼");
  });
});

describe("PeerPanel with an evidenced zero", () => {
  it("still ranks a measured zero as the best on a lower-is-better indicator", async () => {
    // The other half of the contract: a real 0 really is the best HHI there is,
    // and hiding it would suppress a true finding.
    const [coA, coB] = await openPeer("green");
    expect(coA).toContain("▲");
    expect(coA).toMatch(/\b0\.0\b/);
    expect(coB).toContain("▼");
  });
});
