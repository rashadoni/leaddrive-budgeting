// @vitest-environment happy-dom
/**
 * DEFECT A, end to end on the surface the user actually clicks.
 *
 * The registry-level proof lives in `use-matrix.period-switch.test.tsx`.
 * This file proves the composition: a real terminal store, a real
 * `useHeatMapModel`, real `PeriodChips`, and one real click on a quarter
 * chip. Three things have to be true in the frame right after that click,
 * and before the response for the new period lands:
 *
 *   1. the chip strip has moved to the SELECTION — Q1 is pressed, the
 *      previous selection is not;
 *   2. the year row is still whole — 2024/2025/2026 all still offered. Pre-
 *      fix the row collapsed to the single active year, because the chips
 *      were fed `data?.availableYears` and `data` is (correctly) null across
 *      the switch;
 *   3. the body says LOADING, and it does not say "no companies yet" —
 *      absence of numbers must not be rendered as absence of data.
 *
 * The store is NOT mocked here (unlike HeatMap.test.tsx): the click has to
 * travel through `setSelectedPeriod` for the test to mean anything.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  renderHook,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { HeatMap } from "./HeatMap";
import { __resetCompaniesCacheForTests } from "../hooks/use-companies";
import { __resetMatrixCacheForTests } from "../hooks/use-matrix";
import { useTerminalStore } from "../store/terminalStore";

vi.mock("@/lib/events/use-event-stream", () => ({
  useEventStream: () => {},
}));

const AVAILABLE_YEARS = [2024, 2025, 2026];

function matrixBody(period: string) {
  return {
    period,
    availableYears: AVAILABLE_YEARS,
    companies: [
      { id: "co_a", code: "AAC-MAIN", name: "AAC Main", industry: "industrial" },
    ],
    indicators: [
      {
        id: "ind_x",
        code: "IND_X",
        nameEn: "X",
        direction: "higher_better",
        unit: "%",
        industries: [],
      },
    ],
    cells: [
      {
        companyId: "co_a",
        indicatorId: "ind_x",
        value: 42,
        status: "green",
        period,
      },
    ],
  };
}

/** Resolver for the pending `?period=2026-Q1` matrix request. */
let releaseSwitch: (() => void) | null = null;

beforeEach(() => {
  __resetMatrixCacheForTests();
  __resetCompaniesCacheForTests();
  releaseSwitch = null;
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("/api/indicators/matrix")) {
      if (u.includes("period=2026-Q1")) {
        // Held open so the test can inspect the mid-switch frame — the exact
        // ~1s window measured on production.
        await new Promise<void>((resolve) => {
          releaseSwitch = resolve;
        });
        return new Response(JSON.stringify(matrixBody("2026-Q1")), {
          status: 200,
        });
      }
      return new Response(JSON.stringify(matrixBody("2026")), { status: 200 });
    }
    if (u.includes("/api/companies")) {
      return new Response(JSON.stringify({ companies: [] }), { status: 200 });
    }
    if (u.includes("/api/budgeting/period-locks")) {
      return new Response(JSON.stringify({ locks: [] }), { status: 200 });
    }
    if (u.includes("/api/organizations/settings")) {
      return new Response(JSON.stringify({ settings: {} }), { status: 200 });
    }
    if (u.includes("/api/indicators/status-summary")) {
      return new Response(
        JSON.stringify({ green: 1, amber: 0, red: 0, unknown: 0, total: 1 }),
        { status: 200 },
      );
    }
    if (u.includes("/api/admin/drift")) {
      return new Response(JSON.stringify({ sources: [] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as never;
});

afterEach(() => {
  releaseSwitch?.();
  cleanup();
  __resetMatrixCacheForTests();
  __resetCompaniesCacheForTests();
  // The store is module-global and shared with every other suite in the run.
  const { result } = renderHook(() =>
    useTerminalStore((s) => s.setSelectedPeriod),
  );
  act(() => result.current(undefined));
  cleanup();
  vi.restoreAllMocks();
});

/** Year chips are the buttons whose label is a bare 4-digit year. */
function renderedYearChips(): string[] {
  return Array.from(
    screen.getByTestId("period-chips").querySelectorAll("button"),
  )
    .map((b) => b.textContent ?? "")
    .filter((label) => /^\d{4}$/.test(label));
}

function chip(label: string): HTMLButtonElement {
  const found = Array.from(
    screen.getByTestId("period-chips").querySelectorAll("button"),
  ).find((b) => b.textContent === label);
  if (!found) throw new Error(`no period chip labelled ${label}`);
  return found as HTMLButtonElement;
}

describe("HeatMap period switch — the strip stays honest mid-flight", () => {
  it("moves the chips to the selection, keeps the year row whole, and says loading", async () => {
    render(<HeatMap />);
    // The <table> element is always mounted (it is only class-hidden while
    // loading), so a populated ROW is the only honest readiness signal.
    await waitFor(() => expect(screen.getByText("AAC-MAIN")).toBeTruthy());
    expect(renderedYearChips()).toEqual(["2024", "2025", "2026"]);
    expect(chip("2026").getAttribute("aria-pressed")).toBe("true");

    // The click. `?period=2026-Q1` is now in flight and will not answer.
    await act(async () => {
      fireEvent.click(chip("Q1"));
    });

    // 1 — the control reports what was asked for, immediately.
    expect(chip("Q1").getAttribute("aria-pressed")).toBe("true");
    expect(chip("2026").getAttribute("aria-pressed")).toBe("false");

    // 2 — and it still offers everywhere else the user could go. This is the
    //     assertion that was red before the fix: the row collapsed to
    //     ["2026"] for the length of the request.
    expect(renderedYearChips()).toEqual(["2024", "2025", "2026"]);

    // 3 — the previous period's numbers are gone (they must be: the chip now
    //     says Q1), the grid is marked loading, and nothing claims emptiness.
    expect(screen.queryByText("AAC-MAIN")).toBeNull();
    expect(screen.getByTestId("heatmap-loading")).toBeTruthy();
    //     The grid element stays mounted and is class-hidden, which is why
    //     the emptiness check has to be scoped: the table body's own "no
    //     companies match" row lives inside that hidden wrapper and is
    //     `display:none` in a browser. What matters is that nothing OUTSIDE
    //     it claims emptiness while a request is in flight.
    const hiddenGrid = screen.getByRole("table").closest("div")!;
    expect(hiddenGrid.className).toContain("hidden");
    expect(
      screen
        .queryAllByText(/no companies/i)
        .filter((el) => !hiddenGrid.contains(el)),
    ).toEqual([]);

    // And the switch completes.
    await act(async () => {
      releaseSwitch?.();
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() => expect(screen.getByText("AAC-MAIN")).toBeTruthy());
    expect(renderedYearChips()).toEqual(["2024", "2025", "2026"]);
    expect(screen.queryByTestId("heatmap-loading")).toBeNull();
  });
});
