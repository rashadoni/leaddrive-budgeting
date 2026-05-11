"use client";

/**
 * Phase 7.D — Panel 4 AI Variance Explainer.
 *
 * Wraps `POST /api/indicators/values/[id]/explain`. Triggered when the
 * user clicks "Explain →" in IndicatorDetail (Panel 3). EN/RU/AZ
 * language picker per `project_ai_output_language.md` — UI strings
 * stay English, only the LLM narrative + recommendations switch.
 *
 * Auto-runs on first load when an `activeIndicatorValueId` lands;
 * subsequent IV id changes also re-run. Re-running for the same IV is
 * a manual action (the Re-run button) so the user controls cost.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTerminalStore } from "../store/terminalStore";
import { CompanySnapshot } from "./CompanySnapshot";
import { statusShape } from "@/lib/risk/heatmap-matrix";

type Language = "en" | "ru" | "az";

interface ExplainResponse {
  indicatorValueId: string;
  narrative: string;
  recommendations: string[];
  confidence: number;
  topDrivers: string[];
  usage?: { inputTokens: number; outputTokens: number };
}

const LANGUAGE_OPTIONS: Array<{ value: Language; label: string }> = [
  { value: "en", label: "EN" },
  { value: "ru", label: "RU" },
  { value: "az", label: "AZ" },
];

export function VarianceExplainerPanel() {
  const t = useTranslations("terminal");
  const ivId = useTerminalStore((s) => s.activeIndicatorValueId);
  const activeCompanyCode = useTerminalStore((s) => s.activeCompanyCode);

  const [language, setLanguage] = useState<Language>("en");
  /** Mirrors `language` so the global Explain-trigger handler reads the
   *  current value at event time, not the value at subscription time
   *  (the handler closes over component state via deps; pinning to a ref
   *  avoids re-subscribing every keystroke). */
  const languageRef = React.useRef(language);
  React.useEffect(() => {
    languageRef.current = language;
  }, [language]);
  const [data, setData] = useState<ExplainResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Track which (ivId, language) combo `data` belongs to so swapping
   *  language doesn't render stale narrative. */
  const [stamp, setStamp] = useState<string | null>(null);

  /**
   * In-memory cache keyed by `ivId:lang`. Cell-click browsing through the
   * HeatMap can trigger many IV-id changes; without caching every click
   * would burn an LLM call. Cache is per-mount (cleared on component
   * unmount) — good enough for a session, not persisted to disk.
   */
  const cacheRef = React.useRef<Map<string, ExplainResponse>>(new Map());
  /** AbortController for the in-flight request. Prevents stale-resolve
   *  races when the user clicks rapidly through cells. */
  const abortRef = React.useRef<AbortController | null>(null);

  const run = useCallback(
    async (id: string, lang: Language, opts: { force?: boolean } = {}) => {
      const key = `${id}:${lang}`;
      if (!opts.force) {
        const cached = cacheRef.current.get(key);
        if (cached) {
          setData(cached);
          setStamp(key);
          setError(null);
          return;
        }
      }
      // Abort any in-flight call before firing a new one.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/indicators/values/${encodeURIComponent(id)}/explain`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ language: lang }),
            signal: controller.signal,
          },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(body.error || `HTTP ${res.status}`);
          setData(null);
          return;
        }
        const payload = body as ExplainResponse;
        cacheRef.current.set(key, payload);
        setData(payload);
        setStamp(key);
      } catch (err) {
        // AbortError is the expected user-clicked-elsewhere path — don't
        // surface as a real error.
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
        setData(null);
      } finally {
        if (abortRef.current === controller) {
          setLoading(false);
          abortRef.current = null;
        }
      }
    },
    [],
  );

  // Cell-click navigation alone does NOT trigger an LLM call. The user
  // must explicitly click "Explain →" in Panel 3, which dispatches a
  // `terminal:run-explainer` event. This avoids unbounded spend when the
  // CFO browses the HeatMap. If the IV-id changes without an explicit
  // trigger, we just clear stale state.
  useEffect(() => {
    if (!ivId) {
      abortRef.current?.abort();
      setData(null);
      setError(null);
      setStamp(null);
      return;
    }
    // If the new ivId already has a cached result for the current
    // language, render it (free — no LLM call).
    const key = `${ivId}:${language}`;
    const cached = cacheRef.current.get(key);
    if (cached) {
      setData(cached);
      setStamp(key);
      setError(null);
    } else if (stamp !== key) {
      // Different IV with no cache hit — clear panel content. Show empty
      // state until the user clicks Explain.
      setData(null);
      setError(null);
      setStamp(null);
    }
    // language intentionally NOT in deps — switching language without
    // Re-run shouldn't fire an LLM call. Re-run button or Explain
    // trigger is the only path that calls `run()`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ivId]);

  // Listen for the explicit Explain trigger from Panel 3.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string; language?: Language }>).detail;
      if (!detail?.id) return;
      void run(detail.id, detail.language ?? languageRef.current);
    };
    window.addEventListener("terminal:run-explainer", handler as EventListener);
    return () =>
      window.removeEventListener(
        "terminal:run-explainer",
        handler as EventListener,
      );
  }, [run]);

  if (!ivId) {
    // Phase B7 — when an active company IS set but no IV drilled down,
    // show a 3-card P&L margin snapshot (Gross / Net / OpEx) instead
    // of the bare instruction. Falls back to the original instruction
    // when no company is active.
    if (activeCompanyCode) {
      // Sub-36 cont'd Round-33 — `h-full w-full` on this wrapper so the
      // CompanySnapshot inside (which itself does `h-full`) actually
      // reaches the panel slot height. Without h-full here the wrapper
      // collapsed to content height, which is why the snapshot panel
      // had dead space at the bottom even after sub-36's CompanySnapshot
      // edits — the height-100% chain was broken at this layer.
      return (
        <div className="font-mono text-xs flex flex-col gap-2 h-full w-full">
          <div className="flex-1 min-h-0">
            <CompanySnapshot companyCode={activeCompanyCode} />
          </div>
          <div className="text-[10px] text-gray-700 leading-snug pt-1 border-t border-gray-800/40 shrink-0">
            <span className="text-gray-600">
              {t("varianceExplainer.shortHint")}{" "}
              <span className="text-[#FFB800]">{t("varianceExplainer.explainArrow")}</span>.
            </span>
          </div>
        </div>
      );
    }
    // Sub-36 cont'd Round-33 — empty-state placeholders now center
    // vertically + horizontally instead of top-anchoring. Without this
    // the panel slot has visible dead space below the 4-line text;
    // user feedback "тяни нижнию часть не тянется" was about content
    // not visually filling the slot. Centering anchors the text in
    // the visual center of the panel so the empty state feels
    // intentional rather than bug-like.
    return (
      <div
        data-testid="variance-explainer-empty"
        className="text-gray-700 font-mono text-xs leading-relaxed h-full w-full flex flex-col items-center justify-center text-center px-4"
      >
        <div>
          {t("varianceExplainer.pickCellPrefix")} <span className="text-[#FFB800]">{t("varianceExplainer.explainArrow")}</span>
          <br />
          <br />
          <span className="text-gray-600">
            {t("varianceExplainer.fullHint")}
          </span>
        </div>
      </div>
    );
  }
  // Have an ivId but no data yet — user hasn't pressed Explain. Show the
  // hint so the user knows the panel is alive and waiting.
  if (!data && !loading && !error) {
    return (
      <div
        data-testid="variance-explainer-no-data"
        className="text-gray-700 font-mono text-xs leading-relaxed h-full w-full flex flex-col items-center justify-center text-center px-4 gap-3"
      >
        <div>
          {t("varianceExplainer.clickPrefix")}{" "}
          <span className="text-[#FFB800]">{t("varianceExplainer.explainArrow")}</span>{" "}
          {t("varianceExplainer.clickInfix")}{" "}
          <span className="text-[#FFB800]">{t("varianceExplainer.reRun")}</span>{" "}
          {t("varianceExplainer.clickSuffix")}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">
            {t("varianceExplainer.runFor")}
          </span>
          <div role="radiogroup" className="flex border border-[#00D4AA]/50 rounded overflow-hidden text-[10px]">
            {LANGUAGE_OPTIONS.map((opt) => {
              const active = opt.value === language;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setLanguage(opt.value);
                    if (ivId) run(ivId, opt.value);
                  }}
                  className={`px-2 py-1 uppercase tracking-wider ${
                    active
                      ? "bg-[#00D4AA] text-[#050814] hover:bg-[#00E5BB]"
                      : "bg-transparent text-[#00D4AA] hover:bg-[#00D4AA]/10"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const confidencePct = data ? Math.round(data.confidence * 100) : null;
  const confidenceTone =
    data && data.confidence >= 0.7
      ? "#00D4AA"
      : data && data.confidence >= 0.5
      ? "#FFB020"
      : "#FF4757";
  // Tier-3 sub-29 M7 sweep — color-blind safe redundant signal for
  // confidence band. ≥0.7 → green ●; ≥0.5 → amber ▲; else red ■.
  const confidenceShape =
    data && data.confidence >= 0.7
      ? statusShape("green")
      : data && data.confidence >= 0.5
      ? statusShape("amber")
      : statusShape("red");

  return (
    <div className="font-mono text-[11px] text-gray-300 w-full h-full flex flex-col gap-2 overflow-auto">
      <header className="shrink-0 flex items-center justify-between gap-2 pb-1.5 border-b border-gray-800/60">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 uppercase tracking-wider text-[9px]">
            {t("varianceExplainer.title")}
          </span>
          {confidencePct !== null && (
            <span
              className="text-[10px] tabular-nums"
              style={{ color: confidenceTone }}
              title={t("varianceExplainer.confidenceTitle")}
            >
              <span aria-hidden="true" className="mr-0.5 opacity-70">
                {confidenceShape}
              </span>
              {confidencePct}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <div role="radiogroup" className="flex border border-gray-800 rounded overflow-hidden text-[10px]">
            {LANGUAGE_OPTIONS.map((opt) => {
              const active = opt.value === language;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setLanguage(opt.value)}
                  className={`px-1.5 py-0.5 ${
                    active
                      ? "bg-[#00D4AA]/20 text-[#00D4AA]"
                      : "text-gray-500 hover:bg-gray-800/40"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => ivId && run(ivId, language, { force: true })}
            disabled={loading || !ivId}
            className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-50"
            title={t("varianceExplainer.reRunTitle")}
          >
            {loading ? "…" : t("varianceExplainer.reRun")}
          </button>
        </div>
      </header>

      {loading && !data && (
        <span className="text-gray-700 text-[11px]">{t("varianceExplainer.askingModel")}</span>
      )}

      {error && (
        <div className="rounded border border-[#FF4757]/40 bg-[#FF4757]/10 px-2 py-1.5">
          <div className="text-[#FF4757] text-[10px] uppercase tracking-wider mb-0.5">
            {t("varianceExplainer.error")}
          </div>
          <div className="text-gray-200 text-[11px]">{error}</div>
        </div>
      )}

      {data && (
        <>
          <section>
            <div className="text-gray-500 uppercase tracking-wider text-[9px] mb-0.5">
              {t("varianceExplainer.narrative")}
            </div>
            <p className="text-gray-200 text-[12px] leading-snug">
              {data.narrative}
            </p>
          </section>

          <section>
            <div className="text-gray-500 uppercase tracking-wider text-[9px] mb-0.5">
              {t("varianceExplainer.recommendations")}
            </div>
            <ol className="list-none space-y-1.5">
              {data.recommendations.map((r, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-[11px] leading-snug"
                >
                  <span className="text-[#00D4AA] tabular-nums shrink-0">
                    {i + 1}.
                  </span>
                  <span className="text-gray-200">{r}</span>
                </li>
              ))}
            </ol>
          </section>

          {data.topDrivers.length > 0 && (
            <section>
              <div className="text-gray-500 uppercase tracking-wider text-[9px] mb-0.5">
                {t("varianceExplainer.topDrivers")}
              </div>
              <div className="flex flex-wrap gap-1">
                {data.topDrivers.map((d) => (
                  <span
                    key={d}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[#FFB800]/30 bg-[#FFB800]/10 text-[#FFB800]"
                  >
                    {d}
                  </span>
                ))}
              </div>
            </section>
          )}

          {data.usage && (
            <p className="text-gray-700 text-[9px] mt-auto pt-1">
              {t("varianceExplainer.tokens")}: {data.usage.inputTokens} {t("varianceExplainer.tokensIn")} / {data.usage.outputTokens} {t("varianceExplainer.tokensOut")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
