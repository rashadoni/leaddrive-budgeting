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
  valueSource?:
    | "disclosed"
    | "modeled_industry"
    | "modeled_generic"
    | "macro"
    | "computed";
  materiality?: "material" | "low_materiality" | "not_material" | null;
  materialityNote?: string | null;
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
    // High confidence resolves to emerald in both light + dark mode
    // (was hex `text-[#00D4AA]` pre Session 9 token sweep).
    const valueSpan = section.querySelector("span.font-mono");
    expect(valueSpan?.className).toContain("text-emerald-600");
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
    // Medium-confidence resolves to amber tokens (was raw `text-[#FFB800]`
    // pre Session 9 token sweep).
    expect(valueSpan?.className).toContain("text-amber-600");
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
    // Low-confidence resolves to the muted-foreground token (was raw
    // `text-gray-400` pre Session 9 token sweep).
    expect(valueSpan?.className).toContain("text-muted-foreground");
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
    // Active tab visually flips. Was hex `text-[#00D4AA]` pre Session 9
    // token sweep — now resolves via `text-emerald-600` (light) + dark
    // mode supplement (`dark:text-emerald-400`).
    expect(screen.getByTestId("forecast-lang-ru").className).toContain(
      "text-emerald-600",
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
    // Neutral, localized fallback — never the raw provider message.
    const errText = screen.getByTestId("forecast-explain-error").textContent ?? "";
    expect(errText).not.toContain("max_tokens");
    expect(errText.length).toBeGreaterThan(0);
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

// --- Sub-40 — per-IV recompute affordance (Phase 7.E phase 2 hardening) -----

describe("IndicatorDetail per-IV recompute (sub-40)", () => {
  // The recompute button is the only UI flow that hits POST /api/indicators
  // with both companyId+indicatorCode → only path that flips withSparkline=true
  // → only path that triggers phase-2's inline computeSparkline. Lock the
  // contract so the wire-in stays reachable from UI.
  beforeEach(() => {
    // Override the file-level beforeEach with a sparkline-bearing fixture
    // so the IV detail renders the full layout (button is in the header,
    // visible regardless — but downstream sections need data).
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify(fixture({ sparkline: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21] })),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as never;
  });

  it("renders 'Recompute' button in header with user-facing title + sr-only describedby", async () => {
    // Sub-41 a11y polish — title was originally
    // "Recompute this indicator with fresh sparkline (POST /api/indicators
    //  with companyId+indicatorCode)" but the API-mechanic tail leaked
    // implementation jargon to end-users on hover. Architect 💡 from sub-40
    // → trim to user-facing only + thread aria-describedby to a sr-only
    // span so screen-reader users get the same description as the title
    // tooltip (browsers don't reliably announce title to SR).
    render(<IndicatorDetail />);
    const btn = await screen.findByRole("button", { name: /Recompute/i });
    expect(btn.getAttribute("title")).toMatch(/up-to-date sparkline/i);
    expect(btn.getAttribute("title")).not.toMatch(/POST/);
    expect(btn.getAttribute("title")).not.toMatch(/companyId/);
    // aria-describedby points at an sr-only span carrying the same text.
    expect(btn.getAttribute("aria-describedby")).toBe(
      "indicator-detail-recompute-desc",
    );
    const desc = document.getElementById("indicator-detail-recompute-desc");
    expect(desc).toBeTruthy();
    expect(desc!.className).toContain("sr-only");
    expect(desc!.textContent).toBe(btn.getAttribute("title"));
    expect(btn.hasAttribute("disabled")).toBe(false);
  });

  it("click POSTs to /api/indicators with {period, companyId, indicatorCode} (single-IV branch)", async () => {
    // The first GET /api/indicators/values/iv_test loads the detail; the
    // second call is the recompute POST. Track all calls and assert the
    // POST shape.
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";
      calls.push({
        url: u,
        method,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      if (method === "GET") {
        return new Response(
          JSON.stringify(fixture({ sparkline: [10, 11, 12] })),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // POST recompute → 200 OK
      return new Response(JSON.stringify({ processed: 1, ok: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as never;

    render(<IndicatorDetail />);
    const btn = await screen.findByRole("button", { name: /Recompute/i });
    btn.click();
    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST");
      expect(post).toBeTruthy();
    });
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/api/indicators");
    // Locks the load-bearing single-IV body shape — both companyId AND
    // indicatorCode must be present so the route's
    // `withSparkline = Boolean(companyId && indicatorCode)` resolves true.
    expect(post.body).toEqual({
      period: "2026",
      companyId: "co_test",
      indicatorCode: "IND_TEST",
    });
  });

  it("flips label Recompute → Recomputing… while pending and disables the button", async () => {
    // Never-resolving POST so the pending state is observable.
    let resolveGet: ((res: Response) => void) | undefined;
    const pendingGet = new Promise<Response>((r) => {
      resolveGet = r;
    });
    global.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") {
        return new Response(
          JSON.stringify(fixture({ sparkline: [10, 11, 12] })),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // POST never resolves → pending forever
      return pendingGet;
    }) as never;

    render(<IndicatorDetail />);
    const btn = await screen.findByRole("button", { name: /Recompute/i });
    btn.click();
    await waitFor(() => {
      const running = screen.queryByRole("button", { name: /Recomputing/i });
      expect(running).toBeTruthy();
    });
    const running = screen.getByRole("button", { name: /Recomputing/i });
    expect(running.hasAttribute("disabled")).toBe(true);
    // Clean up the dangling promise — happy-dom's gc will hold it.
    resolveGet?.(new Response("{}", { status: 200 }));
  });

  it("post-recompute success refetches the IV detail (refetchTick bump)", async () => {
    let getCount = 0;
    global.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") {
        getCount += 1;
        return new Response(
          JSON.stringify(fixture({ sparkline: [10, 11, 12] })),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ processed: 1, ok: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as never;

    render(<IndicatorDetail />);
    await waitFor(() => expect(getCount).toBe(1));
    const btn = await screen.findByRole("button", { name: /Recompute/i });
    btn.click();
    // After successful POST, the panel should re-fetch the IV — getCount
    // must climb to 2. Locks the refetchTick → useEffect dep chain.
    await waitFor(() => expect(getCount).toBe(2));
  });

  it("non-2xx POST surfaces inline error state with response text", async () => {
    global.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") {
        return new Response(
          JSON.stringify(fixture({ sparkline: [10, 11, 12] })),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // Simulate a 500 from the recompute pipeline.
      return new Response("Recompute pipeline crashed", { status: 500 });
    }) as never;

    render(<IndicatorDetail />);
    const btn = await screen.findByRole("button", { name: /Recompute/i });
    btn.click();
    await waitFor(() => {
      expect(screen.queryByRole("alert")?.textContent).toMatch(
        /Recompute pipeline crashed/,
      );
    });
    // Error label visible on the button.
    expect(screen.queryByRole("button", { name: /Failed/i })).toBeTruthy();
  });

  it("ignores second click while pending (no second POST)", async () => {
    const calls: Array<{ method?: string }> = [];
    global.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method });
      if (method === "GET") {
        return new Response(
          JSON.stringify(fixture({ sparkline: [10, 11, 12] })),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // POST hangs forever
      return new Promise<Response>(() => {});
    }) as never;

    render(<IndicatorDetail />);
    const btn = await screen.findByRole("button", { name: /Recompute/i });
    btn.click();
    await waitFor(() => {
      const running = screen.queryByRole("button", { name: /Recomputing/i });
      expect(running).toBeTruthy();
    });
    // Strip disabled to deliver the click to React's onClick (mirror of
    // HotkeyToolbar stampede-guard test).
    const running = screen.getByRole("button", { name: /Recomputing/i });
    running.removeAttribute("disabled");
    running.click();
    // Allow any pending promise resolutions to flush.
    await new Promise((r) => setTimeout(r, 0));
    const postCount = calls.filter((c) => c.method === "POST").length;
    expect(postCount).toBe(1);
  });
});

// Phase 7.H F4.v2.1 — provenance badge in Panel 3.
//
// Locks the contract that the four non-`computed` variants render a
// visible labeled badge with the right palette tone, and that
// `computed` (or absent) renders NOTHING — adding a badge to every
// real financial cell would be visual noise. The badge is the
// load-bearing answer to the original "where does this 25.2K tCO2e
// come from?" user question; if it stops rendering, the feature is
// silently broken.
describe("IndicatorDetail provenance badge (Phase 7.H F4.v2.1)", () => {
  async function renderWithSource(
    source: DetailFixture["valueSource"] | undefined,
  ) {
    global.fetch = vi.fn(async () => {
      const payload = { ...fixture({ sparkline: null }), valueSource: source };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as never;
    render(<IndicatorDetail />);
    // Wait for the panel to hydrate.
    await waitFor(() => {
      expect(screen.getByText(/Test Indicator/i)).toBeTruthy();
    });
  }

  it("modeled_generic → renders `ОБЩАЯ ОЦЕНКА` badge (or EN fallback)", async () => {
    await renderWithSource("modeled_generic");
    const badge = screen.getByTestId("provenance-badge");
    expect(badge.getAttribute("data-source")).toBe("modeled_generic");
    // Both EN ("Generic estimate") and RU ("Общая оценка") are acceptable —
    // test runs the default locale. Match either by checking the data
    // attribute (locked above) AND that the label is non-empty.
    expect(badge.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("macro → renders blue macro badge", async () => {
    await renderWithSource("macro");
    const badge = screen.getByTestId("provenance-badge");
    expect(badge.getAttribute("data-source")).toBe("macro");
  });

  it("modeled_industry → renders amber industry badge (v2.2 ready)", async () => {
    await renderWithSource("modeled_industry");
    const badge = screen.getByTestId("provenance-badge");
    expect(badge.getAttribute("data-source")).toBe("modeled_industry");
  });

  it("disclosed → renders teal disclosed badge", async () => {
    await renderWithSource("disclosed");
    const badge = screen.getByTestId("provenance-badge");
    expect(badge.getAttribute("data-source")).toBe("disclosed");
  });

  it("computed → renders NO badge (real financial cell)", async () => {
    await renderWithSource("computed");
    expect(screen.queryByTestId("provenance-badge")).toBeNull();
  });

  it("absent valueSource → renders NO badge (back-compat with legacy IVs)", async () => {
    await renderWithSource(undefined);
    expect(screen.queryByTestId("provenance-badge")).toBeNull();
  });
});

// Phase 7.H F4.v2.4 — materiality badge.
//
// Locks the contract that `low_materiality` + `not_material` render a
// visible badge, `material` (default) + null render nothing. The
// load-bearing assertion: services × Scope 1 — the canonical SASB
// "heat-map-noise" case — must show "Не материально" so the analyst
// understands the cell is intentionally de-emphasized.
describe("IndicatorDetail materiality badge (Phase 7.H F4.v2.4)", () => {
  async function renderWithMateriality(
    rating: DetailFixture["materiality"],
    note: string | null = null,
  ) {
    global.fetch = vi.fn(async () => {
      const payload = {
        ...fixture({ sparkline: null }),
        valueSource: "modeled_industry" as const,
        materiality: rating ?? null,
        materialityNote: note,
      };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as never;
    render(<IndicatorDetail />);
    await waitFor(() => {
      expect(screen.getByText(/Test Indicator/i)).toBeTruthy();
    });
  }

  it("not_material → renders NOT MATERIAL badge with calibration note in tooltip", async () => {
    await renderWithMateriality(
      "not_material",
      "Campus ops dominated by purchased electricity.",
    );
    const badge = screen.getByTestId("materiality-badge");
    expect(badge.getAttribute("data-rating")).toBe("not_material");
    expect(badge.getAttribute("title")?.toLowerCase()).toContain(
      "purchased electricity",
    );
  });

  it("low_materiality → renders LOW MATERIALITY badge", async () => {
    await renderWithMateriality("low_materiality", "Light-ops sector.");
    const badge = screen.getByTestId("materiality-badge");
    expect(badge.getAttribute("data-rating")).toBe("low_materiality");
  });

  it("material → renders NO badge (default, would be visual noise)", async () => {
    await renderWithMateriality("material");
    expect(screen.queryByTestId("materiality-badge")).toBeNull();
  });

  it("null materiality (non-ESG indicator) → renders NO badge", async () => {
    await renderWithMateriality(null);
    expect(screen.queryByTestId("materiality-badge")).toBeNull();
  });
});

