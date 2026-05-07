// @vitest-environment happy-dom
/**
 * Phase C3 v2 — ExportPptxButton smoke + behavior.
 *
 * Locks: (a) renders aria-label + visible label; (b) click fires fetch
 * with `?period=…`; (c) successful response triggers a synthetic
 * `<a download>` click + URL.revokeObjectURL; (d) HTTP error surfaces
 * inline "Export failed" without crashing.
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
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { ExportPptxButton } from "./ExportPptxButton";

// Phase 7.G Turn LIV — ExportPptxButton consumes useSearchParams to
// thread `?lang=` + `?regenerate=` to the export route. Tests drive
// the picker URL state via mutable module-level string.
let searchParamsState = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchParamsState),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  searchParamsState = "";
});

beforeEach(() => {
  // happy-dom does not implement URL.createObjectURL / revokeObjectURL
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:mock-url"),
    writable: true,
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
});

describe("ExportPptxButton (Phase C3 v2)", () => {
  it("renders aria-label + visible label", () => {
    render(<ExportPptxButton period="2025" />);
    const btn = screen.getByLabelText("Export board snapshot to PPTX");
    expect(btn.textContent).toContain("Export PPTX");
  });

  it("click → fetch + synthetic <a download> click + URL revoke", async () => {
    const blob = new Blob(["mock-pptx"], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(blob, {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "Content-Disposition": `attachment; filename="board-deck-acme-2025.pptx"`,
        },
      }),
    );
    Object.defineProperty(window, "fetch", {
      value: fetchSpy,
      writable: true,
      configurable: true,
    });
    const clickSpy = vi.fn();
    // Capture the synthetic anchor's .click() so we can assert it fired
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === "a") {
        Object.defineProperty(el, "click", {
          value: clickSpy,
          writable: true,
          configurable: true,
        });
      }
      return el;
    });

    render(<ExportPptxButton period="2025" />);
    fireEvent.click(screen.getByLabelText("Export board snapshot to PPTX"));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      "/api/budgeting/board-deck/export-pptx?period=2025",
    );
    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalledOnce();
    });
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("HTTP error surfaces inline + button re-enabled", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 500 }));
    Object.defineProperty(window, "fetch", {
      value: fetchSpy,
      writable: true,
      configurable: true,
    });

    render(<ExportPptxButton period="2025" />);
    const btn = screen.getByLabelText("Export board snapshot to PPTX");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(screen.getByRole("alert").textContent).toContain("HTTP 500");
    // After the failed call, the button must be clickable again
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("uses print:hidden so the button does NOT print itself", () => {
    render(<ExportPptxButton period="2025" />);
    const wrapper = screen
      .getByLabelText("Export board snapshot to PPTX")
      .closest("div");
    expect(wrapper?.className).toContain("print:hidden");
  });
});

describe("ExportPptxButton — Turn LIV URL passthrough", () => {
  function mockFetchOk() {
    const blob = new Blob(["mock"], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(blob, {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        },
      }),
    );
    Object.defineProperty(window, "fetch", {
      value: fetchSpy,
      writable: true,
      configurable: true,
    });
    return fetchSpy;
  }

  function silenceAnchorClick() {
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === "a") {
        Object.defineProperty(el, "click", {
          value: vi.fn(),
          writable: true,
          configurable: true,
        });
      }
      return el;
    });
  }

  it("threads ?lang=ru from page URL into the export request", async () => {
    searchParamsState = "lang=ru";
    const fetchSpy = mockFetchOk();
    silenceAnchorClick();

    render(<ExportPptxButton period="2025" />);
    fireEvent.click(screen.getByLabelText("Export board snapshot to PPTX"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("period=2025");
    expect(url).toContain("lang=ru");
  });

  it("threads ?regenerate=1 from page URL into the export request", async () => {
    searchParamsState = "regenerate=1";
    const fetchSpy = mockFetchOk();
    silenceAnchorClick();

    render(<ExportPptxButton period="2025" />);
    fireEvent.click(screen.getByLabelText("Export board snapshot to PPTX"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("regenerate=1");
  });

  it("rejects unknown lang values (defensive — only en/ru/az pass through)", async () => {
    searchParamsState = "lang=fr";
    const fetchSpy = mockFetchOk();
    silenceAnchorClick();

    render(<ExportPptxButton period="2025" />);
    fireEvent.click(screen.getByLabelText("Export board snapshot to PPTX"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).not.toContain("lang=");
  });

  it("ignores unrelated page query state (only forwards lang + regenerate)", async () => {
    searchParamsState = "noise=1&debug=true";
    const fetchSpy = mockFetchOk();
    silenceAnchorClick();

    render(<ExportPptxButton period="2025" />);
    fireEvent.click(screen.getByLabelText("Export board snapshot to PPTX"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).not.toContain("noise");
    expect(url).not.toContain("debug");
    expect(url).toBe("/api/budgeting/board-deck/export-pptx?period=2025");
  });
});
