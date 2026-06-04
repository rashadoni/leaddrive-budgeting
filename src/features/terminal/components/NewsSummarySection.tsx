"use client";

/**
 * Phase 7.H Feature 1 — AI News Summary section inside Today's Brief.
 *
 * Polls /api/intel/news-summary on mount + when locale changes. Shows
 * 5 LLM-generated bullets summarizing the holding's news in the user's
 * language. Click bullet → opens /budgeting/intel for the full feed.
 */

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Newspaper, RefreshCw } from "lucide-react";

const POP_OUT_FEATURES = "width=600,height=700,resizable=yes,scrollbars=yes";

interface NewsSummary {
  bullets: string[];
  language: string;
  generatedAt: string;
  itemsConsumed: number;
  fromCache: boolean;
}

type State =
  | { kind: "loading" }
  | { kind: "loaded"; data: NewsSummary }
  | { kind: "error"; message: string }
  | { kind: "empty" };

export function NewsSummarySection() {
  const locale = useLocale() as "en" | "ru" | "az";
  const t = useTranslations("terminal");
  const [state, setState] = useState<State>({ kind: "loading" });

  const fetchSummary = async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/intel/news-summary?language=${locale}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setState({ kind: "error", message: body.error || `HTTP ${res.status}` });
        return;
      }
      const data = (await res.json()) as NewsSummary;
      if (data.bullets.length === 0) {
        setState({ kind: "empty" });
      } else {
        setState({ kind: "loaded", data });
      }
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  useEffect(() => {
    void fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  return (
    <section className="border-t border-gray-800/40 pt-2 mt-2" data-testid="today-brief-news">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-[#FFB800] text-[10px] uppercase tracking-wider">
          <Newspaper size={11} />
          <span>{t("todayBrief.newsHeader")}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchSummary}
            disabled={state.kind === "loading"}
            className="text-gray-600 hover:text-cyan-300 disabled:opacity-30 transition-colors"
            title={t("todayBrief.newsRefresh")}
          >
            <RefreshCw size={10} className={state.kind === "loading" ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              window.open(
                `/terminal-panel/news?language=${locale}`,
                "terminal-panel-news",
                POP_OUT_FEATURES,
              );
            }}
            className="text-gray-600 hover:text-cyan-300 transition-colors"
            title={t("todayBrief.newsPopOut")}
            aria-label={t("todayBrief.newsPopOut")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 3h6v6" />
              <path d="M10 14L21 3" />
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            </svg>
          </button>
        </div>
      </div>
      {state.kind === "loading" && (
        <p className="text-gray-700 text-[10px]">{t("todayBrief.newsLoading")}</p>
      )}
      {state.kind === "error" && (
        // Neutral, localized — never the raw provider error.
        <p className="text-gray-600 text-[10px] italic" role="alert">{t("aiUnavailable")}</p>
      )}
      {state.kind === "empty" && (
        <p className="text-gray-600 text-[10px] italic">{t("todayBrief.newsEmpty")}</p>
      )}
      {state.kind === "loaded" && (
        <ul className="space-y-1">
          {state.data.bullets.map((b, i) => (
            // 2026-05-28 — replaced banned `border-l-2 border-[#FFB800]/30`
            // side-stripe (impeccable absolute ban) with a leading bullet
            // dot in the brand amber. Same visual rhythm, no stripe.
            <li
              key={i}
              className="text-gray-300 text-[11px] leading-snug flex gap-2 hover:text-gray-100 cursor-pointer transition-colors"
              onClick={() => { window.location.href = "/budgeting/intel"; }}
            >
              <span
                aria-hidden="true"
                className="text-[#FFB800] shrink-0 select-none"
              >
                ·
              </span>
              <span>{b}</span>
            </li>
          ))}
          <li className="text-gray-700 text-[9px] mt-1">
            {state.data.fromCache ? t("todayBrief.newsCached") : t("todayBrief.newsFresh")}
            {" · "}
            {state.data.itemsConsumed} {t("todayBrief.newsItems")}
          </li>
        </ul>
      )}
    </section>
  );
}
