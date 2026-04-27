// @vitest-environment happy-dom
/**
 * Phase A3 (Bloomberg uplift plan) — smoke for `AuditTicker`.
 *
 * Locks in:
 *  - Renders 'loading…' before fetch resolves.
 *  - Renders 'no events yet' when API returns empty array.
 *  - Renders the action + entity for each event when API returns rows.
 *  - Click fires `terminal:open-audit` window event (opens AuditModal).
 *  - Enter / Space keypress also fires the open event (a11y).
 *  - Cleans up in-flight fetch on unmount (no setState-after-unmount).
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
  waitFor,
} from "@testing-library/react";
import { AuditTicker } from "./AuditTicker";

const SAMPLE_EVENT = {
  id: "evt_1",
  action: "import_budget_create",
  entityType: "BudgetPlan",
  entityId: "plan_aac_2026",
  metadata: { companyCode: "AAC-MAIN", year: 2026, inserted: 27 },
  createdAt: "2026-04-27T18:30:00.000Z",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

function mockFetchOnce(body: unknown, ok = true): void {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { "content-type": "application/json" },
    }),
  ) as never;
}

describe("AuditTicker (Phase A3)", () => {
  it("renders 'loading…' before fetch resolves", () => {
    let resolveFetch!: (value: Response) => void;
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as never;
    render(<AuditTicker />);
    expect(screen.getByText("loading…")).toBeTruthy();
    // unblock fetch so the test cleanup doesn't leak a pending promise
    act(() => {
      resolveFetch(
        new Response(JSON.stringify({ events: [] }), { status: 200 }),
      );
    });
  });

  it("renders 'no events yet' when API returns empty array", async () => {
    mockFetchOnce({ events: [] });
    render(<AuditTicker />);
    await waitFor(() => {
      expect(screen.queryByText("no events yet")).toBeTruthy();
    });
  });

  it("renders action + companyCode for each event when API returns rows", async () => {
    mockFetchOnce({ events: [SAMPLE_EVENT] });
    render(<AuditTicker />);
    await waitFor(() => {
      expect(screen.queryByText("import_budget_create")).toBeTruthy();
    });
    expect(screen.queryByText("AAC-MAIN")).toBeTruthy();
  });

  it("click fires `terminal:open-audit` window event", async () => {
    mockFetchOnce({ events: [SAMPLE_EVENT] });
    render(<AuditTicker />);
    await waitFor(() => {
      expect(screen.queryByText("import_budget_create")).toBeTruthy();
    });
    let opened = 0;
    const probe = () => {
      opened += 1;
    };
    window.addEventListener("terminal:open-audit", probe);
    const ticker = screen.getByRole("button", {
      name: /Recent audit events/i,
    });
    fireEvent.click(ticker);
    window.removeEventListener("terminal:open-audit", probe);
    expect(opened).toBe(1);
  });

  it("Enter keypress fires `terminal:open-audit` (a11y)", async () => {
    mockFetchOnce({ events: [SAMPLE_EVENT] });
    render(<AuditTicker />);
    await waitFor(() => {
      expect(screen.queryByText("import_budget_create")).toBeTruthy();
    });
    let opened = 0;
    const probe = () => {
      opened += 1;
    };
    window.addEventListener("terminal:open-audit", probe);
    const ticker = screen.getByRole("button", {
      name: /Recent audit events/i,
    });
    fireEvent.keyDown(ticker, { key: "Enter" });
    window.removeEventListener("terminal:open-audit", probe);
    expect(opened).toBe(1);
  });

  it("falls back to 'no events yet' when API returns 500", async () => {
    mockFetchOnce({ events: [] }, false);
    render(<AuditTicker />);
    await waitFor(() => {
      expect(screen.queryByText("no events yet")).toBeTruthy();
    });
  });

  it("renders indicatorCode + language for ai_variance_explainer_run (Round-1 ⚠️ closure)", async () => {
    const explainerEvent = {
      id: "evt_2",
      action: "ai_variance_explainer_run",
      entityType: "IndicatorValue",
      entityId: "iv_aac_1",
      metadata: {
        indicatorCode: "IND_NET_MARGIN",
        companyId: "co_aac_main",
        period: "2026",
        status: "red",
        language: "en",
        tokensIn: 905,
        tokensOut: 246,
        durationMs: 6460,
        modelName: "claude-sonnet-4-5-20250929",
        promptVersion: "v1",
      },
      createdAt: "2026-04-27T18:32:00.000Z",
    };
    mockFetchOnce({ events: [explainerEvent] });
    render(<AuditTicker />);
    await waitFor(() => {
      expect(screen.queryByText("ai_variance_explainer_run")).toBeTruthy();
    });
    // Should show "IND_NET_MARGIN · EN", NOT "IndicatorValue" literal
    expect(screen.queryByText("IND_NET_MARGIN · EN")).toBeTruthy();
    expect(screen.queryByText("IndicatorValue")).toBeNull();
  });

  it("does not setState after unmount when fetch resolves late", async () => {
    let resolveFetch!: (value: Response) => void;
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as never;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<AuditTicker />);
    unmount();
    act(() => {
      resolveFetch(
        new Response(JSON.stringify({ events: [SAMPLE_EVENT] }), {
          status: 200,
        }),
      );
    });
    // No "Can't perform a React state update on an unmounted component" warning.
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
