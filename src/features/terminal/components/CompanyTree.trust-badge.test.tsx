// @vitest-environment happy-dom
/**
 * V4 closure 2026-05-16 — TrustBadge wire-up at the CompanyTree level.
 *
 * `computeCompanyTrustStatus` is unit-tested in trust-status.test.ts. What
 * was missing per TRUTH_INFRA_FOLLOWUPS V4 was the integration assertion
 * that the matrix → CompanyTree → TrustBadge pipeline actually surfaces
 * the right colored dot when a material cell carries a `high_extreme`
 * sanityBand. These tests mock `useMatrix` so the badge render can be
 * asserted against `aria-label` without a browser screenshot.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Hoist a mock so we can swap the matrix payload per-test.
const { useMatrixMock } = vi.hoisted(() => ({ useMatrixMock: vi.fn() }));
vi.mock("../hooks/use-matrix", () => ({ useMatrix: useMatrixMock }));

import { CompanyTree, type CompanyNode } from "./CompanyTree";

const COMPANIES: CompanyNode[] = [
  {
    id: "azs_id",
    code: "AZSEKER",
    name: "AzərŞəkər",
    industry: "food_processing",
    children: [
      {
        id: "azs_azsf_id",
        code: "AZSEKER-AZSF",
        name: "AZSF",
        industry: "food_processing",
      },
    ],
  },
];

function mockMatrix(cells: Array<Record<string, unknown>>) {
  useMatrixMock.mockReturnValue({
    matrix: {
      period: "2026",
      companies: [
        { id: "azs_id", code: "AZSEKER", name: "AzərŞəkər", industry: "food_processing" },
        {
          id: "azs_azsf_id",
          code: "AZSEKER-AZSF",
          name: "AZSF",
          industry: "food_processing",
          parentCompanyId: "azs_id",
        },
      ],
      indicators: [
        { id: "ind_gm", code: "FP_GROSS_MARGIN", nameEn: "Gross Margin", direction: "higher_better", unit: "%" },
      ],
      cells,
    },
    loading: false,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
  });
}

afterEach(() => {
  cleanup();
  useMatrixMock.mockReset();
});

describe("CompanyTree TrustBadge — high_extreme propagation (V4 closure)", () => {
  it("renders suspicious dot for the leaf when material cell has high_extreme sanityBand", () => {
    mockMatrix([
      // One material cell on the leaf with high_extreme band — should
      // flip trust → suspicious per trust-status.ts rule "any material
      // cell extreme → suspicious".
      {
        companyId: "azs_azsf_id",
        indicatorId: "ind_gm",
        value: 95,
        status: "red",
        sanityBand: "high_extreme",
        lastReconciledAt: new Date().toISOString(),
      },
    ]);
    const { container } = render(<CompanyTree companies={COMPANIES} />);
    const badges = container.querySelectorAll('[aria-label^="Trust status:"]');
    const labels = Array.from(badges).map((el) => el.getAttribute("aria-label"));
    // The leaf row carries the suspicious badge.
    expect(labels).toContain("Trust status: suspicious");
  });

  it("bubbles suspicious child up to the parent sub-group header", () => {
    mockMatrix([
      {
        companyId: "azs_azsf_id",
        indicatorId: "ind_gm",
        value: 95,
        status: "red",
        sanityBand: "high_extreme",
        lastReconciledAt: new Date().toISOString(),
      },
    ]);
    const { container } = render(<CompanyTree companies={COMPANIES} />);
    // The parent header row also surfaces the suspicious dot — confirms
    // the worst-child-wins bubble logic in CompanyTree's trustByCode
    // useMemo (lines 113-153). Two TrustBadge elements expected: parent
    // + leaf, both 'suspicious'.
    const badges = container.querySelectorAll('[aria-label^="Trust status:"]');
    const suspiciousCount = Array.from(badges).filter(
      (el) => el.getAttribute("aria-label") === "Trust status: suspicious",
    ).length;
    expect(suspiciousCount).toBeGreaterThanOrEqual(2);
  });

  it("renders verified dot when cells are normal (control case)", () => {
    mockMatrix([
      {
        companyId: "azs_azsf_id",
        indicatorId: "ind_gm",
        value: 25,
        status: "green",
        sanityBand: "normal",
        lastReconciledAt: new Date().toISOString(),
      },
    ]);
    const { container } = render(<CompanyTree companies={COMPANIES} />);
    const badges = container.querySelectorAll('[aria-label^="Trust status:"]');
    const labels = Array.from(badges).map((el) => el.getAttribute("aria-label"));
    expect(labels).toContain("Trust status: verified");
    expect(labels).not.toContain("Trust status: suspicious");
  });
});
