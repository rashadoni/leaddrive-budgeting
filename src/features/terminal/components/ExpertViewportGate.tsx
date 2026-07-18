"use client";

import Link from "next/link";
import { ArrowLeft, MonitorUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useSyncExternalStore } from "react";

const EXPERT_VIEWPORT_QUERY = "(min-width: 768px)";

function subscribeToViewport(onStoreChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};

  const mediaQuery = window.matchMedia(EXPERT_VIEWPORT_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getViewportSnapshot() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.(EXPERT_VIEWPORT_QUERY).matches);
}

function getServerViewportSnapshot() {
  return false;
}

/**
 * Keeps the desktop-only Expert surface out of the mobile render tree.
 *
 * CSS owns first paint: mobile sees the in-flow fallback, while desktop sees
 * a layout-preserving placeholder until hydration resolves the media query.
 * This avoids both a hydration mismatch and mobile background requests from
 * the four Expert panels.
 */
export function ExpertViewportGate({ children }: { children: ReactNode }) {
  const t = useTranslations("terminal.v2.mobileExpert");
  const supportsExpert = useSyncExternalStore(
    subscribeToViewport,
    getViewportSnapshot,
    getServerViewportSnapshot,
  );

  return (
    <>
      <section
        aria-labelledby="mobile-expert-title"
        data-testid="expert-mobile-fallback"
        className="flex flex-1 flex-col justify-center bg-[#050814] px-6 py-10 text-slate-100 md:hidden"
      >
        <div className="mx-auto w-full max-w-md">
          <div
            aria-hidden="true"
            className="mb-6 flex h-12 w-12 items-center justify-center rounded-lg border border-[#00D4AA]/35 bg-[#00D4AA]/10 text-[#00D4AA]"
          >
            <MonitorUp className="h-6 w-6" />
          </div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#00D4AA]">
            {t("eyebrow")}
          </p>
          <h1 id="mobile-expert-title" className="text-2xl font-semibold leading-8 text-slate-50">
            {t("title")}
          </h1>
          <p className="mt-3 max-w-[65ch] text-base leading-6 text-slate-300">
            {t("description")}
          </p>
          <p className="mt-2 max-w-[65ch] text-sm leading-5 text-slate-400">
            {t("availability")}
          </p>
          <Link
            href="/budgeting"
            className="mt-8 inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-100 transition-colors hover:border-[#00D4AA]/60 hover:bg-[#00D4AA]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4AA] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050814]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t("backToBudgeting")}
          </Link>
        </div>
      </section>

      {supportsExpert ? (
        <div data-testid="expert-desktop-content" className="hidden min-h-0 flex-1 flex-col md:flex">
          {children}
        </div>
      ) : (
        <div
          aria-hidden="true"
          data-testid="expert-desktop-placeholder"
          className="hidden min-h-0 flex-1 bg-[#050814] md:flex"
        />
      )}
    </>
  );
}
