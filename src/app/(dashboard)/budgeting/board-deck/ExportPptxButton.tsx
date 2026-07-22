"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileDown, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Phase C3 v2 — PPTX export trigger for the Board Deck Generator.
 *
 * Companion to `PrintButton`: hits `/api/budgeting/board-deck/export-pptx`,
 * receives the binary blob, triggers a synthetic `<a download>` click,
 * revokes the object URL. No third-party download lib.
 *
 * Disabled during the in-flight fetch so a double-click can't fire two
 * generations concurrently. On error a small inline "Export failed"
 * label appears for the user; they can click again to retry.
 *
 * Threads the safe `?lang=` state from the
 * current page URL to the export route. The page narrative respects
 * these params (Turn LIII NarrativeLanguagePicker pushes `?lang=`); a
 * download triggered while reading the RU narrative MUST produce a RU
 * PPTX. Without this passthrough, a user on `?lang=ru` gets the EN
 * default — broken UX after Turn LIII shipped the picker.
 */
export function ExportPptxButton({ period }: { period: string }) {
  // `terminal.boardDeck.exports` — see ExportPdfButton note; bare
  // "boardDeck.exports" misses and renders raw keys.
  const t = useTranslations("terminal.boardDeck.exports");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("period", period);
      // Propagate language so a cached narrative matches the page. Export is
      // read-only and never forwards the legacy paid `regenerate` flag.
      // Only forward keys the route knows about (defensive — page
      // searchParams may carry unrelated query state).
      const lang = searchParams.get("lang");
      if (lang === "en" || lang === "ru" || lang === "az") {
        params.set("lang", lang);
      }
      const url = `/api/budgeting/board-deck/export-pptx?${params.toString()}`;
      const res = await fetch(url, { method: "GET", credentials: "include" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const dispo = res.headers.get("content-disposition") ?? "";
      const match = /filename="?([^";]+)"?/i.exec(dispo);
      const filename = match?.[1] ?? `board-deck-${period}.pptx`;
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
        className="inline-flex items-center gap-2 rounded border border-[#00D4AA] bg-[#00D4AA]/10 text-[#00D4AA] px-3 py-1.5 text-sm hover:bg-[#00D4AA]/20 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={t("pptxAriaLabel")}
      >
        {busy ? (
          <Loader2 size={14} aria-hidden="true" className="animate-spin" />
        ) : (
          <FileDown size={14} aria-hidden="true" />
        )}
        {busy ? t("pptxExporting") : t("pptxLabel")}
      </button>
      {error && (
        <span
          role="alert"
          className="text-xs text-[#FF4757]"
        >
          {error}
        </span>
      )}
    </div>
  );
}
