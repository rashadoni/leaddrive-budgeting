// @vitest-environment happy-dom
/**
 * Panel 3 must not present the stored zero of an unscored cell as a figure.
 *
 * 2026-08-04 audit, reproduced on production. `status: 'unknown'` rows still
 * carry a stored `value`, almost always 0. The HeatMap already refused to print
 * it ("a figure there could read as a real measurement" — HeatMapCellTd), but
 * Panel 3 rendered it as the 24px headline and then fed it to the indicator's
 * hint template, which is written as an assertion:
 *
 *     "Customer HHI is 0.00. Above 0.25 = one buyer holds enough share to
 *      threaten cash flow on a single delayed payment."
 *
 * For a concentration measure 0.00 is the BEST possible score. So the drill-down
 * — the screen a person opens to check a number before acting on it — reported
 * perfect customer diversification for a company it had no figures for.
 * Sixteen such cells were live at the time.
 *
 * The evidenced zero is the other half of the contract and is asserted here
 * too: a measured 0 must keep rendering as 0, or the fix would trade one lie
 * for its opposite.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  return {
    ...actual,
    useLocale: () => "en",
    useTranslations: () => {
      const t = (key: string) => key;
      (t as unknown as { rich: unknown }).rich = (key: string) => key;
      (t as unknown as { has: () => boolean }).has = () => true;
      return t as never;
    },
  };
});

vi.mock("../store/terminalStore", () => ({
  useTerminalStore: <T,>(selector: (s: Record<string, unknown>) => T) =>
    selector({
      activeIndicatorValueId: "iv_test",
      activeCompanyCode: "TEST-CO",
      pendingMissingCell: null,
      pendingRollupCell: null,
      selectedPeriod: "2026",
      alertMatches: [],
    }),
}));

/** The production shape of an unscored concentration cell. */
function detail(status: "unknown" | "green", value: number) {
  return {
    id: "iv_test",
    value,
    status,
    period: "2026",
    computedAt: "2026-04-28T00:00:00Z",
    inputs: { resolved: {}, aggregates: {}, error: undefined },
    sparkline: null,
    indicator: {
      id: "ind_hhi",
      code: "CUSTOMER_HHI",
      nameEn: "Customer Concentration (HHI)",
      unit: "index",
      direction: "lower_better" as const,
      formula: "hhi(customers)",
      thresholds: { green: { lte: 0.15 }, red: { gte: 0.25 } },
      hintTemplateEn:
        "Customer HHI is {value}. Above 0.25 = one buyer holds enough share to threaten cash flow on a single delayed payment.",
      requiredInputs: [],
    },
    company: { id: "co_test", code: "TEST-CO", name: "Test Co", industry: "Agro" },
  };
}

async function mount(status: "unknown" | "green", value: number) {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify(detail(status, value)), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as never;
  const { IndicatorDetail } = await import("./IndicatorDetail");
  render(<IndicatorDetail />);
  await waitFor(() =>
    expect(screen.getByTestId("indicator-detail-result")).toBeTruthy(),
  );
  return screen.getByTestId("indicator-detail-result").textContent ?? "";
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.resetModules();
});

describe("Panel 3 with an unscored (unknown) cell", () => {
  it("does not render the stored zero as a figure", async () => {
    const text = await mount("unknown", 0);
    expect(text).not.toMatch(/0\.00/);
    expect(text).toContain("—");
  });

  it("does not state the fabricated zero as a finding", async () => {
    const text = await mount("unknown", 0);
    // The hint is an assertion about a number; with no number there is nothing
    // to assert, and filling it in inverted the risk.
    expect(text).not.toContain("Customer HHI is");
  });

  it("omits the benchmark band rather than marking a position for it", async () => {
    await mount("unknown", 0);
    expect(screen.queryByTestId("benchmark-band")).toBeNull();
  });
});

describe("Panel 3 with an evidenced zero", () => {
  it("still renders the measured zero", async () => {
    const text = await mount("green", 0);
    expect(text).toMatch(/0\.00|0 index|0\b/);
  });

  it("still states it in the hint", async () => {
    const text = await mount("green", 0);
    expect(text).toContain("Customer HHI is");
  });
});
