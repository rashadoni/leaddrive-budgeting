// @vitest-environment happy-dom
/**
 * Component smoke test for DriftDashboard. Stubs the /api/admin/drift
 * fetch and verifies the three sections render (freshness cards,
 * recent-drift rows, stalled-onboarding list) with the right counts
 * and color states for each branch.
 *
 * 2026-05-27 — next-intl mocked since the component now uses
 * `useTranslations("adminDriftDashboard")`. Mock returns the key as
 * literal so tests assert on stable translation keys, not display
 * text (which can drift across locale edits).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (!vars) return key;
    // For interpolated keys, append var values so the test can still
    // distinguish e.g. `driftsSubtitle({n: 3})` from `driftsSubtitle({n: 0})`.
    const varStr = Object.entries(vars)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return `${key}(${varStr})`;
  },
}));

import { DriftDashboard } from "./DriftDashboard";

const mockFetchResponse = (body: unknown) =>
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });

beforeEach(() => {
  global.fetch = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DriftDashboard", () => {
  it("renders the page header + 3 section titles", async () => {
    global.fetch = mockFetchResponse({
      recentDrifts: [],
      referenceFreshness: [],
      stalePending: [],
      generatedAt: "2026-05-16T10:00:00Z",
    }) as never;
    render(<DriftDashboard />);
    expect(screen.getByText("title")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("freshnessTitle")).toBeTruthy();
      expect(screen.getByText("driftsTitle")).toBeTruthy();
      expect(screen.getByText("stalledTitle")).toBeTruthy();
    });
  });

  it("renders freshness cards with status pills (fresh/stale)", async () => {
    global.fetch = mockFetchResponse({
      recentDrifts: [],
      referenceFreshness: [
        {
          sourceCode: "weather-openmeteo",
          cadence: "daily",
          ageHours: 12,
          status: "fresh",
          metricCount: 3,
          lastFetchedAt: "2026-05-15T22:00:00Z",
          thresholds: { staleHours: 36, criticalHours: 72 },
        },
        {
          sourceCode: "worldbank-cpi",
          cadence: "monthly",
          ageHours: 1100,
          status: "stale",
          metricCount: 1,
          lastFetchedAt: "2026-03-30T00:00:00Z",
          thresholds: { staleHours: 1080, criticalHours: 1440 },
        },
      ],
      stalePending: [],
      generatedAt: "2026-05-16T10:00:00Z",
    }) as never;
    render(<DriftDashboard />);
    await waitFor(() => {
      // Source codes render as lowercase text with CSS `uppercase`
      // transform; getByText matches the literal DOM text.
      expect(screen.getByText("weather-openmeteo")).toBeTruthy();
      expect(screen.getByText("worldbank-cpi")).toBeTruthy();
      // Status pills now render the translation keys.
      expect(screen.getByText("statusFresh")).toBeTruthy();
      expect(screen.getByText("statusStale")).toBeTruthy();
    });
  });

  it("shows an actionable API-key link when EIA is not configured", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          recentDrifts: [],
          referenceFreshness: [
            {
              sourceCode: "eia-energy",
              cadence: "daily",
              ageHours: null,
              status: "missing",
              metricCount: 0,
              lastFetchedAt: null,
              thresholds: { staleHours: 36, criticalHours: 72 },
            },
          ],
          stalePending: [],
          generatedAt: "2026-05-16T10:00:00Z",
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 424,
        headers: new Headers(),
        json: async () => ({
          error: "API key is not configured for eia-energy",
          code: "api_key_missing",
          configurePath: "/budgeting/admin/api-keys",
        }),
      });
    global.fetch = fetchMock as never;

    render(<DriftDashboard />);
    const button = await screen.findByTitle("fetchTitle(code=eia-energy)");
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("apiKeyMissing(code=eia-energy)")).toBeTruthy();
      const link = screen.getByText("configureApiKey") as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("/budgeting/admin/api-keys");
    });
  });

  it("surfaces the provider error when a refresh writes zero points", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          recentDrifts: [],
          referenceFreshness: [
            {
              sourceCode: "weather-openmeteo",
              cadence: "daily",
              ageHours: 80,
              status: "critical_stale",
              metricCount: 0,
              lastFetchedAt: null,
              thresholds: { staleHours: 36, criticalHours: 72 },
            },
          ],
          stalePending: [],
          generatedAt: "2026-05-16T10:00:00Z",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          inserted: 0,
          errors: ["weather-openmeteo: upstream HTTP 503"],
          perSource: [],
        }),
      });
    global.fetch = fetchMock as never;

    render(<DriftDashboard />);
    const button = await screen.findByTitle("fetchTitle(code=weather-openmeteo)");
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("weather-openmeteo: upstream HTTP 503")).toBeTruthy();
    });
  });

  it("renders the server retry window for a rate-limited refresh", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          recentDrifts: [],
          referenceFreshness: [
            {
              sourceCode: "eia-energy",
              cadence: "daily",
              ageHours: 1,
              status: "fresh",
              metricCount: 3,
              lastFetchedAt: "2026-07-16T10:00:00Z",
              thresholds: { staleHours: 36, criticalHours: 72 },
            },
          ],
          stalePending: [],
          generatedAt: "2026-07-16T10:00:00Z",
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ "Retry-After": "42" }),
        json: async () => ({
          error: "Too many requests",
          retryAfterSec: 42,
        }),
      });
    global.fetch = fetchMock as never;

    render(<DriftDashboard />);
    const button = await screen.findByTitle("fetchTitle(code=eia-energy)");
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("retryAfter(seconds=42)")).toBeTruthy();
    });
  });

  it("shows green 'no drift' message when recentDrifts is empty", async () => {
    global.fetch = mockFetchResponse({
      recentDrifts: [],
      referenceFreshness: [],
      stalePending: [],
      generatedAt: "2026-05-16T10:00:00Z",
    }) as never;
    render(<DriftDashboard />);
    await waitFor(() => {
      expect(screen.getByText("driftsEmpty")).toBeTruthy();
    });
  });

  it("renders a drift event row with company + drift count", async () => {
    global.fetch = mockFetchResponse({
      recentDrifts: [
        {
          id: "e1",
          createdAt: "2026-05-15T08:00:00Z",
          runBy: "rashad@audit",
          company: { id: "co1", code: "AZSEKER-EDEN", name: "Eden Agro" },
          drifts: [
            {
              indicatorCode: "FP_GROSS_MARGIN",
              beforeBand: "normal",
              afterBand: "high_extreme",
              beforeValue: 30,
              afterValue: 100,
              valueDriftPct: 233,
            },
          ],
        },
      ],
      referenceFreshness: [],
      stalePending: [],
      generatedAt: "2026-05-16T10:00:00Z",
    }) as never;
    render(<DriftDashboard />);
    await waitFor(() => {
      expect(screen.getByText("AZSEKER-EDEN")).toBeTruthy();
      expect(screen.getByText(/rashad@audit/)).toBeTruthy();
      expect(screen.getByText(/FP_GROSS_MARGIN/)).toBeTruthy();
    });
  });

  it("renders stalled-onboarding list when entries exist", async () => {
    global.fetch = mockFetchResponse({
      recentDrifts: [],
      referenceFreshness: [],
      stalePending: [
        { code: "HORIZON-1", name: "Horizon Tower", level: 2, lastReconciledAt: null },
        { code: "AZSF", name: "Sugar Plant", level: 2, lastReconciledAt: "2026-04-01T00:00:00Z" },
      ],
      generatedAt: "2026-05-16T10:00:00Z",
    }) as never;
    render(<DriftDashboard />);
    await waitFor(() => {
      expect(screen.getByText("HORIZON-1")).toBeTruthy();
      expect(screen.getByText("AZSF")).toBeTruthy();
      // Translation key for the "never audited" fallback rendered by
      // the mocked next-intl.
      expect(screen.getByText("neverAudited")).toBeTruthy();
    });
  });
});
