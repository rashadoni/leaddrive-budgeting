"use client";

/**
 * Phase Round-7 M2 — first-run hint overlay for the Risk Terminal.
 *
 * Bloomberg-trap avoided: instead of cryptic 200-verb function-code
 * culture, we surface a 5-second walkthrough on the user's FIRST visit
 * that names each panel + key command in plain language. After dismissal
 * (X or 10s auto-fade or click anywhere outside) the localStorage flag
 * sticks; the hint never re-renders for that browser. Reset for re-onboarding
 * via DevTools `localStorage.removeItem('terminal-welcome-hint-v1')`.
 *
 * Locale-aware: copy comes from `t('welcome.*')` so RU/AZ/EN switching
 * affects the hint immediately. Hint never blocks interaction — backdrop
 * is transparent + click-through.
 */

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

const STORAGE_KEY = "terminal-welcome-hint-v1";

function readSeenFromStorage(): boolean {
  if (typeof window === "undefined") return true; // SSR: don't render
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

function writeSeenToStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // localStorage disabled — accept silent failure (next session re-shows hint).
  }
}

export function WelcomeHint() {
  const t = useTranslations("terminal");
  const [open, setOpen] = useState(false);

  // Hydrate after mount so SSR + first paint don't show flash-then-hide.
  useEffect(() => {
    if (!readSeenFromStorage()) {
      setOpen(true);
    }
  }, []);

  // Auto-fade after 12s — long enough to read 5 lines, short enough not
  // to be a permanent eyesore for a user who didn't dismiss explicitly.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      writeSeenToStorage();
      setOpen(false);
    }, 12_000);
    return () => clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  const dismiss = () => {
    writeSeenToStorage();
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-label={t("welcome.title")}
      className="fixed top-20 right-6 z-40 max-w-sm font-mono text-[11px] animate-in fade-in slide-in-from-right-2 duration-300"
    >
      <div className="rounded-lg border border-[#00D4AA]/40 bg-[#0A0E27] shadow-2xl overflow-hidden">
        <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-800/60 bg-[#00D4AA]/10">
          <span className="text-[#00D4AA] uppercase tracking-wider font-semibold text-[10px]">
            {t("welcome.title")}
          </span>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("welcome.dismissAriaLabel")}
            autoFocus
            className="text-gray-500 hover:text-gray-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4AA] focus-visible:ring-offset-1 focus-visible:ring-offset-[#0A0E27] rounded"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </header>
        <ol className="px-3 py-2 space-y-1.5 text-gray-300">
          <li className="flex items-start gap-2">
            <span className="text-[#00D4AA] tabular-nums shrink-0">1.</span>
            <span>{t("welcome.step1")}</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#00D4AA] tabular-nums shrink-0">2.</span>
            <span>{t("welcome.step2")}</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#00D4AA] tabular-nums shrink-0">3.</span>
            <span>{t("welcome.step3")}</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#00D4AA] tabular-nums shrink-0">4.</span>
            <span>{t("welcome.step4")}</span>
          </li>
        </ol>
        <footer className="px-3 py-1.5 border-t border-gray-800/60 bg-[#050814]">
          <button
            type="button"
            onClick={dismiss}
            className="text-[10px] uppercase tracking-wider text-gray-500 hover:text-[#00D4AA] transition-colors"
          >
            {t("welcome.dismiss")}
          </button>
          <span className="text-[9px] text-gray-700 ml-2">
            {t("welcome.autoFade")}
          </span>
        </footer>
      </div>
    </div>
  );
}
