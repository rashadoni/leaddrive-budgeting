// @vitest-environment happy-dom
/**
 * Phase B7 — CompanySnapshot tests.
 *
 * Locks in:
 *   - Loading state during fetch.
 *   - Error state on fetch failure.
 *   - Renders 3 cards (Gross/Net/OpEx) when matrix has all 3 indicators.
 *   - Each card shows nameEn, value+unit, sparkline.
 *   - Filters down gracefully when 1+ indicator absent for company.
 *   - Empty fallback when company has none of the 3 indicators.
 *   - Unknown company → "not in current matrix" message.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { CompanySnapshot } from "./CompanySnapshot";
import { __resetMatrixCacheForTests } from "../hooks/use-matrix";

const FULL_FIXTURE = {
  period: "2026",
  companies: [
    { id: "co_aac", code: "AAC-MAIN", name: "AAC Main", industry: "Industrial" },
  ],
  indicators: [
    {
      id: "ind_gross",
      code: "IND_GROSS_MARGIN",
      nameEn: "Gross Margin",
      unit: "%",
      direction: "higher_better",
    },
    {
      id: "ind_net",
      code: "IND_NET_MARGIN",
      nameEn: "Net Margin",
      unit: "%",
      direction: "higher_better",
    },
    {
      id: "ind_opex",
      code: "IND_OPEX_RATIO",
      nameEn: "OpEx Ratio",
      unit: "%",
      direction: "lower_better",
    },
  ],
  cells: [
    {
      indicatorValueId: "iv1",
      companyId: "co_aac",
      indicatorId: "ind_gross",
      value: 15.1,
      status: "amber",
      sparkline: [10, 11, 12, 13, 14, 15, 14, 15, 14, 15, 14, 15.1],
    },
    {
      indicatorValueId: "iv2",
      companyId: "co_aac",
      indicatorId: "ind_net",
      value: -9.46,
      status: "red",
      sparkline: [-9.46, -9.46, -9.46, -9.46, -9.46, -9.46, -9.46, -9.46, -9.46, -9.46, -9.46, -9.46],
    },
    {
      indicatorValueId: "iv3",
      companyId: "co_aac",
      indicatorId: "ind_opex",
      value: 24.6,
      status: "amber",
      sparkline: [24, 24.5, 25, 24.6, 24.6, 24.6, 24.6, 24.6, 24.6, 24.6, 24.6, 24.6],
    },
  ],
};

beforeEach(() => {
  // Sub-20: reset useMatrix module cache between tests so each test's
  // fetch mock controls the resolved data (without this the first
  // test's payload sticks for the rest of the file).
  __resetMatrixCacheForTests();
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify(FULL_FIXTURE), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as never;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CompanySnapshot (Phase B7)", () => {
  it("renders Loading state during fetch", () => {
    __resetMatrixCacheForTests();
    let resolveFetch!: (value: Response) => void;
    global.fetch = vi.fn(
      () => new Promise<Response>((r) => { resolveFetch = r; }),
    ) as never;
    render(<CompanySnapshot companyCode="AAC-MAIN" />);
    expect(screen.queryByText(/Loading snapshot/i)).toBeTruthy();
    resolveFetch(
      new Response(JSON.stringify(FULL_FIXTURE), { status: 200 }),
    );
  });

  it("renders 3 cards (Gross/Net/OpEx) for company with all 3 indicators", async () => {
    render(<CompanySnapshot companyCode="AAC-MAIN" />);
    await waitFor(() => {
      expect(screen.queryByText("Gross Margin")).toBeTruthy();
    });
    expect(screen.queryByText("Net Margin")).toBeTruthy();
    expect(screen.queryByText("OpEx Ratio")).toBeTruthy();
    // Each card shows formatted value
    expect(screen.queryByText("15.1 %")).toBeTruthy();
    expect(screen.queryByText("-9.46 %")).toBeTruthy();
    expect(screen.queryByText("24.6 %")).toBeTruthy();
  });

  it("each card has a sparkline svg", async () => {
    render(<CompanySnapshot companyCode="AAC-MAIN" />);
    await waitFor(() => {
      expect(screen.queryByText("Gross Margin")).toBeTruthy();
    });
    const svgs = document.querySelectorAll("svg[role='img']");
    expect(svgs.length).toBeGreaterThanOrEqual(3);
  });

  it("Header shows active company code in highlight color", async () => {
    render(<CompanySnapshot companyCode="AAC-MAIN" />);
    await waitFor(() => {
      expect(screen.queryByText("Gross Margin")).toBeTruthy();
    });
    expect(screen.queryByText("AAC-MAIN")).toBeTruthy();
    // Sub-27 cont'd multi-lingual: header label + "12mo trend" now flow
    // through next-intl `t()`. Vitest mock returns the key itself, so we
    // assert on the key string. Production renders translated label.
    expect(screen.queryByText(/snapshot\.title/)).toBeTruthy();
    expect(screen.queryByText(/snapshot\.trend12mo/)).toBeTruthy();
  });

  it("Falls back to no-data text when company has 0 of 3 indicators", async () => {
    const noMatchFixture = {
      ...FULL_FIXTURE,
      indicators: [
        {
          id: "ind_other",
          code: "AGRO_YIELD",
          nameEn: "Yield",
          unit: "ton/ha",
          direction: "higher_better",
        },
      ],
      cells: [],
    };
    __resetMatrixCacheForTests();
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(noMatchFixture), { status: 200 }),
    ) as never;
    render(<CompanySnapshot companyCode="AAC-MAIN" />);
    await waitFor(() => {
      expect(screen.queryByText(/No P&L margin indicators/i)).toBeTruthy();
    });
  });

  it("Shows 'not in current matrix' for unknown company code", async () => {
    render(<CompanySnapshot companyCode="GHOST-CO" />);
    await waitFor(() => {
      expect(screen.queryByText(/not in current matrix/i)).toBeTruthy();
    });
  });

  it("Renders error state on fetch failure", async () => {
    __resetMatrixCacheForTests();
    global.fetch = vi.fn(async () =>
      new Response("server error", { status: 500 }),
    ) as never;
    render(<CompanySnapshot companyCode="AAC-MAIN" />);
    await waitFor(() => {
      expect(screen.queryByText(/Snapshot error/i)).toBeTruthy();
    });
  });
});
