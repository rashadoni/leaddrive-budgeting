"use client";

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";

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
 */
export function ExportPptxButton({ period }: { period: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const url = `/api/budgeting/board-deck/export-pptx?period=${encodeURIComponent(
        period,
      )}`;
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
      setError(e instanceof Error ? e.message : "Export failed");
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
        aria-label="Export board snapshot to PPTX"
      >
        {busy ? (
          <Loader2 size={14} aria-hidden="true" className="animate-spin" />
        ) : (
          <FileDown size={14} aria-hidden="true" />
        )}
        {busy ? "Exporting…" : "Export PPTX"}
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
