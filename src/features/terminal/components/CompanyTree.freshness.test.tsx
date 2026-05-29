// @vitest-environment happy-dom
/**
 * Phase 8 A4 — per-company freshness chip (RowFreshness) wire-up.
 *
 * `formatFreshness` is unit-tested in lib/relative-time.test.ts. These tests
 * lock the matrix → CompanyTree → RowFreshness pipeline: a chip appears with
 * the right compact label + dot colour given cells carrying `computedAt`,
 * sub-groups inherit MAX(descendants), and rows with no computed cells render
 * no chip. Mocks `useMatrix` so the chip can be asserted without a browser.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

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
      { id: "azs_azsf_id", code: "AZSEKER-AZSF", name: "AZSF", industry: "food_processing" },
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

const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

afterEach(() => {
  cleanup();
  useMatrixMock.mockReset();
});

describe("CompanyTree RowFreshness — A4 per-company freshness chip", () => {
  it("renders an emerald chip with a compact 'h' label for a recently-computed leaf", () => {
    mockMatrix([
      { companyId: "azs_azsf_id", indicatorId: "ind_gm", value: 25, status: "green", computedAt: isoAgo(2 * 3_600_000) },
    ]);
    const { container } = render(<CompanyTree companies={COMPANIES} />);
    const chips = container.querySelectorAll('[data-testid="row-freshness"]');
    // Leaf has a cell → leaf chip + parent inherits MAX(descendants) → 2 chips.
    expect(chips.length).toBeGreaterThanOrEqual(2);
    expect(chips[0].textContent).toContain("2h");
    expect(chips[0].querySelector(".bg-emerald-500")).not.toBeNull();
    expect(chips[0].querySelector(".bg-amber-500")).toBeNull();
  });

  it("flips the dot amber + shows a 'd' label when the latest compute is >24h old", () => {
    mockMatrix([
      { companyId: "azs_azsf_id", indicatorId: "ind_gm", value: 25, status: "green", computedAt: isoAgo(3 * 86_400_000) },
    ]);
    const { container } = render(<CompanyTree companies={COMPANIES} />);
    const chip = container.querySelector('[data-testid="row-freshness"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain("3d");
    expect(chip!.querySelector(".bg-amber-500")).not.toBeNull();
  });

  it("renders no chip when no cell carries a computedAt", () => {
    mockMatrix([
      { companyId: "azs_azsf_id", indicatorId: "ind_gm", value: 25, status: "green" },
    ]);
    const { container } = render(<CompanyTree companies={COMPANIES} />);
    expect(container.querySelectorAll('[data-testid="row-freshness"]').length).toBe(0);
  });

  it("uses the MOST-RECENT cell when a company has several computes", () => {
    mockMatrix([
      { companyId: "azs_azsf_id", indicatorId: "ind_gm", value: 25, status: "green", computedAt: isoAgo(5 * 86_400_000) },
      { companyId: "azs_azsf_id", indicatorId: "ind_x", value: 1, status: "amber", computedAt: isoAgo(10 * 60_000) },
    ]);
    const { container } = render(<CompanyTree companies={COMPANIES} />);
    const chip = container.querySelector('[data-testid="row-freshness"]');
    // MAX(computedAt) = the 10-minutes-ago cell → "10m", emerald (not stale).
    expect(chip!.textContent).toContain("10m");
    expect(chip!.querySelector(".bg-emerald-500")).not.toBeNull();
  });
});
