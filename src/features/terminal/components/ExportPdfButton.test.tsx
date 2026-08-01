// @vitest-environment happy-dom
/**
 * Phase 7.N regression lock — ExportPdfTrigger composite penalty wiring.
 *
 * The terminal PDF export builds its `composites` prop from the matrix
 * cells. Before this fix it called `computeCompositeByCompany` WITHOUT the
 * riskTags arg, so the exported PDF showed UNPENALIZED scores that disagreed
 * with the on-screen terminal (CompanyTree / HeatMap). This mocks BOTH the
 * matrix endpoint AND `/api/companies` (the riskTags source) and asserts the
 * composite handed to `<RiskMatrixPdfDoc>` for a flagged company is penalized.
 *
 * Mirrors the HeatMap integration pattern (HeatMap.test.tsx).
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, cleanup, waitFor } from "@testing-library/react";
import { ExportPdfTrigger } from "./ExportPdfButton";
import { __resetMatrixCacheForTests } from "../hooks/use-matrix";
import { __resetCompaniesCacheForTests } from "../hooks/use-companies";

// Capture the React element handed to `pdf()` — its `.props.composites` is
// the composite list the document is built from. `RiskMatrixPdfDoc` is never
// rendered (pdf() is mocked), so we read the element props directly.
const pdfMock = vi.hoisted(() => ({ pdf: vi.fn() }));

vi.mock("@react-pdf/renderer", () => ({
  pdf: (doc: unknown) => {
    pdfMock.pdf(doc);
    return { toBlob: async () => new Blob(["%PDF"]) };
  },
}));

vi.mock("./RiskMatrixPdf", () => ({
  RiskMatrixPdfDoc: () => null,
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
  pdfMock.pdf.mockClear();
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

describe("ExportPdfTrigger composite riskTag penalty (Phase 7.N)", () => {
  it("hands the penalized composite (100 → 88) to RiskMatrixPdfDoc", async () => {
    render(<ExportPdfTrigger />);
    // Re-dispatch inside waitFor — same load-order rationale as the XLSX
    // test. The penalized 88 is IMPOSSIBLE pre-fix (would be 100).
    await waitFor(
      async () => {
        pdfMock.pdf.mockClear();
        await act(async () => {
          window.dispatchEvent(new Event("terminal:export-pdf"));
          await new Promise((r) => setTimeout(r, 0));
        });
        expect(pdfMock.pdf).toHaveBeenCalled();
        const doc = pdfMock.pdf.mock.calls[0][0] as {
          props: { composites: Array<{ code: string; score: number | null }> };
        };
        const eden = doc.props.composites.find((c) => c.code === "EDEN");
        expect(eden?.score).toBe(88);
      },
      { timeout: 8000 },
    );
  });
});
