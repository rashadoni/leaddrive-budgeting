// @vitest-environment happy-dom
/**
 * Phase 7.G Turn LI (Board Deck v2 Turn 4) — FooterActions tests.
 *
 * Locks: terminal CTA href, eyebrow + subtitle render, period prop
 * threads through to ExportPptxButton (boundary mock — no real
 * pptxgenjs in tests).
 */

import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// Mock the existing button components so we don't pull pptxgenjs into
// happy-dom + so we can verify the period prop threads through.
vi.mock("@/app/(dashboard)/budgeting/board-deck/PrintButton", () => ({
  PrintButton: () => (
    <button type="button" data-testid="mocked-print-button">
      Print
    </button>
  ),
}));
vi.mock("@/app/(dashboard)/budgeting/board-deck/ExportPptxButton", () => ({
  ExportPptxButton: ({ period }: { period: string }) => (
    <button
      type="button"
      data-testid="mocked-export-pptx-button"
      data-period={period}
    >
      Export PPTX
    </button>
  ),
}));
// Phase 7.G Turn XLVII recovery (2026-05-16) — server-side PDF button
// mounted next to PPTX in the footer. Same period-threading contract.
vi.mock("@/app/(dashboard)/budgeting/board-deck/ExportPdfButton", () => ({
  ExportPdfButton: ({ period }: { period: string }) => (
    <button
      type="button"
      data-testid="mocked-export-pdf-button"
      data-period={period}
    >
      Export PDF
    </button>
  ),
}));

import { FooterActions } from "./FooterActions";

async function renderFooter(period: string) {
  const tree = await FooterActions({ period });
  render(tree as React.ReactElement);
}

describe("FooterActions", () => {
  it("renders eyebrow + subtitle", async () => {
    await renderFooter("2026");
    const section = screen.getByTestId("board-deck-footer-actions");
    expect(section.textContent).toContain("Share + drill-down");
    expect(section.textContent).toContain("Export the deck");
  });

  it("threads period prop to ExportPptxButton", async () => {
    await renderFooter("2026-Q2");
    const exportBtn = screen.getByTestId("mocked-export-pptx-button");
    expect(exportBtn.getAttribute("data-period")).toBe("2026-Q2");
  });

  it("renders Print + Export PPTX + Export PDF + Terminal CTA", async () => {
    await renderFooter("2026");
    expect(screen.getByTestId("mocked-print-button")).toBeTruthy();
    expect(screen.getByTestId("mocked-export-pptx-button")).toBeTruthy();
    expect(screen.getByTestId("mocked-export-pdf-button")).toBeTruthy();
    const terminalLink = screen.getByTestId("footer-terminal-link");
    expect(terminalLink.getAttribute("href")).toBe("/budgeting/terminal");
    expect(terminalLink.textContent).toContain("Open Risk Terminal");
  });

  it("threads period prop to ExportPdfButton", async () => {
    await renderFooter("2026-M5");
    const pdfBtn = screen.getByTestId("mocked-export-pdf-button");
    expect(pdfBtn.getAttribute("data-period")).toBe("2026-M5");
  });

  it("aria-label is set", async () => {
    await renderFooter("2026");
    const section = screen.getByTestId("board-deck-footer-actions");
    expect(section.getAttribute("aria-label")).toBe("Page actions");
  });

  it("is print-hidden (className contains print:hidden)", async () => {
    await renderFooter("2026");
    const section = screen.getByTestId("board-deck-footer-actions");
    expect(section.className).toContain("print:hidden");
  });
});
