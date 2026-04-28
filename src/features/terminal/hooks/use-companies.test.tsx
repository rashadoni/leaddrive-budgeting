// @vitest-environment happy-dom
/**
 * Sub-19 — useCompanies shared hook tests.
 *
 * Locks the contract:
 *  - Single fetch shared via module cache across mounts.
 *  - idToCode / codeToId build correctly from hierarchical tree.
 *  - Loading flag transitions correctly (true → false on success/error).
 *  - Error path: failed fetch surfaces error string + loading=false.
 *  - Concurrent mounts during in-flight fetch all subscribe to same promise.
 *  - refresh() purges cache + re-fetches.
 *  - Empty-array response → idToCode/codeToId empty maps + loading=false.
 *  - {companies: [...]} wrapper shape also accepted (defensive).
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
  act,
  waitFor,
  renderHook,
} from "@testing-library/react";
import {
  useCompanies,
  __resetCompaniesCacheForTests,
} from "./use-companies";

beforeEach(() => {
  __resetCompaniesCacheForTests();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SAMPLE_TREE = [
  {
    id: "atl_root",
    code: "ATL",
    name: "Azertexnolayn",
    children: [
      { id: "atl_main_id", code: "ATL-MAIN", name: "ATL Main" },
      { id: "atl_dbz_id", code: "ATL-DBZ", name: "ATL DBZ" },
    ],
  },
  { id: "aac_main_id", code: "AAC-MAIN", name: "AAC Main" },
];

describe("useCompanies (sub-19)", () => {
  it("loads tree + builds idToCode + codeToId from hierarchical response", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(SAMPLE_TREE), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as never;
    const { result } = renderHook(() => useCompanies());
    expect(result.current.loading).toBe(true);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.companies).toHaveLength(2);
    // idToCode + codeToId walk the tree (root + nested).
    expect(result.current.idToCode.get("atl_main_id")).toBe("ATL-MAIN");
    expect(result.current.idToCode.get("atl_dbz_id")).toBe("ATL-DBZ");
    expect(result.current.idToCode.get("aac_main_id")).toBe("AAC-MAIN");
    expect(result.current.codeToId.get("ATL-MAIN")).toBe("atl_main_id");
    expect(result.current.codeToId.get("ATL")).toBe("atl_root");
    expect(result.current.error).toBeNull();
  });

  it("module cache: 2nd hook call shares same fetch (no double request)", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(SAMPLE_TREE), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchSpy as never;
    // Mount two hook consumers.
    const { result: r1 } = renderHook(() => useCompanies());
    const { result: r2 } = renderHook(() => useCompanies());
    await waitFor(() => {
      expect(r1.current.loading).toBe(false);
      expect(r2.current.loading).toBe(false);
    });
    // Both see the same data.
    expect(r1.current.companies).toEqual(r2.current.companies);
    // Single network call (module cache).
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("error path: surfaces error string + loading=false", async () => {
    global.fetch = vi.fn(async () =>
      new Response("nope", { status: 500 }),
    ) as never;
    const { result } = renderHook(() => useCompanies());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toContain("500");
    expect(result.current.companies).toBeNull();
    expect(result.current.idToCode.size).toBe(0);
    expect(result.current.codeToId.size).toBe(0);
  });

  it("empty array response: idToCode/codeToId empty + loading=false (zero-co tenant)", async () => {
    global.fetch = vi.fn(async () =>
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as never;
    const { result } = renderHook(() => useCompanies());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.companies).toEqual([]);
    expect(result.current.idToCode.size).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('accepts {companies: [...]} wrapper shape (defensive)', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ companies: SAMPLE_TREE }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as never;
    const { result } = renderHook(() => useCompanies());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.companies).toHaveLength(2);
    expect(result.current.idToCode.get("atl_main_id")).toBe("ATL-MAIN");
  });

  it("refresh() purges cache + re-fetches (e.g. post-onboarding apply)", async () => {
    let payload = SAMPLE_TREE;
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchSpy as never;
    const { result } = renderHook(() => useCompanies());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.current.idToCode.size).toBe(4); // ATL + 2 children + AAC-MAIN

    // Server-side state changes (new company onboarded).
    payload = [
      ...SAMPLE_TREE,
      { id: "new_co_id", code: "NEW-CO", name: "Newly onboarded" },
    ];
    await act(async () => {
      await result.current.refresh();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.current.idToCode.get("new_co_id")).toBe("NEW-CO");
    expect(result.current.idToCode.size).toBe(5);
  });

  it("filters non-CompanyNode entries from response (defensive)", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify([
          { id: "valid", code: "OK", name: "valid" },
          { id: 42, code: "BAD-ID-TYPE" }, // id not a string
          null, // not an object
          { code: "MISSING-ID" }, // missing id field
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as never;
    const { result } = renderHook(() => useCompanies());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    // Only the valid entry survives.
    expect(result.current.companies).toHaveLength(1);
    expect(result.current.idToCode.get("valid")).toBe("OK");
  });
});
