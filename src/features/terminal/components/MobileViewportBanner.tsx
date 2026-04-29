"use client";

/**
 * Tier-3 sub-30 Stage 3f — M8-lite (mobile-narrow viewport advisory).
 *
 * The full M8 (mobile-responsive PanelGrid refactor with viewport-detect
 * branch + tabbed/swipeable single-panel mode + new TabBar component) is
 * a 1-2 day refactor that demo +1 day cannot absorb without regression
 * risk to the desktop PanelGrid (the demo's primary surface). Tracked as
 * a separate 🔄 in CARRYOVER for post-demo Tier-3 sprint.
 *
 * M8-lite scope (this component, ~30 min):
 * - Detect viewport < 1024px via CSS media query (`md:` breakpoint
 *   threshold in Tailwind = 768px; we use a slightly higher threshold
 *   1024px because the 4-panel grid needs ~250px per panel minimum).
 * - Render an advisory banner above the terminal: "Risk Terminal is
 *   optimized for ≥1024px viewports. Some panels may not display fully
 *   on this screen."
 * - Dismissable with localStorage flag (key
 *   `terminal-mobile-banner-dismissed-v1`) so users who acknowledge
 *   don't see it again.
 * - Locale-aware via i18n (`mobileBanner.*` namespace).
 * - Hidden on viewports ≥1024px regardless of dismissal state.
 *
 * Why CSS-media-query and not JS `useMediaQuery`: media-query CSS works
 * in SSR (server doesn't know viewport) without hydration flash; JS
 * approach risks server/client divergence + extra useEffect overhead.
 * The banner just sets `hidden md:hidden` Tailwind classes that hide it
 * at viewport ≥1024px (md breakpoint threshold).
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

const STORAGE_KEY = "terminal-mobile-banner-dismissed-v1";

function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // localStorage disabled — banner re-shows on next session, that's fine.
  }
}

export function MobileViewportBanner() {
  const t = useTranslations("terminal");
  /** Mounted-flag for SSR-safe localStorage hydration. Server renders
   *  the banner conservatively (visible on narrow viewports); client
   *  hides it after mount if user dismissed previously. */
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDismissed(readDismissed());
  }, []);

  if (mounted && dismissed) return null;

  const handleDismiss = () => {
    writeDismissed();
    setDismissed(true);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t("mobileBanner.ariaLabel")}
      data-testid="mobile-viewport-banner"
      // Tailwind `lg:hidden` = display:none at viewport ≥1024px. On
      // smaller viewports the banner remains visible (≤1023px).
      className="lg:hidden bg-[#FFB020]/15 border-b border-[#FFB020]/40 text-[#FFB020] text-[11px] px-3 py-1.5 flex items-center justify-between gap-2"
    >
      <span className="flex-1 leading-snug">{t("mobileBanner.text")}</span>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={t("mobileBanner.dismissAriaLabel")}
        className="text-[#FFB020] hover:text-[#FFD060] shrink-0 px-1 rounded"
        data-testid="mobile-viewport-banner-dismiss"
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
