"use client";

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

/**
 * Phase 7.G Turn XLVII (Phase E.1) — server-side PDF export button.
 *
 * Sibling to `ExportPptxButton`: hits `/api/budgeting/board-deck/export-pdf`,
 * receives the binary blob, triggers a synthetic `<a download>` click,
 * revokes the object URL. Same disabled-during-fetch + retry-on-error
 * UX contract.
 *
 * Why this is separate from the existing `PrintButton`: PrintButton
 * uses the browser's native `window.print()` flow which depends on
 * the user manually selecting "Save as PDF" from the print dialog.
 * This button delivers a single-click downloadable PDF rendered by
 * server-side headless Chromium — no user interaction with the print
 * dialog, identical output across browsers, includes the AI summary
 * if requested.
 */
export function ExportPdfButton({ period }: { period: string }) {
  // Namespace is `terminal.boardDeck.exports` — board-deck i18n lives under the
  // `terminal` root (FooterActions + all sibling sections use
  // getTranslations("terminal")). The bare "boardDeck.exports" missed (root
  // `boardDeck` is only the nav-label string) → the button rendered RAW keys
  // ("pdfLabel" / "pdfAriaLabel") to the client. (terminal-audit E2E follow-up.)
  const t = useTranslations("terminal.boardDeck.exports");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ period });
      const language = searchParams.get("lang");
      if (language === "en" || language === "ru" || language === "az") {
        params.set("lang", language);
      }
      const url = `/api/budgeting/board-deck/export-pdf?${params.toString()}`;
      const res = await fetch(url, { method: "GET", credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.message ?? body.error ?? `HTTP ${res.status}`,
        );
      }
      const blob = await res.blob();
      const dispo = res.headers.get("content-disposition") ?? "";
      const match = /filename="?([^";]+)"?/i.exec(dispo);
      const filename = match?.[1] ?? `board-deck-${period}.pdf`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorFallback"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 print:hidden">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded border border-[#00B4D8] bg-[#00B4D8]/10 text-[#00B4D8] px-3 py-1.5 text-sm hover:bg-[#00B4D8]/20 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={t("pdfAriaLabel")}
      >
        {busy ? (
          <Loader2 size={14} aria-hidden="true" className="animate-spin" />
        ) : (
          <FileText size={14} aria-hidden="true" />
        )}
        {busy ? t("pdfRendering") : t("pdfLabel")}
      </button>
      {error && (
        <span role="alert" className="text-xs text-[#FF4757]">
          {error}
        </span>
      )}
    </div>
  );
}
