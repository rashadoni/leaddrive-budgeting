// @vitest-environment happy-dom
/**
 * Sub-27 cont'd Round-9 — locks the VarianceExplainerPanel contract:
 *
 *  - No `activeIndicatorValueId` AND no `activeCompanyCode` → static
 *    "Pick a HeatMap cell" hint (no fetch, no spinner).
 *  - `activeIndicatorValueId` set, no `data` yet → "Click Explain →"
 *    hint with "Run for EN" CTA button. NO LLM call fired automatically
 *    (cost guard).
 *  - Clicking "Run for EN" → POSTs /api/indicators/values/[id]/explain
 *    with { language: "en" } body.
 *  - Successful response → narrative + recommendations + topDrivers
 *    rendered in their respective sections.
 *  - Error response → error block rendered.
 *  - Re-run button forces a fresh fetch (bypasses in-memory cache).
 *  - `terminal:run-explainer` event fires `run()` with detail.id.
 *  - Language switcher (EN/RU/AZ) is interactive but does NOT trigger
 *    a fetch on its own — re-run is required.
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
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import { VarianceExplainerPanel } from "./VarianceExplainerPanel";

// Mock CompanySnapshot (large 3-card P&L block) so we can assert on
// VarianceExplainerPanel logic in isolation.
vi.mock("./CompanySnapshot", () => ({
  CompanySnapshot: ({ companyCode }: { companyCode: string }) => (
    <div data-testid="company-snapshot-mock">snapshot:{companyCode}</div>
  ),
}));

// Mock the store: each test sets the desired (ivId, code) pair.
let mockState: {
  activeIndicatorValueId: string | null;
  activeCompanyCode: string | null;
} = {
  activeIndicatorValueId: null,
  activeCompanyCode: null,
};

vi.mock("../store/terminalStore", () => ({
  useTerminalStore: <T,>(
    selector: (s: typeof mockState) => T,
  ) => selector(mockState),
}));

beforeEach(() => {
  mockState = {
    activeIndicatorValueId: null,
    activeCompanyCode: null,
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockExplainResponse(payload: Record<string, unknown> = {}, status = 200) {
  global.fetch = vi.fn(async () =>
    new Response(
      JSON.stringify({
        indicatorValueId: "iv1",
        narrative: "Margins compressed 8 pts due to feed-cost spike.",
        recommendations: [
          "Lock Q3 corn forward at +4% premium",
          "Diversify to two suppliers",
          "Pass-through 3% to wholesale price",
        ],
        confidence: 0.78,
        topDrivers: ["FEED_COST", "FX_USD_AZN"],
        usage: { inputTokens: 1234, outputTokens: 567 },
        ...payload,
      }),
      { status, headers: { "content-type": "application/json" } },
    ),
  ) as never;
}

describe("VarianceExplainerPanel (Phase 7.D)", () => {
  it("renders the static pick-a-cell hint when no IV id and no active company", () => {
    render(<VarianceExplainerPanel />);
    // Component returns the hint text inline; we lock that the absence of
    // a CompanySnapshot mock + absence of "Asking the model…" + absence of
    // "Narrative" header is the empty state.
    expect(screen.queryByTestId("company-snapshot-mock")).toBeNull();
    // No fetch fired.
    const fetchSpy = global.fetch as unknown as { mock?: { calls: unknown[][] } };
    expect(fetchSpy?.mock?.calls?.length ?? 0).toBe(0);
  });

  it("renders CompanySnapshot when an active company is set but no IV", () => {
    mockState = {
      activeIndicatorValueId: null,
      activeCompanyCode: "AAC-MAIN",
    };
    render(<VarianceExplainerPanel />);
    const snap = screen.getByTestId("company-snapshot-mock");
    expect(snap.textContent).toBe("snapshot:AAC-MAIN");
  });

  it("with IV but no data yet, shows Run-for-<LANG> CTA without firing fetch", () => {
    mockExplainResponse(); // would resolve if anyone called it
    mockState = {
      activeIndicatorValueId: "iv1",
      activeCompanyCode: null,
    };
    render(<VarianceExplainerPanel />);
    // Cost guard: no LLM call until user clicks.
    expect(global.fetch as unknown as { mock?: { calls: unknown[][] } })
      .toBeTruthy();
    // The Run for <lang> button is rendered.
    const runBtn = screen.getByRole("button", { name: "EN" });
    expect(runBtn).toBeTruthy();
  });

  it("clicking Run-for-EN POSTs to /api/indicators/values/[id]/explain", async () => {
    mockExplainResponse();
    mockState = {
      activeIndicatorValueId: "iv1",
      activeCompanyCode: null,
    };
    render(<VarianceExplainerPanel />);
    const runBtn = screen.getByRole("button", { name: "EN" });
    fireEvent.click(runBtn);
    // Allow fetch microtasks + setState to flush.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const fetchMock = global.fetch as unknown as {
      mock: { calls: Array<[string, RequestInit]> };
    };
    expect(fetchMock.mock.calls.length).toBe(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/indicators/values/iv1/explain");
    expect(init.method).toBe("POST");
    expect(init.body).toContain('"language":"en"');
  });

  it("renders narrative + recommendations + topDrivers after successful run", async () => {
    mockExplainResponse();
    mockState = {
      activeIndicatorValueId: "iv1",
      activeCompanyCode: null,
    };
    render(<VarianceExplainerPanel />);
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(/feed-cost spike/)).toBeTruthy();
    expect(screen.getByText(/Lock Q3 corn forward/)).toBeTruthy();
    expect(screen.getByText(/Diversify to two suppliers/)).toBeTruthy();
    expect(screen.getByText(/Pass-through 3% to wholesale/)).toBeTruthy();
    expect(screen.getByText("FEED_COST")).toBeTruthy();
    expect(screen.getByText("FX_USD_AZN")).toBeTruthy();
  });

  it("renders error block on non-OK fetch response", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Rate limited" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    ) as never;
    mockState = {
      activeIndicatorValueId: "iv1",
      activeCompanyCode: null,
    };
    render(<VarianceExplainerPanel />);
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Rate limited")).toBeTruthy();
  });

  it("Re-run button bypasses in-memory cache (forces fresh fetch)", async () => {
    mockExplainResponse();
    mockState = {
      activeIndicatorValueId: "iv1",
      activeCompanyCode: null,
    };
    render(<VarianceExplainerPanel />);
    // First run.
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const fetchMock = global.fetch as unknown as {
      mock: { calls: Array<[string, RequestInit]> };
    };
    expect(fetchMock.mock.calls.length).toBe(1);

    // Now Re-run — find the Re-run button (last button in the header).
    // After first run renders narrative + Re-run, click that.
    const reRunBtn = screen
      .getAllByRole("button")
      .find((b) => /re-run/i.test(b.textContent || "") || b.title?.match(/cache/i));
    expect(reRunBtn).toBeTruthy();
    fireEvent.click(reRunBtn!);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it("`terminal:run-explainer` event triggers run with detail.id", async () => {
    mockExplainResponse();
    mockState = {
      activeIndicatorValueId: "iv1",
      activeCompanyCode: null,
    };
    render(<VarianceExplainerPanel />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("terminal:run-explainer", {
          detail: { id: "iv1", language: "ru" },
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const fetchMock = global.fetch as unknown as {
      mock: { calls: Array<[string, RequestInit]> };
    };
    expect(fetchMock.mock.calls.length).toBe(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/indicators/values/iv1/explain");
    expect(init.body).toContain('"language":"ru"');
  });

  it("language switcher is interactive but does NOT fire fetch on its own", async () => {
    mockExplainResponse();
    mockState = {
      activeIndicatorValueId: "iv1",
      activeCompanyCode: null,
    };
    render(<VarianceExplainerPanel />);
    // First trigger a run so the panel transitions to data state with the
    // language radiogroup visible.
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const fetchMock = global.fetch as unknown as {
      mock: { calls: Array<[string, RequestInit]> };
    };
    expect(fetchMock.mock.calls.length).toBe(1);

    // Find the RU radio button + click it.
    const ruRadio = screen.getByRole("radio", { name: /^RU$/i });
    fireEvent.click(ruRadio);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // No additional fetch from the language switch alone — cost guard.
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it("removes terminal:run-explainer listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<VarianceExplainerPanel />);
    unmount();
    const removed = removeSpy.mock.calls.some(
      (c) => c[0] === "terminal:run-explainer",
    );
    expect(removed).toBe(true);
    removeSpy.mockRestore();
  });

  // ─── Sub-44 cont'd architectural-debt closure (Round-33 architect ⚠️) ──
  // DOM-assertion lock for the centered-empty-state Tailwind classes on
  // VarianceExplainerPanel's 2 placeholder branches. Without these, a
  // future Tailwind purge or refactor that strips `items-center
  // justify-center` would silently regress the UX with no failing test.
  // Architect noted the same complaint TWICE (Round-32 + Round-33) — this
  // is the regression lock.

  describe("empty-state DOM-class invariants (Round-33 ⚠️ closure)", () => {
    function expectCenteredClasses(el: HTMLElement): void {
      const className = el.className;
      expect(className, `expected items-center on ${el.dataset.testid}`).toMatch(/\bitems-center\b/);
      expect(className, `expected justify-center on ${el.dataset.testid}`).toMatch(/\bjustify-center\b/);
      expect(className, `expected flex on ${el.dataset.testid}`).toMatch(/\bflex\b/);
      expect(className, `expected flex-col on ${el.dataset.testid}`).toMatch(/\bflex-col\b/);
      // Height + width MUST reach 100% so centering operates against the
      // full panel slot, not just the content box.
      expect(className, `expected h-full on ${el.dataset.testid}`).toMatch(/\bh-full\b/);
      expect(className, `expected w-full on ${el.dataset.testid}`).toMatch(/\bw-full\b/);
    }

    it("no IV + no active company empty branch — testid + centered classes", () => {
      // Default beforeEach sets both state fields to null — exercises the
      // pick-a-cell empty branch.
      render(<VarianceExplainerPanel />);
      const el = screen.getByTestId("variance-explainer-empty");
      expectCenteredClasses(el);
    });

    it("active IV but no data yet branch — testid + centered classes", () => {
      // Suppress the explain fetch (test focuses on initial-render shape,
      // not async narrative arrival).
      mockExplainResponse();
      mockState = {
        activeIndicatorValueId: "iv1",
        activeCompanyCode: null,
      };
      render(<VarianceExplainerPanel />);
      const el = screen.getByTestId("variance-explainer-no-data");
      expectCenteredClasses(el);
    });
  });
});
