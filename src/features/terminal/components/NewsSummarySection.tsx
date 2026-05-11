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
        <button
          type="button"
          onClick={fetchSummary}
          disabled={state.kind === "loading"}
          className="text-gray-600 hover:text-cyan-300 disabled:opacity-30 transition-colors"
          title={t("todayBrief.newsRefresh")}
        >
          <RefreshCw size={10} className={state.kind === "loading" ? "animate-spin" : ""} />
        </button>
      </div>
      {state.kind === "loading" && (
        <p className="text-gray-700 text-[10px]">{t("todayBrief.newsLoading")}</p>
      )}
      {state.kind === "error" && (
        <p className="text-[#FF4757] text-[10px]" role="alert">{state.message}</p>
      )}
      {state.kind === "empty" && (
        <p className="text-gray-600 text-[10px] italic">{t("todayBrief.newsEmpty")}</p>
      )}
      {state.kind === "loaded" && (
        <ul className="space-y-1">
          {state.data.bullets.map((b, i) => (
            <li
              key={i}
              className="text-gray-300 text-[11px] leading-snug pl-2 border-l-2 border-[#FFB800]/30 hover:border-[#FFB800] hover:text-gray-100 cursor-pointer transition-colors"
              onClick={() => { window.location.href = "/budgeting/intel"; }}
            >
              {b}
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
