"use client";

/**
 * Phase 7.G Turn LIII — Narrative-language picker for the Board Deck.
 *
 * Pre-LIII: AI narrative language was driven by `getLocale()` + optional
 * `?lang=` query param (no UI affordance). User flagged that the page
 * surfaces RU narrative without giving readers a way to flip between
 * EN/RU/AZ on demand.
 *
 * This client component sits in the NarrativeSection eyebrow row,
 * mirroring the IndicatorDetail forecast-language picker pattern
 * (3 small mono buttons; active = lavender border, idle = muted) but
 * with router-push semantics so the server snapshot can re-resolve
 * `narrationLanguage` and `getOrCreateNarration` can return the cached
 * row for the new language (or LLM-call on first switch — same 24h
 * cache window per language).
 *
 * Why router-push instead of client-side language state:
 *   - The narrative is built server-side (`runNarration` → cache row).
 *     Each `(orgId, period, snapshotHash, language)` is a separate
 *     cache row; flipping language MUST round-trip to the server.
 *   - The page is bookmarkable + shareable; the URL must reflect the
 *     reader's chosen language so a CFO can send the link as RU and
 *     the recipient sees RU regardless of their browser locale.
 *
 * Cache cost: each language flip on a fresh snapshot costs ~$0.05 +
 * 10-30s (LLM call). After 3 flips per snapshot, all 3 languages are
 * cached → subsequent flips are instant from cache (24h TTL).
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

const LANGUAGES = ["en", "ru", "az"] as const;
type NarrationLanguage = (typeof LANGUAGES)[number];

export interface NarrativeLanguagePickerProps {
  currentLanguage: NarrationLanguage;
}

export function NarrativeLanguagePicker({
  currentLanguage,
}: NarrativeLanguagePickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("terminal");
  const [isPending, startTransition] = useTransition();

  function switchLanguage(lang: NarrationLanguage) {
    if (lang === currentLanguage || isPending) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("lang", lang);
    // Drop `regenerate` if present — the user is switching language,
    // not asking for a fresh LLM call on the current language. The
    // new language has its own cache key; let the cache-hit path run.
    next.delete("regenerate");
    const query = next.toString();
    startTransition(() => {
      router.push(query.length > 0 ? `${pathname}?${query}` : pathname);
    });
  }

  return (
    <div
      role="group"
      aria-label={t("boardDeck.narrative.languagePickerAriaLabel")}
      data-testid="narrative-language-picker"
      className="inline-flex items-center gap-1 print:hidden"
    >
      {LANGUAGES.map((lang) => {
        const isActive = lang === currentLanguage;
        return (
          <button
            key={lang}
            type="button"
            onClick={() => switchLanguage(lang)}
            disabled={isPending}
            data-testid={`narrative-lang-${lang}`}
            aria-pressed={isActive}
            className={`text-[10px] uppercase font-mono px-2 py-1 rounded border tracking-wider transition-colors ${
              isActive
                ? "border-[#7D55C7] text-[#7D55C7] bg-[#7D55C7]/10"
                : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground/70"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {lang}
          </button>
        );
      })}
    </div>
  );
}
