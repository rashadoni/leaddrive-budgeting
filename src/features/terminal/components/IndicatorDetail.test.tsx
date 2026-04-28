// @vitest-environment happy-dom
/**
 * Phase C2 v1 — IndicatorDetail forecast surface tests.
 *
 * Locks the v1 surface contract:
 *  - Forecast section renders when sparkline has ≥3 contributing points.
 *  - Section absent when sparkline is null OR <3 points.
 *  - Confidence color tone reflects helper output.
 *  - "no change expected" copy when slope ≈ 0.
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
import {
  render,
  screen,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { IndicatorDetail } from "./IndicatorDetail";

// Store mock — point at one IV.
vi.mock("../store/terminalStore", () => ({
  useTerminalStore: <T,>(
    selector: (s: {
      activeIndicatorValueId: string | null;
      setActivePanel: (id: number) => void;
    }) => T,
  ) => selector({ activeIndicatorValueId: "iv_test", setActivePanel: () => {} }),
}));

interface DetailFixture {
  id?: string;
  value?: number;
  status?: "green" | "amber" | "red" | "unknown";
  sparkline: (number | null)[] | null;
}

function fixture(overrides: DetailFixture) {
  const base = {
    id: "iv_test",
    value: 0,
    status: "green" as const,
    period: "2026",
    computedAt: "2026-04-28T00:00:00Z",
    inputs: { resolved: {}, aggregates: {}, error: undefined },
    indicator: {
      id: "ind_x",
      code: "IND_TEST",
      nameEn: "Test Indicator",
      unit: "%",
      direction: "higher_better" as const,
      formula: "x + y",
      thresholds: { green: { gte: 0 }, amber: { gte: -10 } },
      hintTemplateEn: "Test hint",
      requiredInputs: [],
    },
    company: {
      id: "co_test",
      code: "TEST-CO",
      name: "Test Co",
      industry: "Industrial",
    },
  };
  return { ...base, ...overrides };
}

beforeEach(() => {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify(fixture({ sparkline: null })), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as never;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // Architect Round-1 sub-13 ⚠️ closure: defensive module-registry
  // reset after every test so the file-scoped `vi.mock("../store/...")`
  // can't conceivably leak into a parallel-worker file. (Pattern is
  // identical to AlertsPanel/ScenarioPanel tests which have shipped
  // clean, but the architect once observed a transient flake — this
  // hardening is cheap insurance.)
  vi.resetModules();
});

describe("IndicatorDetail forecast surface (Phase C2 v1)", () => {
  it("renders forecast when sparkline has ≥3 points", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify(
          fixture({ sparkline: [10, 12, 14, 16, 18, 20, 22, 24] }),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as never;
    render(<IndicatorDetail />);
    await waitFor(() => {
      expect(screen.getByTestId("indicator-forecast")).toBeTruthy();
    });
    const section = screen.getByTestId("indicator-forecast");
    // Predicted next slot = 26 (perfect slope-2 line). Verify it appears.
    expect(section.textContent).toMatch(/26/);
    // High-confidence tone (n=8 + r²=1 → high).
    expect(section.textContent).toContain("high confidence");
  });

  it("forecast section absent when sparkline is null", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(fixture({ sparkline: null })), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as never;
    render(<IndicatorDetail />);
    // Wait for the fetch to resolve + indicator section to render.
    await waitFor(() => {
      expect(screen.getByText(/IND_TEST/)).toBeTruthy();
    });
    expect(screen.queryByTestId("indicator-forecast")).toBeNull();
  });

  it("forecast section absent when sparkline has <3 contributing points", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify(fixture({ sparkline: [10, null, null, 12] })),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as never;
    render(<IndicatorDetail />);
    await waitFor(() => {
      expect(screen.getByText(/IND_TEST/)).toBeTruthy();
    });
    // 2 contributing points → forecast helper returns null → no section.
    expect(screen.queryByTestId("indicator-forecast")).toBeNull();
  });

  it('flat series renders "no change expected" copy', async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify(fixture({ sparkline: [5, 5, 5, 5, 5, 5] })),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as never;
    render(<IndicatorDetail />);
    await waitFor(() => {
      expect(screen.getByTestId("indicator-forecast")).toBeTruthy();
    });
    const section = screen.getByTestId("indicator-forecast");
    expect(section.textContent).toContain("no change expected");
    // Direction arrow is the flat-line marker, not up/down.
    expect(section.textContent).toContain("→");
  });

  it("descending series renders ↓ arrow", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify(fixture({ sparkline: [20, 18, 16, 14, 12, 10, 8] })),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as never;
    render(<IndicatorDetail />);
    await waitFor(() => {
      expect(screen.getByTestId("indicator-forecast")).toBeTruthy();
    });
    const section = screen.getByTestId("indicator-forecast");
    expect(section.textContent).toContain("↓");
    // Predicted at x=7 → 20 + 7·(-2) = 6. Sign should be "+" (positive
    // predicted from descending series — architect Round-1 sub-13 fix).
    expect(section.textContent).toContain("+6");
  });

  // REGRESSION: architect Round-1 sub-13 ⚠️ closure — confidence color
  // class must reflect helper output. Without these assertions, a
  // future refactor could break the high/medium/low → tone mapping
  // silently while textContent still passes.
  it("high-confidence forecast renders teal text class", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify(
          fixture({ sparkline: [10, 12, 14, 16, 18, 20, 22, 24] }),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as never;
    render(<IndicatorDetail />);
    await waitFor(() => {
      expect(screen.getByTestId("indicator-forecast")).toBeTruthy();
    });
    const section = screen.getByTestId("indicator-forecast");
    // The predicted-value <span> carries the forecastColor class.
    const valueSpan = section.querySelector("span.font-mono");
    expect(valueSpan?.className).toContain("text-[#00D4AA]");
  });

  it("medium-confidence forecast renders amber text class", async () => {
    // n=5 with perfect fit → r²=1 satisfies medium (n≥5) but not high (n<6).
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify(fixture({ sparkline: [10, 20, 30, 40, 50] })),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as never;
    render(<IndicatorDetail />);
    await waitFor(() => {
      expect(screen.getByTestId("indicator-forecast")).toBeTruthy();
    });
    const section = screen.getByTestId("indicator-forecast");
    const valueSpan = section.querySelector("span.font-mono");
    expect(valueSpan?.className).toContain("text-[#FFB800]");
  });

  it("low-confidence (flat) forecast renders gray text class", async () => {
    // Flat series → ssTot=0 forces 'low' regardless of n.
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify(fixture({ sparkline: [5, 5, 5, 5, 5, 5] })),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as never;
    render(<IndicatorDetail />);
    await waitFor(() => {
      expect(screen.getByTestId("indicator-forecast")).toBeTruthy();
    });
    const section = screen.getByTestId("indicator-forecast");
    const valueSpan = section.querySelector("span.font-mono");
    expect(valueSpan?.className).toContain("text-gray-400");
  });
});
