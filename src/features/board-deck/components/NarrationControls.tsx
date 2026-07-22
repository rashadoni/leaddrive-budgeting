"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import type { NarrationLanguage } from "@/lib/board-deck/narrate-snapshot";
import { NarrativeLanguagePicker } from "./NarrativeLanguagePicker";

export interface NarrationControlsProps {
  period: string;
  language: NarrationLanguage;
  canGenerate: boolean;
  hasNarration: boolean;
  isStale: boolean;
}

export function NarrationControls({
  period,
  language,
  canGenerate,
  hasNarration,
  isStale,
}: NarrationControlsProps) {
  const t = useTranslations("terminal.boardDeck.narrativeControls");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (busy || !canGenerate) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/budgeting/board-deck/narration", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userInitiated: true,
          period,
          language,
          regenerate: hasNarration,
        }),
      });
      if (!res.ok) {
        throw new Error(t("error"));
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-testid="board-deck-guide-ai-boundary"
      aria-label={t("ariaLabel")}
      className="rounded-lg border border-border bg-card px-6 py-5 print:hidden"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {t("eyebrow")}
          </p>
          <p className="mt-1 text-sm text-foreground/85">
            {hasNarration
              ? isStale
                ? t("stale")
                : t("cached")
              : t("absent")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t("costDisclosure")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NarrativeLanguagePicker currentLanguage={language} />
          {canGenerate && (
            <button
              type="button"
              data-testid="board-deck-generate-narrative"
              onClick={generate}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md border border-[#7D55C7]/60 bg-[#7D55C7]/10 px-3 py-1.5 text-sm font-medium text-[#7D55C7] hover:bg-[#7D55C7]/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles size={14} aria-hidden="true" />
              )}
              {busy
                ? t("generating")
                : hasNarration
                  ? t("regenerate")
                  : t("generate")}
            </button>
          )}
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
    </section>
  );
}
