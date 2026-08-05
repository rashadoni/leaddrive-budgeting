// @vitest-environment happy-dom
/**
 * 2026-08-05 — useMatrix subscriber registry.
 *
 * Companion to `use-matrix.test.tsx` (which locks the public contract).
 * This file locks the CACHE BEHAVIOUR that contract sits on, and every
 * assertion here failed against the pre-registry implementation:
 *
 *  defect B  — one payload per key shared by every mounted subscriber;
 *              an invalidation reaches ALL of them, not just the caller;
 *              a key nobody watches is dropped instead of served forever.
 *  the storm — `indicator_values_notify_trg` is FOR EACH ROW, so one
 *              recompute delivers one SSE event per IndicatorValue and
 *              `CompanySnapshot` calls `refresh()` for each with no
 *              debounce. 221 calls must cost ONE request.
 *
 * Plus the five guarantees the rewrite was not allowed to break:
 *  1. `enabled: false` mounts issue ZERO requests (mobile cost guarantee,
 *     asserted end-to-end in TerminalOverlayHost.runtime.test.tsx).
 *  2. a no-arg `useMatrix()` follows the store-selected period — it does
 *     NOT join a `__default__` key.
 *  3. `useMatrix(undefined, showPending)` (CompanyTree.tsx:84) shares the
 *     cache and keys on the pending variant.
 *  4. `getMatrixSync()` is synchronous and NEVER fetches (ScenarioPanel).
 *  5. `__resetMatrixCacheForTests()` still clears everything.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  useMatrix,
  ensureMatrix,
  getMatrixSync,
  invalidateMatrix,
  __resetMatrixCacheForTests,
} from "./use-matrix";
import { useTerminalStore } from "../store/terminalStore";

/** Matrix payload with `n` cells — cell count is the version marker. */
function payload(period: string, n: number) {
  return {
    period,
    companies: [
      { id: "co_a", code: "AAC-MAIN", name: "AAC Main", industry: "Industrial" },
    ],
    indicators: [
      { id: "ind_x", code: "IND_X", nameEn: "X", direction: "higher_better", unit: "%" },
    ],
    cells: Array.from({ length: n }, (_, i) => ({
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

/**
 * One subscriber. Renders `period:cellCount` so every mount is inspectable,
 * and exposes THIS subscriber's `refresh()` behind a click — the shape
 * `CompanySnapshot` uses when the SSE handler fires.
 */
function Probe({
  id,
  period,
  includePending = false,
  enabled = true,
  onRefresh,
}: {
  id: string;
  period?: string;
  includePending?: boolean;
  enabled?: boolean;
  /** Receives the promise `refresh()` returns, so a test can await the
   *  coalesced refetch rather than sleep for it. */
  onRefresh?: (settled: Promise<void>) => void;
}) {
  const { matrix, loading, error, refresh } = useMatrix(period, includePending, {
    enabled,
  });
  return (
    <>
      <div data-testid={id}>
        {error
          ? `error:${error}`
          : matrix
            ? `${matrix.period}:${matrix.cells.length}`
            : loading
              ? "loading"
              : "idle"}
      </div>
      <button
        data-testid={`${id}-refresh`}
        onClick={() => {
          // NOT `onRefresh?.(refresh())` — optional-call short-circuits its
          // own argument, so refresh() would never fire without the prop.
          const settled = refresh();
          onRefresh?.(settled);
        }}
      />
    </>
  );
}

/** Fire one `refresh()` from a mounted subscriber. */
function clickRefresh(id: string): void {
  fireEvent.click(screen.getByTestId(`${id}-refresh`));
}

beforeEach(() => {
  __resetMatrixCacheForTests();
});

afterEach(() => {
  cleanup();
  __resetMatrixCacheForTests();
  vi.restoreAllMocks();
});

describe("useMatrix registry — one request per key", () => {
  it("8 subscribers mounting together produce exactly 1 GET", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(payload("2026", 1)), { status: 200 }),
    );
    global.fetch = fetchSpy as never;

    render(
      <>
        {Array.from({ length: 8 }, (_, i) => (
          <Probe key={i} id={`p${i}`} period="2026" />
        ))}
      </>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("p7").textContent).toBe("2026:1"),
    );
    for (let i = 0; i < 8; i++) {
      expect(screen.getByTestId(`p${i}`).textContent).toBe("2026:1");
    }
    expect(matrixCalls(fetchSpy)).toHaveLength(1);
  });

  it("a subscriber mounting mid-flight joins the in-flight request", async () => {
    let release!: (r: Response) => void;
    const fetchSpy = vi.fn(
      () => new Promise<Response>((r) => { release = r; }),
    );
    global.fetch = fetchSpy as never;

    const first = render(<Probe id="a" period="2026" />);
    expect(matrixCalls(fetchSpy)).toHaveLength(1);
    // Second mount while the first request is still open.
    render(<Probe id="b" period="2026" />, { container: first.baseElement.appendChild(document.createElement("div")) });
    expect(matrixCalls(fetchSpy)).toHaveLength(1);

    await act(async () => {
      release(new Response(JSON.stringify(payload("2026", 3)), { status: 200 }));
    });
    await waitFor(() => {
      expect(screen.getByTestId("a").textContent).toBe("2026:3");
      expect(screen.getByTestId("b").textContent).toBe("2026:3");
    });
    expect(matrixCalls(fetchSpy)).toHaveLength(1);
  });
});

describe("useMatrix registry — invalidation reaches every subscriber", () => {
  it("DEFECT B: refresh() from one subscriber updates ALL of them", async () => {
    // Pre-registry, `refresh()` deleted the shared key and re-fetched into
    // the CALLING component's own useState. The other seven panels kept
    // rendering the payload they copied at mount.
    let version = 1;
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(payload("2026", version)), { status: 200 }),
    );
    global.fetch = fetchSpy as never;
    const settled: Array<Promise<void>> = [];

    render(
      <>
        <Probe
          id="caller"
          period="2026"
          onRefresh={(p) => settled.push(p)}
        />
        {Array.from({ length: 7 }, (_, i) => (
          <Probe key={i} id={`other${i}`} period="2026" />
        ))}
      </>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("other6").textContent).toBe("2026:1"),
    );

    version = 2;
    await act(async () => {
      clickRefresh("caller");
      await Promise.all(settled);
    });

    await waitFor(() => {
      for (let i = 0; i < 7; i++) {
        expect(screen.getByTestId(`other${i}`).textContent).toBe("2026:2");
      }
    });
    expect(screen.getByTestId("caller").textContent).toBe("2026:2");
    expect(matrixCalls(fetchSpy)).toHaveLength(2);
  });

  it("THE STORM: 221 undebounced refresh() calls cost exactly 1 refetch", async () => {
    // `CompanySnapshot.tsx:107-113` calls refresh() straight out of the SSE
    // handler with no debounce, and the per-row NOTIFY trigger delivers one
    // event per (company × indicator). 13 × 17 = 221 today, 60 × 80 = 4800
    // at the Phase F target. The registry-side debounce is what makes the
    // component's missing one harmless.
    let version = 1;
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(payload("2026", version)), { status: 200 }),
    );
    global.fetch = fetchSpy as never;
    const settled: Array<Promise<void>> = [];

    render(
      <Probe
        id="snapshot"
        period="2026"
        onRefresh={(p) => settled.push(p)}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("snapshot").textContent).toBe("2026:1"),
    );
    expect(matrixCalls(fetchSpy)).toHaveLength(1);

    version = 2;
    await act(async () => {
      for (let i = 0; i < 221; i++) clickRefresh("snapshot");
      expect(settled).toHaveLength(221);
      await Promise.all(settled);
    });

    expect(matrixCalls(fetchSpy)).toHaveLength(2); // 1 initial + 1 coalesced
    expect(screen.getByTestId("snapshot").textContent).toBe("2026:2");

    // And nothing lands late: give the debounce window several lifetimes.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(matrixCalls(fetchSpy)).toHaveLength(2);
  });

  it("invalidating one key leaves a different subscribed key untouched", async () => {
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("period=2025")) {
        return new Response(JSON.stringify(payload("2025", 9)), { status: 200 });
      }
      return new Response(JSON.stringify(payload("2026", 1)), { status: 200 });
    });
    global.fetch = fetchSpy as never;

    render(
      <>
        <Probe id="a" period="2026" />
        <Probe id="b" period="2025" />
      </>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("a").textContent).toBe("2026:1");
      expect(screen.getByTestId("b").textContent).toBe("2025:9");
    });

    await act(async () => {
      await invalidateMatrix("2026");
    });
    expect(matrixCalls(fetchSpy)).toHaveLength(3); // 2 initial + 1 for 2026
    expect(screen.getByTestId("b").textContent).toBe("2025:9");
  });
});

describe("useMatrix registry — generation guard", () => {
  it("a response that lands after its key was invalidated cannot overwrite newer data", async () => {
    const releases: Array<(r: Response) => void> = [];
    const fetchSpy = vi.fn(
      () => new Promise<Response>((r) => { releases.push(r); }),
    );
    global.fetch = fetchSpy as never;

    render(<Probe id="p" period="2026" />);
    expect(releases).toHaveLength(1); // request A in flight, nothing rendered yet

    // Invalidate twice — the second supersedes the first. Each fires its own
    // refetch once the debounce elapses.
    clickRefresh("p");
    await waitFor(() => expect(releases).toHaveLength(2)); // request B
    clickRefresh("p");
    await waitFor(() => expect(releases).toHaveLength(3)); // request C

    // C (newest) answers first.
    await act(async () => {
      releases[2](new Response(JSON.stringify(payload("2026", 3)), { status: 200 }));
    });
    await waitFor(() => expect(screen.getByTestId("p").textContent).toBe("2026:3"));

    // A and B answer late with older payloads — both must be discarded.
    await act(async () => {
      releases[1](new Response(JSON.stringify(payload("2026", 2)), { status: 200 }));
      releases[0](new Response(JSON.stringify(payload("2026", 1)), { status: 200 }));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByTestId("p").textContent).toBe("2026:3");
    expect(getMatrixSync("2026")!.cells).toHaveLength(3);
  });

  it("a stale in-flight response cannot leak into the next test's cache", async () => {
    // Same guard, from the __resetMatrixCacheForTests() direction.
    let release!: (r: Response) => void;
    global.fetch = vi.fn(
      () => new Promise<Response>((r) => { release = r; }),
    ) as never;
    const p = ensureMatrix("2026");
    __resetMatrixCacheForTests();
    await act(async () => {
      release(new Response(JSON.stringify(payload("2026", 7)), { status: 200 }));
      await p;
    });
    expect(getMatrixSync("2026")).toBeNull();
  });
});

describe("useMatrix registry — eviction", () => {
  it("an unsubscribed key is dropped on invalidation instead of served forever", async () => {
    // DEFECT B's stale-forever half: pre-registry, a period visited earlier
    // in the session kept its first payload for the rest of the session.
    let version = 1;
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          payload(String(url).includes("2025") ? "2025" : "2026", version),
        ),
        { status: 200 },
      ),
    );
    global.fetch = fetchSpy as never;

    const visit2025 = render(<Probe id="old" period="2025" />);
    await waitFor(() =>
      expect(screen.getByTestId("old").textContent).toBe("2025:1"),
    );
    visit2025.unmount();
    // Still warm — an immediate return must not cost a round-trip.
    expect(getMatrixSync("2025")).not.toBeNull();

    render(<Probe id="live" period="2026" />);
    await waitFor(() =>
      expect(screen.getByTestId("live").textContent).toBe("2026:1"),
    );
    version = 2;
    await act(async () => {
      await invalidateMatrix("2026");
    });

    // The recompute moved the data under 2025 too, and nobody was watching:
    // dropped, so re-visiting goes back to the server.
    expect(getMatrixSync("2025")).toBeNull();
    const before = matrixCalls(fetchSpy).length;
    render(<Probe id="return" period="2025" />);
    await waitFor(() =>
      expect(screen.getByTestId("return").textContent).toBe("2025:2"),
    );
    expect(matrixCalls(fetchSpy)).toHaveLength(before + 1);
  });

  it("LRU-caps the warm set at 6 and keeps the most recent ones", async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const m = /period=(\d+)/.exec(String(url));
      return new Response(JSON.stringify(payload(m ? m[1] : "x", 1)), {
        status: 200,
      });
    }) as never;

    const years = ["2001", "2002", "2003", "2004", "2005", "2006", "2007"];
    for (const y of years) await ensureMatrix(y);

    expect(getMatrixSync("2001")).toBeNull(); // LRU victim
    for (const y of years.slice(1)) {
      expect(getMatrixSync(y), `${y} should still be warm`).not.toBeNull();
    }
  });

  it("never evicts a key that still has a subscriber", async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const m = /period=(\d+)/.exec(String(url));
      return new Response(JSON.stringify(payload(m ? m[1] : "x", 1)), {
        status: 200,
      });
    }) as never;

    render(<Probe id="pinned" period="2000" />);
    await waitFor(() =>
      expect(screen.getByTestId("pinned").textContent).toBe("2000:1"),
    );
    for (const y of ["2001", "2002", "2003", "2004", "2005", "2006", "2007"]) {
      await ensureMatrix(y);
    }
    expect(getMatrixSync("2000")).not.toBeNull();
  });

  it("drops a pending refetch when the last subscriber unmounts", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(payload("2026", 1)), { status: 200 }),
    );
    global.fetch = fetchSpy as never;
    let settled = false;

    const view = render(
      <Probe
        id="p"
        period="2026"
        onRefresh={(promise) => {
          void promise.then(() => { settled = true; });
        }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("p").textContent).toBe("2026:1"),
    );
    clickRefresh("p");
    view.unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    // No refetch for a panel that is gone, and the promise still settles.
    expect(matrixCalls(fetchSpy)).toHaveLength(1);
    expect(settled).toBe(true);
  });
});

describe("useMatrix registry — the five guarantees", () => {
  it("G1: enabled:false mounts issue ZERO requests, even eight of them", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(payload("2026", 1)), { status: 200 }),
    );
    global.fetch = fetchSpy as never;

    render(
      <>
        {Array.from({ length: 8 }, (_, i) => (
          <Probe key={i} id={`p${i}`} period="2026" enabled={false} />
        ))}
      </>,
    );
    await act(async () => Promise.resolve());
    expect(matrixCalls(fetchSpy)).toHaveLength(0);
    expect(screen.getByTestId("p0").textContent).toBe("idle"); // not "loading"
    expect(getMatrixSync("2026")).toBeNull();
  });

  it("G2: a no-arg useMatrix() joins the STORE period's key, not __default__", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(payload("2026-Q1", 4)), { status: 200 }),
    );
    global.fetch = fetchSpy as never;
    const { result: setter } = renderHook(() =>
      useTerminalStore((s) => s.setSelectedPeriod),
    );
    act(() => setter.current("2026-Q1"));
    try {
      render(
        <>
          <Probe id="noarg" />
          <Probe id="explicit" period="2026-Q1" />
        </>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("noarg").textContent).toBe("2026-Q1:4");
        expect(screen.getByTestId("explicit").textContent).toBe("2026-Q1:4");
      });
      // ONE request: both calls resolved to the same key.
      expect(matrixCalls(fetchSpy)).toHaveLength(1);
      expect(matrixCalls(fetchSpy)[0]).toContain("period=2026-Q1");
      // …and that key is the store period, not the default one.
      expect(getMatrixSync("2026-Q1")).not.toBeNull();
      expect(getMatrixSync()).toBeNull();
    } finally {
      act(() => setter.current(undefined));
    }
  });

  it("G3: CompanyTree's useMatrix(undefined, showPending) shares the cache and keys on the variant", async () => {
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          payload("2026", String(url).includes("includePending=true") ? 2 : 1),
        ),
        { status: 200 },
      ),
    );
    global.fetch = fetchSpy as never;
    const { result: setter } = renderHook(() =>
      useTerminalStore((s) => s.setSelectedPeriod),
    );
    act(() => setter.current("2026"));
    try {
      // Two consumers on the pending variant + one on the plain view.
      render(
        <>
          <Probe id="tree" includePending />
          <Probe id="twin" includePending />
          <Probe id="plain" />
        </>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("tree").textContent).toBe("2026:2");
        expect(screen.getByTestId("twin").textContent).toBe("2026:2");
        expect(screen.getByTestId("plain").textContent).toBe("2026:1");
      });
      // One request per VARIANT — the two pending consumers shared one.
      expect(matrixCalls(fetchSpy)).toHaveLength(2);
      expect(getMatrixSync("2026", true)!.cells).toHaveLength(2);
      expect(getMatrixSync("2026", false)!.cells).toHaveLength(1);

      // Invalidating the pending variant must not disturb the plain one.
      await act(async () => {
        await invalidateMatrix("2026", true);
      });
      expect(matrixCalls(fetchSpy)).toHaveLength(3);
      expect(screen.getByTestId("plain").textContent).toBe("2026:1");
    } finally {
      act(() => setter.current(undefined));
    }
  });

  it("G4: getMatrixSync() is synchronous and never fetches", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(payload("2026", 1)), { status: 200 }),
    );
    global.fetch = fetchSpy as never;

    expect(getMatrixSync()).toBeNull();
    expect(getMatrixSync("2026")).toBeNull();
    expect(getMatrixSync("2026", true)).toBeNull();
    await act(async () => Promise.resolve());
    expect(matrixCalls(fetchSpy)).toHaveLength(0);

    await ensureMatrix("2026");
    expect(matrixCalls(fetchSpy)).toHaveLength(1);
    // Synchronous read, still no extra request.
    expect(getMatrixSync("2026")!.period).toBe("2026");
    expect(matrixCalls(fetchSpy)).toHaveLength(1);
  });

  it("G5: __resetMatrixCacheForTests() clears data, subscribers and timers", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(payload("2026", 1)), { status: 200 }),
    );
    global.fetch = fetchSpy as never;

    await ensureMatrix("2026");
    await ensureMatrix("2025");
    expect(getMatrixSync("2026")).not.toBeNull();

    __resetMatrixCacheForTests();
    expect(getMatrixSync("2026")).toBeNull();
    expect(getMatrixSync("2025")).toBeNull();

    const before = matrixCalls(fetchSpy).length;
    render(<Probe id="p" period="2026" />);
    await waitFor(() =>
      expect(screen.getByTestId("p").textContent).toBe("2026:1"),
    );
    expect(matrixCalls(fetchSpy)).toHaveLength(before + 1);
  });
});
