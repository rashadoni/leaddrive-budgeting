"use client";

import { Printer } from "lucide-react";

/**
 * Phase C3 v1 — print trigger for the Board Deck Generator.
 *
 * v1 uses the browser's native Print → "Save as PDF" flow. No server-side
 * PDF render in v1 (no @react-pdf/renderer / puppeteer dependency added);
 * the page itself is print-stylesheet-friendly so the browser produces a
 * faithful PDF without an extra render pipeline.
 *
 * v2 (deferred 🔄):
 *  - Server-side PDF render (puppeteer-headless OR @react-pdf/renderer).
 *  - Scheduled email (cron + SMTP queue).
 *  - PPTX export (pptxgenjs).
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded border border-[#FFB800] bg-[#FFB800]/10 text-[#FFB800] px-3 py-1.5 text-sm hover:bg-[#FFB800]/20 print:hidden"
      aria-label="Print board snapshot to PDF"
    >
      <Printer size={14} aria-hidden="true" />
      Print to PDF
    </button>
  );
}
