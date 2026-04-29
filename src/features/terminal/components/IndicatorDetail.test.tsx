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
  // Belt-and-braces module-registry reset. Originally added in sub-13
  // on a wrong diagnosis (suspected vi.mock cross-file leak from this
  // file polluting RelatedFunctionsMenu.test.tsx). Sub-18 root-caused
  // the actual flake to a same-file race in the consumer test (async
  // /api/companies fetch landing after `waitFor(menu open)`); fix
  // shipped in `RelatedFunctionsMenu.test.tsx` race-condition wrap.
  // resetModules retained as cheap insurance — the file-scoped
  // `vi.mock("../store/...")` is hoisted per-file so leak SHOULDN'T
  // happen, but the cleanup costs ~0ms and prevents future regression
  // if vitest's worker-pool isolation ever changes.
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

// Phase C2 v2 (sub-22) — LLM-narrated forecast explain panel.
describe("IndicatorDetail forecast explain panel (Phase C2 v2)", () => {
  // Default fixture: high-confidence ascending series so explain panel is
  // shown (low-confidence + flat-series hide the affordance per UX gate).
  const HIGH_CONF_SPARKLINE = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32];

  function detailFetchMock(initial: { sparkline: (number | null)[] | null }) {
    return vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      // /api/indicators/values/[id] — initial detail load.
      if (
        u.includes("/api/indicators/values/iv_test") &&
        !u.includes("forecast/explain")
      ) {
        return new Response(
          JSON.stringify(fixture({ sparkline: initial.sparkline })),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // /api/indicators/values/iv_test/forecast/explain — POST endpoint.
      if (u.includes("forecast/explain")) {
        return new Response(
          JSON.stringify({
            indicatorValueId: "iv_test",
            narrative:
              "Strong upward trend — net margin trajectory points from current 32% toward forecast 34% next period.",
            driverHypotheses: [
              "Q4 seasonal uplift in industrial demand",
              "Operating leverage from prior cost-restructuring",
            ],
            riskFactors: [
              "Iran sanctions tightening would push feedstock cost +20%",
              "AZN devaluation 15% could compress import margins",
            ],
            confidence: 0.78,
            modelName: "claude-sonnet-4-5-20250929",
            promptVersion: "v1",
            usage: { inputTokens: 220, outputTokens: 95 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as never;
  }

  it("renders 'Explain' button + EN/RU/AZ language tabs when forecast confidence > low", async () => {
    global.fetch = detailFetchMock({ sparkline: HIGH_CONF_SPARKLINE });
    render(<IndicatorDetail />);
    await waitFor(() => {
      expect(screen.getByTestId("forecast-explain-button")).toBeTruthy();
    });
    expect(screen.getByTestId("forecast-lang-en")).toBeTruthy();
    expect(screen.getByTestId("forecast-lang-ru")).toBeTruthy();
    expect(screen.getByTestId("forecast-lang-az")).toBeTruthy();
  });

  it("hides explain affordance for flat-series (no slope at all)", async () => {
    // Architect sub-22 ⚠️ closure: UI now gates ONLY on isFlat — low-
    // confidence callers ARE permitted (LLM surfaces "lead with the
    // limitation" caveat in narrative). Flat series still hide because
    // a zero-slope projection has nothing meaningful to narrate.
    global.fetch = detailFetchMock({
      sparkline: [5, 5, 5, 5, 5, 5],
    });
    render(<IndicatorDetail />);
    await waitFor(() => {
      expect(screen.getByTestId("indicator-forecast")).toBeTruthy();
    });
    expect(screen.queryByTestId("forecast-explain-button")).toBeNull();
  });

  it("SHOWS explain affordance for low-confidence (non-flat) series — LLM caveat handles it", async () => {
    // 3 points with weak fit: r²~0.04 + n=3 → 'low' confidence band.
    // Pre-sub-22 the affordance was hidden; post-sub-22 it's visible
    // because the LLM is instructed to lead with the limitation.
    global.fetch = detailFetchMock({ sparkline: [0, 5, 1] });
    render(<IndicatorDetail />);
    await waitFor(() => {
      expect(screen.getByTestId("forecast-explain-button")).toBeTruthy();
    });
  });

  it("clicking Explain → POST /forecast/explain → narrative + drivers + risks render", async () => {
    global.fetch = detailFetchMock({ sparkline: HIGH_CONF_SPARKLINE });
    const user = (await import("@testing-library/react")).fireEvent;
    render(<IndicatorDetail />);
    const btn = await screen.findByTestId("forecast-explain-button");
    user.click(btn);
    await waitFor(() => {
      expect(screen.getByTestId("forecast-narrative")).toBeTruthy();
    });
    const card = screen.getByTestId("forecast-narrative");
    expect(card.textContent).toContain("Strong upward trend");
    expect(card.textContent).toContain("Q4 seasonal uplift");
    expect(card.textContent).toContain("Iran sanctions");
    // LLM confidence rendered as percent.
    expect(card.textContent).toContain("78%");
    // Token-usage line.
    expect(card.textContent).toContain("220/95 tok");
  });

  it("renders multi-step horizon strip when response includes horizon (sub-23)", async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("forecast/explain")) {
        return new Response(
          JSON.stringify({
            indicatorValueId: "iv_test",
            narrative: "trajectory narrative",
            driverHypotheses: [],
            riskFactors: [],
            confidence: 0.7,
            modelName: "m",
            promptVersion: "v1",
            horizon: [
              { step: 1, predicted: 34 },
              { step: 2, predicted: 36 },
              { step: 3, predicted: 38 },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify(fixture({ sparkline: HIGH_CONF_SPARKLINE })),
        { status: 200 },
      );
    }) as never;
    const fe = (await import("@testing-library/react")).fireEvent;
    render(<IndicatorDetail />);
    fe.click(await screen.findByTestId("forecast-explain-button"));
    await waitFor(() => {
      expect(screen.getByTestId("forecast-horizon")).toBeTruthy();
    });
    // 3 step badges rendered with predicted values.
    expect(screen.getByTestId("forecast-horizon-step-1").textContent).toContain("+34");
    expect(screen.getByTestId("forecast-horizon-step-2").textContent).toContain("+36");
    expect(screen.getByTestId("forecast-horizon-step-3").textContent).toContain("+38");
    // Extrapolation caveat surfaced.
    expect(screen.getByTestId("forecast-horizon").textContent).toContain(
      "uncertainty grows",
    );
  });

  it("renders 95% CI ±range alongside predicted value (sub-24)", async () => {
    // Sub-24 — noisy ascending series → forecastNextPeriod auto-computes
    // predictionInterval; UI surfaces it as ±marginOfError text in v1
    // badge. Title attribute carries df + n for accessibility.
    global.fetch = detailFetchMock({
      sparkline: [0, 3, 3, 7, 7, 11, 11, 15], // ±1 noise around slope-2
    });
    render(<IndicatorDetail />);
    await waitFor(() => {
      expect(screen.getByTestId("forecast-ci")).toBeTruthy();
    });
    const ciSpan = screen.getByTestId("forecast-ci");
    // CI text starts with ±, followed by formatted margin.
    expect(ciSpan.textContent?.startsWith("±")).toBe(true);
    // Title carries df + n metadata.
    expect(ciSpan.getAttribute("title")).toContain("95% prediction interval");
    expect(ciSpan.getAttribute("title")).toContain("n=8");
    expect(ciSpan.getAttribute("title")).toContain("df=6");
  });

  it("hides ±range when forecast is perfect-fit (CI collapses to ±0)", async () => {
    // Perfect ascending line → ssRes=0 → marginOfError=0 → CI hidden.
    global.fetch = detailFetchMock({ sparkline: [0, 1, 2, 3, 4, 5, 6, 7] });
    render(<IndicatorDetail />);
    await waitFor(() => {
      expect(screen.getByTestId("indicator-forecast")).toBeTruthy();
    });
    expect(screen.queryByTestId("forecast-ci")).toBeNull();
  });

  it("hides horizon strip when response omits horizon or has only 1 step", async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("forecast/explain")) {
        return new Response(
          JSON.stringify({
            indicatorValueId: "iv_test",
            narrative: "single-step",
            driverHypotheses: [],
            riskFactors: [],
            confidence: 0.5,
            modelName: "m",
            promptVersion: "v1",
            horizon: [{ step: 1, predicted: 34 }],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify(fixture({ sparkline: HIGH_CONF_SPARKLINE })),
        { status: 200 },
      );
    }) as never;
    const fe = (await import("@testing-library/react")).fireEvent;
    render(<IndicatorDetail />);
    fe.click(await screen.findByTestId("forecast-explain-button"));
    await waitFor(() => {
      expect(screen.getByTestId("forecast-narrative")).toBeTruthy();
    });
    // 1-step horizon hidden — strip would be redundant with v1 badge above.
    expect(screen.queryByTestId("forecast-horizon")).toBeNull();
  });

  it("language tab click clears stale narrative (re-run signal)", async () => {
    global.fetch = detailFetchMock({ sparkline: HIGH_CONF_SPARKLINE });
    const fe = (await import("@testing-library/react")).fireEvent;
    render(<IndicatorDetail />);
    fe.click(await screen.findByTestId("forecast-explain-button"));
    await waitFor(() => {
      expect(screen.getByTestId("forecast-narrative")).toBeTruthy();
    });
    // Switch to RU — narrative card disappears (stale; user must
    // explicitly re-click Explain to fetch the RU version).
    fe.click(screen.getByTestId("forecast-lang-ru"));
    expect(screen.queryByTestId("forecast-narrative")).toBeNull();
    // Active tab visually flips.
    expect(screen.getByTestId("forecast-lang-ru").className).toContain(
      "text-[#00D4AA]",
    );
  });

  it("Explain POST sends selected language in body", async () => {
    const fetchSpy = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("forecast/explain")) {
        return new Response(
          JSON.stringify({
            indicatorValueId: "iv_test",
            narrative: "ru narrative",
            driverHypotheses: [],
            riskFactors: [],
            confidence: 0.6,
            modelName: "m",
            promptVersion: "v1",
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify(fixture({ sparkline: HIGH_CONF_SPARKLINE })),
        { status: 200 },
      );
    });
    global.fetch = fetchSpy as never;
    const fe = (await import("@testing-library/react")).fireEvent;
    render(<IndicatorDetail />);
    fe.click(await screen.findByTestId("forecast-lang-ru"));
    fe.click(screen.getByTestId("forecast-explain-button"));
    await waitFor(() => {
      expect(screen.getByTestId("forecast-narrative")).toBeTruthy();
    });
    // Find the POST call to forecast/explain.
    const postCall = fetchSpy.mock.calls.find(
      ([u, init]) =>
        String(u).includes("forecast/explain") &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse(String((postCall![1] as RequestInit).body));
    expect(body.language).toBe("ru");
  });

  it("error response renders error message", async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("forecast/explain")) {
        return new Response(
          JSON.stringify({ error: "max_tokens exceeded" }),
          { status: 502 },
        );
      }
      return new Response(
        JSON.stringify(fixture({ sparkline: HIGH_CONF_SPARKLINE })),
        { status: 200 },
      );
    }) as never;
    const fe = (await import("@testing-library/react")).fireEvent;
    render(<IndicatorDetail />);
    fe.click(await screen.findByTestId("forecast-explain-button"));
    await waitFor(() => {
      expect(screen.getByTestId("forecast-explain-error")).toBeTruthy();
    });
    expect(
      screen.getByTestId("forecast-explain-error").textContent,
    ).toContain("max_tokens");
  });

  it("button is disabled + shows 'Explaining…' during in-flight request", async () => {
    let resolveExplain!: (value: Response) => void;
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("forecast/explain")) {
        return new Promise<Response>((r) => {
          resolveExplain = r;
        });
      }
      return new Response(
        JSON.stringify(fixture({ sparkline: HIGH_CONF_SPARKLINE })),
        { status: 200 },
      );
    }) as never;
    const fe = (await import("@testing-library/react")).fireEvent;
    render(<IndicatorDetail />);
    fe.click(await screen.findByTestId("forecast-explain-button"));
    const btn = screen.getByTestId("forecast-explain-button");
    expect(btn.textContent).toBe("Explaining…");
    // Architect sub-22 💡 closure: lock disabled-while-loading
    // contract — text-only check missed the case where button stays
    // clickable mid-flight (would allow stampeding refetches).
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    // Language tabs also disabled mid-flight (UX: can't change lang
    // while a request is in-flight; would race against pending response).
    expect(
      (screen.getByTestId("forecast-lang-en") as HTMLButtonElement).disabled,
    ).toBe(true);
    // Resolve to clean up.
    resolveExplain!(
      new Response(
        JSON.stringify({
          indicatorValueId: "iv_test",
          narrative: "x",
          driverHypotheses: [],
          riskFactors: [],
          confidence: 0.5,
          modelName: "m",
          promptVersion: "v1",
        }),
        { status: 200 },
      ),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("forecast-explain-button").textContent,
      ).toBe("Re-run");
    });
  });
});
