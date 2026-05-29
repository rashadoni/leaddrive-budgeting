// @vitest-environment happy-dom
/**
 * Tier-3 sub-30 — AISubscriptions behavior tests.
 *
 * Locks in:
 *  - Initial render: closed (returns null) until `terminal:open-subscriptions`.
 *  - Opens on event with role=dialog + aria-label.
 *  - Empty state when no subscriptions.
 *  - Create form: label + scope + comparator + threshold → persists +
 *    appends to list.
 *  - Pause / resume toggle persists.
 *  - Delete removes from list + persists.
 *  - Esc / backdrop / X dismiss.
 *  - Listener cleanup on unmount.
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
  waitFor,
} from "@testing-library/react";
import {
  AISubscriptions,
  evaluateSubscription,
} from "./AISubscriptions";
import { __resetMatrixCacheForTests } from "../hooks/use-matrix";
import { __resetCompaniesCacheForTests } from "../hooks/use-companies";

const STORAGE_KEY = "terminal-subscriptions-v1";

const FIXTURE_MATRIX = {
  period: "2026",
  companies: [
    {
      id: "co_aac",
      code: "AAC-MAIN",
      name: "AAC Main",
      industry: "Industrial",
    },
    {
      id: "co_atl",
      code: "ATL-DBZ",
      name: "ATL DBZ",
      industry: "Hospitality",
    },
  ],
  indicators: [
    {
      id: "ind_gross",
      code: "IND_GROSS_MARGIN",
      nameEn: "Gross Margin",
      unit: "%",
      direction: "higher_better",
    },
  ],
  cells: [
    // Force AAC composite to be very low (red — score ≈ 0)
    {
      indicatorValueId: "iv1",
      companyId: "co_aac",
      indicatorId: "ind_gross",
      value: 5,
      status: "red",
    },
    // ATL all-green (score = 100)
    {
      indicatorValueId: "iv2",
      companyId: "co_atl",
      indicatorId: "ind_gross",
      value: 50,
      status: "green",
    },
  ],
};

beforeEach(() => {
  window.localStorage.removeItem(STORAGE_KEY);
  __resetMatrixCacheForTests();
  // Phase 7.N — AISubscriptions now subscribes to useCompanies() for the
  // composite riskTag penalty; reset that module cache too. Default
  // /api/companies returns 404 below (no riskTags) so existing matcher
  // tests evaluate unpenalized composites exactly as before.
  __resetCompaniesCacheForTests();
  // Default: matrix endpoint returns the AAC=red / ATL=green fixture
  // so the matcher engine has data to evaluate against.
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes("/api/indicators/matrix")) {
      return new Response(JSON.stringify(FIXTURE_MATRIX), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as never;
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(STORAGE_KEY);
  __resetMatrixCacheForTests();
  __resetCompaniesCacheForTests();
  vi.restoreAllMocks();
});

function fireOpen(): void {
  act(() => {
    window.dispatchEvent(new Event("terminal:open-subscriptions"));
  });
}

describe("AISubscriptions (Tier-3 sub-30)", () => {
  it("renders nothing initially", () => {
    const { container } = render(<AISubscriptions />);
    expect(container.firstChild).toBeNull();
  });

  it("opens on `terminal:open-subscriptions` event with role=dialog + aria-label", () => {
    render(<AISubscriptions />);
    fireOpen();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe(
      "AI subscriptions manager",
    );
  });

  it("shows empty placeholder when no subscriptions exist", () => {
    render(<AISubscriptions />);
    fireOpen();
    expect(screen.getByTestId("subscriptions-empty")).toBeTruthy();
  });

  it("create form: label + scope + comparator + threshold → persists + appends", () => {
    render(<AISubscriptions />);
    fireOpen();
    const labelInput = screen.getByTestId(
      "subscriptions-label",
    ) as HTMLInputElement;
    fireEvent.change(labelInput, { target: { value: "AAC composite drop" } });
    const scopeSelect = screen.getByTestId(
      "subscriptions-scope",
    ) as HTMLSelectElement;
    fireEvent.change(scopeSelect, { target: { value: "company" } });
    const scopeValueInput = screen.getByTestId(
      "subscriptions-scope-value",
    ) as HTMLInputElement;
    fireEvent.change(scopeValueInput, { target: { value: "AAC-MAIN" } });
    const thresholdInput = screen.getByTestId(
      "subscriptions-threshold",
    ) as HTMLInputElement;
    fireEvent.change(thresholdInput, { target: { value: "50" } });
    fireEvent.click(screen.getByTestId("subscriptions-create-submit"));
    // List entry rendered
    expect(screen.getByText("AAC composite drop")).toBeTruthy();
    // Persisted as v:1 envelope (Round-24 Stage 3)
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const env = JSON.parse(raw!);
    expect(env.v).toBe(1);
    expect(env.data).toHaveLength(1);
    expect(env.data[0].label).toBe("AAC composite drop");
    expect(env.data[0].scope).toBe("company");
    expect(env.data[0].scopeValue).toBe("AAC-MAIN");
    expect(env.data[0].threshold).toBe(50);
    expect(env.data[0].status).toBe("active");
  });

  it("pause toggle flips status + persists", () => {
    // Pre-seed one active subscription (legacy bare-array — read path
    // accepts both shapes, write path always envelopes).
    const seed = [
      {
        id: "s1",
        label: "test sub",
        scope: "any",
        scopeValue: null,
        metric: "composite",
        comparator: "<",
        threshold: 50,
        indicatorCode: null,
        status: "active",
        lastFiredAt: null,
      },
    ];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    render(<AISubscriptions />);
    fireOpen();
    const toggle = screen.getByTestId("subscriptions-toggle-s1");
    fireEvent.click(toggle);
    // After click, write path envelopes the result.
    const env = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(env.v).toBe(1);
    expect(env.data[0].status).toBe("paused");
    // Click again → resumes
    fireEvent.click(toggle);
    const env2 = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(env2.data[0].status).toBe("active");
  });

  it("delete removes from list + persists", () => {
    const seed = [
      {
        id: "s1",
        label: "test sub",
        scope: "any",
        scopeValue: null,
        metric: "composite",
        comparator: "<",
        threshold: 50,
        indicatorCode: null,
        status: "active",
        lastFiredAt: null,
      },
    ];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    render(<AISubscriptions />);
    fireOpen();
    expect(screen.getByTestId("subscriptions-row-s1")).toBeTruthy();
    fireEvent.click(screen.getByTestId("subscriptions-delete-s1"));
    expect(screen.queryByTestId("subscriptions-row-s1")).toBeNull();
    const env = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(env.v).toBe(1);
    expect(env.data).toHaveLength(0);
  });

  it("create button disabled when label is empty/whitespace", () => {
    render(<AISubscriptions />);
    fireOpen();
    const submitBtn = screen.getByTestId(
      "subscriptions-create-submit",
    ) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
    const labelInput = screen.getByTestId(
      "subscriptions-label",
    ) as HTMLInputElement;
    fireEvent.change(labelInput, { target: { value: "   " } });
    expect(submitBtn.disabled).toBe(true);
    fireEvent.change(labelInput, { target: { value: "real label" } });
    expect(submitBtn.disabled).toBe(false);
  });

  it("scope=any disables scope-value input", () => {
    render(<AISubscriptions />);
    fireOpen();
    const scopeValueInput = screen.getByTestId(
      "subscriptions-scope-value",
    ) as HTMLInputElement;
    expect(scopeValueInput.disabled).toBe(true);
    const scopeSelect = screen.getByTestId(
      "subscriptions-scope",
    ) as HTMLSelectElement;
    fireEvent.change(scopeSelect, { target: { value: "company" } });
    expect(scopeValueInput.disabled).toBe(false);
  });

  it("Esc closes the modal", () => {
    render(<AISubscriptions />);
    fireOpen();
    expect(screen.getByRole("dialog")).toBeTruthy();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("backdrop click closes; inner click does NOT", () => {
    render(<AISubscriptions />);
    fireOpen();
    const dialog = screen.getByRole("dialog");
    const header = dialog.querySelector("header")!;
    fireEvent.click(header);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Close button (X) dismisses modal", () => {
    render(<AISubscriptions />);
    fireOpen();
    fireEvent.click(screen.getByLabelText("Close subscriptions"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("removes terminal:open-subscriptions listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<AISubscriptions />);
    unmount();
    const removed = removeSpy.mock.calls.some(
      (c) => c[0] === "terminal:open-subscriptions",
    );
    expect(removed).toBe(true);
    removeSpy.mockRestore();
  });

  // Round-24 Stage 3 fix-before-close coverage:

  it("v:1 envelope persists with versioning on write", () => {
    render(<AISubscriptions />);
    fireOpen();
    const labelInput = screen.getByTestId(
      "subscriptions-label",
    ) as HTMLInputElement;
    fireEvent.change(labelInput, { target: { value: "test sub" } });
    fireEvent.click(screen.getByTestId("subscriptions-create-submit"));
    const envelope = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(envelope.v).toBe(1);
    expect(Array.isArray(envelope.data)).toBe(true);
    expect(envelope.data).toHaveLength(1);
  });

  it("read path accepts legacy bare-array shape AND v:1 envelope", () => {
    // Legacy bare-array shape (pre-Round-24)
    const legacy = [
      {
        id: "legacy",
        label: "legacy sub",
        scope: "any",
        scopeValue: null,
        metric: "composite",
        comparator: "<",
        threshold: 50,
        indicatorCode: null,
        status: "active",
        lastFiredAt: null,
      },
    ];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    render(<AISubscriptions />);
    fireOpen();
    expect(screen.getByText("legacy sub")).toBeTruthy();
  });

  it("defensive filter rejects malformed status values", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        data: [
          {
            id: "valid",
            label: "good sub",
            scope: "any",
            scopeValue: null,
            metric: "composite",
            comparator: "<",
            threshold: 50,
            indicatorCode: null,
            status: "active",
            lastFiredAt: null,
          },
          {
            id: "bad",
            label: "broken sub",
            scope: "any",
            scopeValue: null,
            metric: "composite",
            comparator: "<",
            threshold: 50,
            indicatorCode: null,
            status: "bogus", // invalid — not "active" or "paused"
            lastFiredAt: null,
          },
        ],
      }),
    );
    render(<AISubscriptions />);
    fireOpen();
    expect(screen.getByText("good sub")).toBeTruthy();
    expect(screen.queryByText("broken sub")).toBeNull();
  });

  it("defensive filter on entirely malformed JSON gracefully returns empty", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-json{{");
    expect(() => render(<AISubscriptions />)).not.toThrow();
    fireOpen();
    expect(screen.getByTestId("subscriptions-empty")).toBeTruthy();
  });

  // Round-24 Stage 3 — matcher engine tests:

  describe("evaluateSubscription (matcher engine)", () => {
    const matrix = FIXTURE_MATRIX;
    const composites = new Map([
      ["co_aac", { score: 5, band: "red", contributingCount: 1, totalCount: 1 } as never],
      ["co_atl", { score: 100, band: "green", contributingCount: 1, totalCount: 1 } as never],
    ]);

    it("returns true when scope=any composite matches threshold", () => {
      const sub = {
        id: "s1",
        label: "any drop",
        scope: "any" as const,
        scopeValue: null,
        metric: "composite" as const,
        comparator: "<" as const,
        threshold: 50,
        indicatorCode: null,
        status: "active" as const,
        lastFiredAt: null,
      };
      // AAC composite = 5 < 50 → fire
      expect(
        evaluateSubscription(sub, composites as never, matrix as never),
      ).toBe(true);
    });

    it("returns false when no composite satisfies threshold", () => {
      const sub = {
        id: "s2",
        label: "all-low",
        scope: "any" as const,
        scopeValue: null,
        metric: "composite" as const,
        comparator: ">" as const,
        threshold: 200, // impossible — composite caps at 100
        indicatorCode: null,
        status: "active" as const,
        lastFiredAt: null,
      };
      expect(
        evaluateSubscription(sub, composites as never, matrix as never),
      ).toBe(false);
    });

    it("scope=company resolves code → composite", () => {
      const sub = {
        id: "s3",
        label: "AAC drop",
        scope: "company" as const,
        scopeValue: "AAC-MAIN",
        metric: "composite" as const,
        comparator: "<" as const,
        threshold: 50,
        indicatorCode: null,
        status: "active" as const,
        lastFiredAt: null,
      };
      expect(
        evaluateSubscription(sub, composites as never, matrix as never),
      ).toBe(true);
    });

    it("scope=company with non-existent code returns false", () => {
      const sub = {
        id: "s4",
        label: "ghost",
        scope: "company" as const,
        scopeValue: "GHOST-CO",
        metric: "composite" as const,
        comparator: "<" as const,
        threshold: 50,
        indicatorCode: null,
        status: "active" as const,
        lastFiredAt: null,
      };
      expect(
        evaluateSubscription(sub, composites as never, matrix as never),
      ).toBe(false);
    });

    it("paused subscriptions never fire", () => {
      const sub = {
        id: "s5",
        label: "paused",
        scope: "any" as const,
        scopeValue: null,
        metric: "composite" as const,
        comparator: "<" as const,
        threshold: 50,
        indicatorCode: null,
        status: "paused" as const,
        lastFiredAt: null,
      };
      expect(
        evaluateSubscription(sub, composites as never, matrix as never),
      ).toBe(false);
    });

    it("indicator-status metric returns false (v1 not implemented)", () => {
      const sub = {
        id: "s6",
        label: "indicator-status v2",
        scope: "indicator" as const,
        scopeValue: "IND_NET_MARGIN",
        metric: "indicator-status" as const,
        comparator: "==" as const,
        threshold: 0,
        indicatorCode: "IND_NET_MARGIN",
        status: "active" as const,
        lastFiredAt: null,
      };
      expect(
        evaluateSubscription(sub, composites as never, matrix as never),
      ).toBe(false);
    });

    it("each comparator works correctly", () => {
      const base = {
        id: "s",
        label: "x",
        scope: "company" as const,
        scopeValue: "AAC-MAIN",
        metric: "composite" as const,
        threshold: 5, // AAC composite = 5
        indicatorCode: null,
        status: "active" as const,
        lastFiredAt: null,
      };
      expect(
        evaluateSubscription(
          { ...base, comparator: "<" },
          composites as never,
          matrix as never,
        ),
      ).toBe(false); // 5 < 5 = false
      expect(
        evaluateSubscription(
          { ...base, comparator: "<=" },
          composites as never,
          matrix as never,
        ),
      ).toBe(true); // 5 <= 5
      expect(
        evaluateSubscription(
          { ...base, comparator: ">" },
          composites as never,
          matrix as never,
        ),
      ).toBe(false); // 5 > 5 = false
      expect(
        evaluateSubscription(
          { ...base, comparator: ">=" },
          composites as never,
          matrix as never,
        ),
      ).toBe(true); // 5 >= 5
      expect(
        evaluateSubscription(
          { ...base, comparator: "==" },
          composites as never,
          matrix as never,
        ),
      ).toBe(true); // 5 === 5
    });
  });

  it("matcher engine populates lastFiredAt on matrix change for matching subs", async () => {
    // Pre-seed an active subscription that WILL fire on the fixture
    // matrix (AAC composite < 50; threshold=99 = always-fire for any
    // green or below — hits the easy path without coupling to the
    // exact composite formula). scope=any picks up any matching co.
    const seed = [
      {
        id: "s-fire",
        label: "any-co always-fire",
        scope: "any",
        scopeValue: null,
        metric: "composite",
        comparator: "<",
        threshold: 999, // any composite value satisfies < 999
        indicatorCode: null,
        status: "active",
        lastFiredAt: null,
      },
    ];
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 1, data: seed }),
    );
    render(<AISubscriptions />);
    fireOpen();
    // Wait for matrix fetch + composites memo + matcher useEffect chain
    // to populate lastFiredAt. waitFor retries the callback until it
    // doesn't throw — using expect() inside makes it throw on null.
    await waitFor(
      () => {
        const env = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
        expect(env.data[0].lastFiredAt).not.toBeNull();
      },
      { timeout: 2000 },
    );
    const env = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(typeof env.data[0].lastFiredAt).toBe("number");
  });

  it("matcher uses the Phase 7.N riskTag-penalized composite (EDEN 100→88 fires a <90 sub)", async () => {
    // EDEN is all-green (raw composite 100) but flagged data_absence (-12) →
    // penalised 88. A "fire when EDEN composite < 90" subscription therefore
    // fires ONLY if the penalty is applied (88 < 90); the raw 100 would not
    // (100 < 90 is false). A populated lastFiredAt is the proof the matcher's
    // composite calc threads riskTags from /api/companies.
    __resetMatrixCacheForTests();
    __resetCompaniesCacheForTests();
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/api/indicators/matrix")) {
        return new Response(
          JSON.stringify({
            period: "2026",
            companies: [
              { id: "co_eden", code: "EDEN", name: "Eden", industry: "Agri" },
            ],
            indicators: [
              { id: "ind_a", code: "IND_A", nameEn: "A", unit: "%", direction: "higher_better" },
            ],
            cells: [
              { indicatorValueId: "iv1", companyId: "co_eden", indicatorId: "ind_a", value: 50, status: "green" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("/api/companies")) {
        return new Response(
          JSON.stringify([
            { id: "co_eden", code: "EDEN", name: "Eden", settings: { riskTags: ["data_absence"] } },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as never;
    const seed = [
      {
        id: "s-eden",
        label: "EDEN penalised drop",
        scope: "company",
        scopeValue: "EDEN",
        metric: "composite",
        comparator: "<",
        threshold: 90,
        indicatorCode: null,
        status: "active",
        lastFiredAt: null,
      },
    ];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, data: seed }));
    render(<AISubscriptions />);
    fireOpen();
    await waitFor(
      () => {
        const env = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
        expect(env.data[0].lastFiredAt).not.toBeNull();
      },
      { timeout: 5000 },
    );
    const env = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(typeof env.data[0].lastFiredAt).toBe("number");
  });
});
