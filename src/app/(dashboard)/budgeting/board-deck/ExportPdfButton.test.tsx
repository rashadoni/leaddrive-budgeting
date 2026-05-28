// @vitest-environment happy-dom
/**
 * Phase 7.G Turn XLVII (Phase E.1) — ExportPdfButton component tests.
 *
 * Mirrors `ExportPptxButton.test.tsx` shape: closed-by-default disabled
 * state, click triggers fetch with the right URL + summary/lang params,
 * busy state during fetch, error rendering on failure, summary-flag
 * propagation.
 */

import React from "react";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { ExportPdfButton } from "./ExportPdfButton";

let fetchMock: MockInstance;

function pdfResponse() {
  return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="board-deck-2025.pdf"',
    },
  });
}

beforeEach(() => {
  fetchMock = vi.fn(async () => pdfResponse()) as unknown as MockInstance;
  global.fetch = fetchMock as unknown as typeof fetch;
  // Stub URL.createObjectURL + revokeObjectURL — happy-dom doesn't
  // implement them but the button uses them for the download trigger.
  global.URL.createObjectURL = vi.fn(() => "blob:fake");
  global.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ExportPdfButton", () => {
  // Phase 8 D7 — i18n keys via global next-intl mock render as
  // SPACED UPPERCASE fallback labels ("pdfLabel" → "PDF LABEL",
  // "pdfAriaLabel" → "PDF ARIA LABEL"). Tests target via the
  // fallback to stay loose against exact copy edits.

  it("renders the button with default label", () => {
    render(<ExportPdfButton period="2025" />);
    expect(
      screen.getByRole("button", { name: /PDF ARIA LABEL/i }),
    ).toBeTruthy();
    expect(screen.getByText("PDF LABEL")).toBeTruthy();
  });

  it("click fires GET to /api/budgeting/board-deck/export-pdf with period only by default", async () => {
    render(<ExportPdfButton period="2025" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("/api/budgeting/board-deck/export-pdf?period=2025");
  });

  it("threads withSummary + language into URL params", async () => {
    render(
      <ExportPdfButton period="2026" withSummary={true} language="ru" />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("period=2026");
    expect(url).toContain("summary=true");
    expect(url).toContain("lang=ru");
  });

  it("does NOT add summary/lang when withSummary=false", async () => {
    render(
      <ExportPdfButton period="2025" withSummary={false} language="en" />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).not.toContain("summary=");
    expect(url).not.toContain("lang=");
  });

  it("renders error state on non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "PDF export unavailable",
          message: "Headless Chromium failed to launch",
        }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    render(<ExportPdfButton period="2025" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      const alert = screen.queryByRole("alert");
      expect(alert?.textContent).toMatch(/Headless Chromium failed/);
    });
  });

  it("renders fallback error when response body is non-JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("plain text error", {
        status: 500,
      }),
    );
    render(<ExportPdfButton period="2025" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      const alert = screen.queryByRole("alert");
      expect(alert?.textContent).toMatch(/HTTP 500/);
    });
  });

  it("disables button during in-flight fetch (no double-fire)", async () => {
    let resolveFetch: (r: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    render(<ExportPdfButton period="2025" />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    // Button should now be disabled + show "Rendering…" label.
    await waitFor(() => {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    });
    expect(screen.getByText("PDF RENDERING")).toBeTruthy();
    // Second click is ignored — handleClick early-returns when busy.
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Resolve the in-flight fetch + flush.
    resolveFetch(pdfResponse());
    await waitFor(() => {
      expect((button as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
