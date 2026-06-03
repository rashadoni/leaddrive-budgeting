"use client";

import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Phase C3 v1 — print trigger for the Board Deck Generator.
 *
 * v1 uses the browser's native Print → "Save as PDF" flow. No server-side
 * PDF render in v1 (no @react-pdf/renderer / puppeteer dependency added);
 * the page itself is print-stylesheet-friendly so the browser produces a
 * faithful PDF without an extra render pipeline.
 *
 * v2 status:
 *  - Server-side PDF render (puppeteer-headless OR @react-pdf/renderer)
 *    — still deferred 🔄.
 *  - Scheduled email (cron + SMTP queue) — Phase 6 BullMQ-gated 🔄.
 *  - PPTX export — shipped Phase 7.G (`ExportPptxButton.tsx` →
 *    `/api/budgeting/board-deck/export-pptx`).
 */
export function PrintButton() {
  // `terminal.boardDeck.exports` — see ExportPdfButton note; bare
  // "boardDeck.exports" misses and renders raw keys.
  const t = useTranslations("terminal.boardDeck.exports");
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded border border-[#FFB800] bg-[#FFB800]/10 text-[#FFB800] px-3 py-1.5 text-sm hover:bg-[#FFB800]/20 print:hidden"
      aria-label={t("printAriaLabel")}
    >
      <Printer size={14} aria-hidden="true" />
      {t("printLabel")}
    </button>
  );
}
