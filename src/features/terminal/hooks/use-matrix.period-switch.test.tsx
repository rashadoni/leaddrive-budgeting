// @vitest-environment happy-dom
/**
 * DEFECT A — a period switch must give honest feedback.
 *
 * The decision this file encodes: **the period control follows the
 * SELECTION, not the loaded payload.** A control and a display answer
 * different questions — the chips answer "what did you ask for", the grid
 * answers "what do I have". Making the chips answer the grid's question
 * turns a click into a second of silence, which reads as "the click missed";
 * making the grid answer the control's question would put "2026-Q1" over
 * annual numbers, which is a false statement about data and therefore worse.
 *
 * The way out is not to pick a lie. It is that the second one has to be
 * IMPOSSIBLE, and the registry is what makes it so: the cache key contains
 * the period, so the instant `selectedPeriod` changes the hook is reading a
 * different entry, whose snapshot either has nothing or has a payload for
 * exactly that period. Chips-follow-selection is safe only as a consequence
 * of key-scoped data — which is why the first test here pins that
 * consequence rather than assuming it.
 *
 * What is left once the numbers are correctly dropped is the failure mode
 * the previous attempt was rejected for: with the numbers gone the surface
 * must say LOADING, not NOTHING. That has to cover the navigation controls
 * too, and there it was still broken —
 *
 *   HeatMap.tsx:352 feeds the year chips `data?.availableYears`, so at the
 *   exact moment the payload is dropped the year row collapses from N chips
 *   to one (`PeriodChips.tsx:74`). Click 2026-Q1 and the 2024/2025 chips
 *   vanish for the length of the request. `availableYears` is org-scoped and
 *   period-INVARIANT — `route.ts:93-107` derives it from every distinct
 *   `IndicatorValue.period` in the org and never looks at `?period=` — so a
 *   period switch has no reason to un-know it.
 *
 * — and the stale error the brief describes, which the registry made
 * per-key but did not actually clear: an errored entry nobody watches used
 * to stay warm, so re-selecting that period replayed the old failure text
 * with no request and no way to retry.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { useMatrix, __resetMatrixCacheForTests } from "./use-matrix";
import { useTerminalStore } from "../store/terminalStore";

const YEARS = [2024, 2025, 2026];

function payload(period: string, cells: number, availableYears = YEARS) {
  return {
    period,
    availableYears,
    companies: [
      { id: "co_a", code: "AAC-MAIN", name: "AAC Main", industry: "Industrial" },
    ],
    indicators: [
      {
        id: "ind_x",
        code: "IND_X",
        nameEn: "X",
        direction: "higher_better",
        unit: "%",
      },
    ],
    cells: Array.from({ length: cells }, (_, i) => ({
      companyId: "co_a",
      indicatorId: `ind_${i}`,
      value: i,
      status: "amber",
    })),
  };
}

function matrixCalls(spy: ReturnType<typeof vi.fn>): string[] {
  return spy.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/api/indicators/matrix"));
}

beforeEach(() => {
  __resetMatrixCacheForTests();
});

afterEach(() => {
  cleanup();
  __resetMatrixCacheForTests();
  vi.restoreAllMocks();
});

describe("period switch — the numbers may never lag the selection", () => {
  it("drops the previous period's payload in the SAME frame as the switch", async () => {
    // The structural guarantee chips-follow-selection rests on. If this ever
    // goes red, "the chips show the selection" instantly becomes a lie about
    // the grid rather than a truthful statement about the request.
    global.fetch = vi.fn(async (url: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(url).includes("2026-Q1")
            ? payload("2026-Q1", 7)
            : payload("2026", 3),
        ),
        { status: 200 },
      ),
    ) as never;

    const { result, rerender } = renderHook(
      ({ p }: { p: string }) => useMatrix(p),
      { initialProps: { p: "2026" } },
    );
    await waitFor(() => expect(result.current.matrix?.period).toBe("2026"));

    rerender({ p: "2026-Q1" });

    // No await: this is the first render after the switch.
    expect(result.current.matrix).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    await waitFor(() => expect(result.current.matrix?.period).toBe("2026-Q1"));
    expect(result.current.matrix!.cells).toHaveLength(7);
  });

  it("a failure on one period is never shown as the state of another", async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("2026-Q1")
        ? new Response("boom", { status: 500 })
        : new Response(JSON.stringify(payload("2026", 3)), { status: 200 }),
    ) as never;

    const { result, rerender } = renderHook(
      ({ p }: { p: string }) => useMatrix(p),
      { initialProps: { p: "2026-Q1" } },
    );
    await waitFor(() => expect(result.current.error).toContain("500"));

    rerender({ p: "2026" });
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.matrix?.period).toBe("2026"));
    expect(result.current.error).toBeNull();
  });
});

describe("period switch — the navigation controls may not blink", () => {
  it("keeps availableYears across the switch instead of collapsing the year row", async () => {
    // Pre-fix this returned `undefined` for the length of the request and
    // PeriodChips fell back to the single active-year chip
    // (PeriodChips.test.tsx:53 locks that fallback), so clicking Q1 made the
    // 2024 and 2025 chips disappear — a fabricated absence in the control
    // strip itself.
    global.fetch = vi.fn(async (url: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(url).includes("2026-Q1")
            ? payload("2026-Q1", 7)
            : payload("2026", 3),
        ),
        { status: 200 },
      ),
    ) as never;

    const { result, rerender } = renderHook(
      ({ p }: { p: string }) => useMatrix(p),
      { initialProps: { p: "2026" } },
    );
    await waitFor(() => expect(result.current.matrix?.period).toBe("2026"));
    expect(result.current.availableYears).toEqual(YEARS);

    rerender({ p: "2026-Q1" });

    expect(result.current.matrix).toBeNull(); // numbers gone, as they must be
    expect(result.current.loading).toBe(true);
    expect(result.current.availableYears).toEqual(YEARS); // navigation kept

    await waitFor(() => expect(result.current.matrix?.period).toBe("2026-Q1"));
    expect(result.current.availableYears).toEqual(YEARS);
  });

  it("does NOT invent a year list before one has ever arrived", async () => {
    // Indeterminate means do nothing. A guard — or a control — must never
    // fire on metadata it has not been given.
    global.fetch = vi.fn(
      () => new Promise<Response>(() => {}), // never settles
    ) as never;

    const { result } = renderHook(() => useMatrix("2026"));
    expect(result.current.loading).toBe(true);
    expect(result.current.availableYears).toBeUndefined();
  });

  it("does not retain a year list a payload never carried", async () => {
    // Older/cached payloads omit `availableYears` (the field is optional for
    // exactly that reason — use-matrix.ts:165). Absence must stay absence.
    global.fetch = vi.fn(async () => {
      const body = payload("2026", 3) as Record<string, unknown>;
      delete body.availableYears;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as never;

    const { result } = renderHook(() => useMatrix("2026"));
    await waitFor(() => expect(result.current.matrix?.period).toBe("2026"));
    expect(result.current.availableYears).toBeUndefined();
  });
});

describe("period switch — the consumers with no explicit period", () => {
  it("CompanyTree's useMatrix(undefined, showPending) re-scopes with the store and keeps the year row", async () => {
    // `CompanyTree.tsx:84` passes NO period and its own `showPending`, so it
    // rides the store-selected period on a variant key. A period switch has
    // to move it in lockstep with the HeatMap's explicit-period call — and
    // must not leave it holding the previous period's companies, which is
    // what feeds its composite badges. The previous attempt at this defect
    // never mentioned this consumer at all.
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      const period = u.includes("2026-Q1") ? "2026-Q1" : "2026";
      return new Response(
        JSON.stringify(
          payload(period, u.includes("includePending=true") ? 2 : 1),
        ),
        { status: 200 },
      );
    });
    global.fetch = fetchSpy as never;

    const { result: setter } = renderHook(() =>
      useTerminalStore((s) => s.setSelectedPeriod),
    );
    act(() => setter.current("2026"));
    try {
      const { result: tree } = renderHook(() => useMatrix(undefined, true));
      const { result: grid } = renderHook(() => useMatrix("2026"));
      await waitFor(() => {
        expect(tree.current.matrix?.period).toBe("2026");
        expect(grid.current.matrix?.period).toBe("2026");
      });
      expect(matrixCalls(fetchSpy)).toHaveLength(2); // one per variant

      act(() => setter.current("2026-Q1"));

      // Both moved, neither is holding 2026's rows any more.
      expect(tree.current.matrix).toBeNull();
      expect(tree.current.loading).toBe(true);
      expect(tree.current.availableYears).toEqual(YEARS);

      await waitFor(() =>
        expect(tree.current.matrix?.period).toBe("2026-Q1"),
      );
      expect(tree.current.matrix!.cells).toHaveLength(2); // still the pending variant
    } finally {
      act(() => setter.current(undefined));
    }
  });
});

describe("period switch — a revalidation is not a period switch", () => {
  it("a refresh over existing data keeps loading FALSE and the numbers on screen", async () => {
    // The distinction the whole design rests on, pinned so a future pass
    // cannot re-blank the grid on every SSE recompute: dropping the payload
    // is correct when the PERIOD changed and wrong when it did not. Consumers
    // must reach for `revalidating`, not for `loading`, to describe this.
    // The second response is HELD OPEN — with an instantly-resolving mock the
    // revalidating window is shorter than a `waitFor` poll and the assertion
    // would be a coin flip rather than a guarantee.
    let release: ((r: Response) => void) | null = null;
    let first = true;
    const fetchSpy = vi.fn(() => {
      if (first) {
        first = false;
        return Promise.resolve(
          new Response(JSON.stringify(payload("2026", 1)), { status: 200 }),
        );
      }
      return new Promise<Response>((r) => {
        release = r;
      });
    });
    global.fetch = fetchSpy as never;

    const { result } = renderHook(() => useMatrix("2026"));
    await waitFor(() => expect(result.current.matrix?.cells).toHaveLength(1));

    let settled!: Promise<void>;
    act(() => {
      settled = result.current.refresh();
    });
    await waitFor(() => expect(result.current.revalidating).toBe(true));
    expect(result.current.loading).toBe(false);
    expect(result.current.matrix!.cells).toHaveLength(1); // still readable
    expect(result.current.matrix!.period).toBe("2026"); // and still true

    await act(async () => {
      release!(
        new Response(JSON.stringify(payload("2026", 2)), { status: 200 }),
      );
      await settled;
    });
    await waitFor(() => expect(result.current.matrix?.cells).toHaveLength(2));
    expect(result.current.revalidating).toBe(false);
  });
});

describe("period switch — a failure is not a cache entry", () => {
  it("re-requests a period whose fetch failed when it is selected again", async () => {
    // The brief's "a stale error from a failed period was never cleared",
    // in the form the registry left behind: the error stopped bleeding into
    // OTHER periods, but re-selecting the failed one replayed the old text
    // with no request. The terminal has no retry button — re-selecting the
    // period IS the retry, and it has to reach the network.
    let failQ1 = true;
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("2026-Q1")) {
        return failQ1
          ? new Response("boom", { status: 500 })
          : new Response(JSON.stringify(payload("2026-Q1", 7)), { status: 200 });
      }
      return new Response(JSON.stringify(payload("2026", 3)), { status: 200 });
    });
    global.fetch = fetchSpy as never;

    const { result, rerender } = renderHook(
      ({ p }: { p: string }) => useMatrix(p),
      { initialProps: { p: "2026-Q1" } },
    );
    await waitFor(() => expect(result.current.error).toContain("500"));
    expect(matrixCalls(fetchSpy)).toHaveLength(1);

    // Leave the failed period — nobody is watching it any more.
    rerender({ p: "2026" });
    await waitFor(() => expect(result.current.matrix?.period).toBe("2026"));
    expect(matrixCalls(fetchSpy)).toHaveLength(2);

    // Come back. The server has recovered; the user must be able to find out.
    failQ1 = false;
    rerender({ p: "2026-Q1" });
    await waitFor(() => expect(result.current.matrix?.period).toBe("2026-Q1"));
    expect(matrixCalls(fetchSpy)).toHaveLength(3);
    expect(result.current.error).toBeNull();
  });

  it("STILL sticky while someone is watching: a second consumer joins the failure, no re-hammer", async () => {
    // The guarantee `use-matrix.test.tsx:195` encodes, restated precisely:
    // stickiness is about consumers arriving at a key that is CURRENTLY
    // failing, not about a period the user left and came back to. Dropping
    // an unwatched failure must not weaken it.
    const fetchSpy = vi.fn(async () => new Response("boom", { status: 500 }));
    global.fetch = fetchSpy as never;

    const { result: a } = renderHook(() => useMatrix("2026"));
    await waitFor(() => expect(a.current.error).toContain("500"));
    expect(matrixCalls(fetchSpy)).toHaveLength(1);

    const { result: b } = renderHook(() => useMatrix("2026")); // a still mounted
    await waitFor(() => expect(b.current.loading).toBe(false));
    expect(b.current.error).toContain("500");
    expect(matrixCalls(fetchSpy)).toHaveLength(1); // no retry
  });

  it("keeps a warm payload when the failure is a failed REVALIDATION over it", async () => {
    // An entry can hold data AND an error (a revalidation that failed leaves
    // the numbers on screen — startFetch's error branch does not clear
    // `data`). That entry is still worth keeping: the numbers in it are true.
    let ok = true;
    const fetchSpy = vi.fn(async () =>
      ok
        ? new Response(JSON.stringify(payload("2026", 3)), { status: 200 })
        : new Response("boom", { status: 500 }),
    );
    global.fetch = fetchSpy as never;

    const view = render(<Probe period="2026" />);
    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toContain("2026:3"),
    );
    ok = false;
    await act(async () => {
      await refreshFromProbe();
    });
    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toContain("err"),
    );
    view.unmount();

    // Remount: the payload survived, so no round-trip is spent re-fetching it.
    const before = matrixCalls(fetchSpy).length;
    render(<Probe period="2026" />);
    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toContain("2026:3"),
    );
    expect(matrixCalls(fetchSpy)).toHaveLength(before);
  });
});

/** Minimal mounted subscriber that also hands `refresh()` back to the test. */
let probeRefresh: (() => Promise<void>) | null = null;
function Probe({ period }: { period: string }) {
  const { matrix, error, loading, refresh } = useMatrix(period);
  probeRefresh = refresh;
  return (
    <div data-testid="probe">
      {matrix
        ? `${matrix.period}:${matrix.cells.length}`
        : loading
          ? "loading"
          : "idle"}
      {error ? " err" : ""}
    </div>
  );
}
function refreshFromProbe(): Promise<void> {
  if (!probeRefresh) throw new Error("Probe is not mounted");
  return probeRefresh();
}
