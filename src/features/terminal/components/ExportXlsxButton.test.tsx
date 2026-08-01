// @vitest-environment happy-dom
/**
 * Phase 7.N regression lock — ExportXlsxTrigger composite penalty wiring.
 *
 * The terminal Excel export builds its Summary-sheet composites from the
 * matrix cells. Before this fix it called `computeCompositeByCompany`
 * WITHOUT the riskTags arg, so the exported workbook showed UNPENALIZED
 * scores that disagreed with the on-screen terminal (CompanyTree / HeatMap).
 * This mocks BOTH the matrix endpoint AND `/api/companies` (the riskTags
 * source) and asserts the Summary-sheet score for a flagged company is
 * penalized.
 *
 * Mirrors the HeatMap integration pattern (HeatMap.test.tsx) — render the
 * component, let both module-cached hooks resolve, then assert the penalized
 * value flows all the way through to the export payload.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, cleanup, waitFor } from "@testing-library/react";
import { ExportXlsxTrigger } from "./ExportXlsxButton";
import { __resetMatrixCacheForTests } from "../hooks/use-matrix";
import { __resetCompaniesCacheForTests } from "../hooks/use-companies";

// Capture the rows the handler hands to XLSX. aoa_to_sheet is called once per
// sheet in source order: Summary (0), Matrix values (1), Matrix status (2),
// Brief (3) — so calls[0][0] is always the Summary sheet.
const xlsxMock = vi.hoisted(() => ({
  // Typed param so vitest infers `mock.calls[i][0]` as the captured rows.
  aoaToSheet: vi.fn((_rows: unknown[][]) => ({})),
  bookAppendSheet: vi.fn(),
  bookNew: vi.fn(() => ({})),
  write: vi.fn(() => new Uint8Array([1, 2, 3])),
}));

vi.mock("xlsx", () => ({
  utils: {
    book_new: xlsxMock.bookNew,
    aoa_to_sheet: xlsxMock.aoaToSheet,
    book_append_sheet: xlsxMock.bookAppendSheet,
  },
  write: xlsxMock.write,
}));

// Trigger reads alertMatches off the terminal store; stub to empty.
vi.mock("../store/terminalStore", () => ({
  useTerminalStore: <T,>(selector: (s: { alertMatches: unknown[] }) => T) =>
    selector({ alertMatches: [] }),
}));

// EDEN all-green → composite base 100; flagged data_absence (-12) → 88.
const MATRIX = {
  period: "2026",
  companies: [{ id: "co_eden", code: "EDEN", name: "Eden", industry: "Agri" }],
  // 11.81 — four indicators so the company clears the coverage floor; the
  // riskTag-penalty parity this file locks is unchanged.
  indicators: ["ind_a", "ind_b", "ind_c", "ind_d"].map((id) => ({
    id, code: id.toUpperCase(), nameEn: id, unit: "%", direction: "higher_better",
  })),
  cells: ["ind_a", "ind_b", "ind_c", "ind_d"].map((indicatorId, n) => ({
    indicatorValueId: `iv${n}`, companyId: "co_eden", indicatorId, value: 50, status: "green",
  })),
};

beforeEach(() => {
  __resetMatrixCacheForTests();
  __resetCompaniesCacheForTests();
  xlsxMock.aoaToSheet.mockClear();
  xlsxMock.write.mockClear();
  // happy-dom doesn't implement alert / URL.createObjectURL — stub them.
  window.alert = vi.fn();
  global.URL.createObjectURL = vi.fn(() => "blob:fake");
  global.URL.revokeObjectURL = vi.fn();
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("/api/indicators/matrix")) {
      return new Response(JSON.stringify(MATRIX), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
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
});

afterEach(() => {
  cleanup();
  __resetMatrixCacheForTests();
  __resetCompaniesCacheForTests();
});

describe("ExportXlsxTrigger composite riskTag penalty (Phase 7.N)", () => {
  it("writes the penalized composite (100 → 88) into the Summary sheet", async () => {
    render(<ExportXlsxTrigger />);
    // Re-dispatch inside waitFor: the export handler closes over `companies`,
    // which loads async (one extra round-trip after matrix). Retrying until
    // the penalized score appears tolerates the load order without a flaky
    // single-shot fire. The penalized 88 is IMPOSSIBLE pre-fix (would be 100).
    await waitFor(
      async () => {
        xlsxMock.aoaToSheet.mockClear();
        await act(async () => {
          window.dispatchEvent(new Event("terminal:export-xlsx"));
          await new Promise((r) => setTimeout(r, 0));
        });
        expect(xlsxMock.aoaToSheet).toHaveBeenCalled();
        const summaryRows = xlsxMock.aoaToSheet.mock.calls[0][0];
        const edenRow = summaryRows.find((r) => r[1] === "EDEN");
        expect(edenRow?.[2]).toBe(88);
      },
      { timeout: 8000 },
    );
  });
});

describe("ExportXlsxTrigger — a withheld composite is a token, never a blank (11.81)", () => {
  beforeEach(() => {
    __resetMatrixCacheForTests();
    __resetCompaniesCacheForTests();
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/api/indicators/matrix")) {
        return new Response(
          JSON.stringify({
            ...MATRIX,
            // One figure of four — below the coverage floor.
            cells: [
              { indicatorValueId: "iv0", companyId: "co_eden", indicatorId: "ind_a", value: 1, status: "red" },
              ...["ind_b", "ind_c", "ind_d"].map((indicatorId, n) => ({
                indicatorValueId: `ivx${n}`, companyId: "co_eden", indicatorId, value: 0, status: "unknown",
              })),
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as never;
  });

  it("writes a text token and a populated coverage column, not an empty cell", async () => {
    // The real defect: `s?.score ?? ""` wrote an EMPTY cell, which is
    // indistinguishable from "not computed", silently breaks the client's own
    // AVERAGE/MIN, and sorts to whichever end Excel picks. This is the one
    // export a client re-sorts themselves.
    render(<ExportXlsxTrigger />);
    await waitFor(
      async () => {
        xlsxMock.aoaToSheet.mockClear();
        await act(async () => {
          window.dispatchEvent(new Event("terminal:export-xlsx"));
          await new Promise((r) => setTimeout(r, 0));
        });
        expect(xlsxMock.aoaToSheet).toHaveBeenCalled();
        const summaryRows = xlsxMock.aoaToSheet.mock.calls[0][0];
        const edenRow = summaryRows.find((r) => r[1] === "EDEN");
        expect(edenRow?.[2]).toBe("Not scored");
        expect(edenRow?.[3]).toBe("1/4");
        // …and the sheet explains the token rather than leaving it dangling.
        const note = summaryRows.find(
          (r) => typeof r[0] === "string" && r[0].includes("Not scored"),
        );
        expect(note).toBeTruthy();
      },
      { timeout: 8000 },
    );
  });
});
