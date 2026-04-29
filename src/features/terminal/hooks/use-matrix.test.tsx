// @vitest-environment happy-dom
/**
 * Sub-20 — useMatrix shared hook tests.
 *
 * Locks the contract:
 *  - Single fetch shared via module cache across mounts (default period).
 *  - Period-keyed cache: different periods = independent fetches.
 *  - Loading flag transitions correctly.
 *  - Error path: failed fetch surfaces error string + loading=false.
 *  - Concurrent mounts during in-flight fetch all subscribe to same promise.
 *  - refresh(period) purges that period's cache + re-fetches (others unchanged).
 *  - ensureMatrix() async accessor returns cached or kicks off fetch.
 *  - getMatrixSync() returns null for cold cache.
 *  - Sticky-error: 2nd mount after failure subscribes to rejected promise.
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
  cleanup,
  act,
  waitFor,
  renderHook,
} from "@testing-library/react";
import {
  useMatrix,
  ensureMatrix,
  getMatrixSync,
  __resetMatrixCacheForTests,
} from "./use-matrix";

beforeEach(() => {
  __resetMatrixCacheForTests();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SAMPLE_2026 = {
  period: "2026",
  companies: [
    { id: "co_a", code: "AAC-MAIN", name: "AAC Main", industry: "Industrial" },
  ],
  indicators: [
    { id: "ind_x", code: "IND_X", nameEn: "X", direction: "higher_better", unit: "%" },
  ],
  cells: [
    { companyId: "co_a", indicatorId: "ind_x", value: 12.3, status: "amber" },
  ],
};

const SAMPLE_2025 = {
  period: "2025",
  companies: [
    { id: "co_b", code: "ATL-DBZ", name: "ATL DBZ", industry: "Industrial" },
  ],
  indicators: [
    { id: "ind_y", code: "IND_Y", nameEn: "Y", direction: "lower_better", unit: "%" },
  ],
  cells: [
    { companyId: "co_b", indicatorId: "ind_y", value: 5, status: "green" },
  ],
};

describe("useMatrix (sub-20)", () => {
  it("loads matrix for default period", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(SAMPLE_2026), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as never;
    const { result } = renderHook(() => useMatrix());
    expect(result.current.loading).toBe(true);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.matrix).not.toBeNull();
    expect(result.current.matrix!.companies).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("module cache: 2nd hook call shares same fetch (no double request)", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(SAMPLE_2026), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchSpy as never;
    const { result: r1 } = renderHook(() => useMatrix());
    const { result: r2 } = renderHook(() => useMatrix());
    await waitFor(() => {
      expect(r1.current.loading).toBe(false);
      expect(r2.current.loading).toBe(false);
    });
    expect(r1.current.matrix).toEqual(r2.current.matrix);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("period-keyed cache: 2026 + 2025 are independent fetches", async () => {
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("period=2026")) {
        return new Response(JSON.stringify(SAMPLE_2026), { status: 200 });
      }
      if (u.includes("period=2025")) {
        return new Response(JSON.stringify(SAMPLE_2025), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    global.fetch = fetchSpy as never;
    const { result: r2026 } = renderHook(() => useMatrix("2026"));
    const { result: r2025 } = renderHook(() => useMatrix("2025"));
    await waitFor(() => {
      expect(r2026.current.loading).toBe(false);
      expect(r2025.current.loading).toBe(false);
    });
    // Both fetched, but each period got its own request.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(r2026.current.matrix!.period).toBe("2026");
    expect(r2025.current.matrix!.period).toBe("2025");
  });

  it("error path: surfaces error string + loading=false", async () => {
    global.fetch = vi.fn(async () =>
      new Response("nope", { status: 500 }),
    ) as never;
    const { result } = renderHook(() => useMatrix());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toContain("500");
    expect(result.current.matrix).toBeNull();
  });

  it("sticky error: 2nd mount after failed fetch sees same error, no retry", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response("nope", { status: 500 }),
    );
    global.fetch = fetchSpy as never;
    const { result: r1 } = renderHook(() => useMatrix());
    await waitFor(() => {
      expect(r1.current.loading).toBe(false);
    });
    expect(r1.current.error).toContain("500");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const { result: r2 } = renderHook(() => useMatrix());
    await waitFor(() => {
      expect(r2.current.loading).toBe(false);
    });
    expect(r2.current.error).toContain("500");
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no retry
  });

  it("refresh(period) purges that period only + re-fetches", async () => {
    let payload2026 = SAMPLE_2026;
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("period=2026")) {
        return new Response(JSON.stringify(payload2026), { status: 200 });
      }
      if (u.includes("period=2025")) {
        return new Response(JSON.stringify(SAMPLE_2025), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    global.fetch = fetchSpy as never;
    const { result: r2026 } = renderHook(() => useMatrix("2026"));
    const { result: r2025 } = renderHook(() => useMatrix("2025"));
    await waitFor(() => {
      expect(r2026.current.loading).toBe(false);
      expect(r2025.current.loading).toBe(false);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // Mutate 2026 server-side state.
    payload2026 = {
      ...SAMPLE_2026,
      cells: [
        ...SAMPLE_2026.cells,
        { companyId: "co_a", indicatorId: "ind_x2", value: 99, status: "red" },
      ],
    };
    await act(async () => {
      await r2026.current.refresh();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3); // +1 for 2026 refresh
    expect(r2026.current.matrix!.cells).toHaveLength(2);
    // 2025 cache untouched — still original.
    expect(r2025.current.matrix!.cells).toHaveLength(1);
  });

  it("ensureMatrix(): async accessor populates cache for 1-shot reads", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(SAMPLE_2026), { status: 200 }),
    );
    global.fetch = fetchSpy as never;
    // Cold cache — getMatrixSync returns null.
    expect(getMatrixSync()).toBeNull();
    // ensureMatrix kicks off fetch.
    const matrix = await ensureMatrix();
    expect(matrix.period).toBe("2026");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Cache primed — getMatrixSync now returns it.
    expect(getMatrixSync()?.period).toBe("2026");
    // Subsequent ensureMatrix re-uses cache.
    await ensureMatrix();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("getMatrixSync() returns null for periods not in cache", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(SAMPLE_2026), { status: 200 }),
    ) as never;
    expect(getMatrixSync("2024")).toBeNull();
    await ensureMatrix("2026");
    // 2026 primed, but 2024 still cold.
    expect(getMatrixSync("2026")).not.toBeNull();
    expect(getMatrixSync("2024")).toBeNull();
  });
});
