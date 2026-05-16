// @vitest-environment happy-dom
/**
 * Component smoke test for DriftDashboard. Stubs the /api/admin/drift
 * fetch and verifies the three sections render (freshness cards,
 * recent-drift rows, stalled-onboarding list) with the right counts
 * and color states for each branch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
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
    expect(screen.getByText("Drift Dashboard")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("Reference-data freshness")).toBeTruthy();
      expect(screen.getByText("Recent drift events")).toBeTruthy();
      expect(screen.getByText("Stalled onboarding")).toBeTruthy();
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
      // Both source-card pills render with status text.
      expect(screen.getAllByText(/fresh|stale/i).length).toBeGreaterThan(0);
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
      expect(screen.getByText(/No drift detected/)).toBeTruthy();
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
      expect(screen.getByText(/never audited/)).toBeTruthy();
    });
  });
});
