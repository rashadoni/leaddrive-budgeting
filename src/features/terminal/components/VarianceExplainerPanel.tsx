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
      return (
        <div className="font-mono text-xs flex flex-col gap-2">
          <CompanySnapshot companyCode={activeCompanyCode} />
          <div className="text-[10px] text-gray-700 leading-snug pt-1 border-t border-gray-800/40">
            <span className="text-gray-600">
              {t("varianceExplainer.shortHint")}{" "}
              <span className="text-[#FFB800]">{t("varianceExplainer.explainArrow")}</span>.
            </span>
          </div>
        </div>
      );
    }
    return (
      <div className="text-gray-700 font-mono text-xs leading-relaxed">
        {t("varianceExplainer.pickCellPrefix")} <span className="text-[#FFB800]">{t("varianceExplainer.explainArrow")}</span>
        <br />
        <br />
        <span className="text-gray-600">
          {t("varianceExplainer.fullHint")}
        </span>
      </div>
    );
  }
  // Have an ivId but no data yet — user hasn't pressed Explain. Show the
  // hint so the user knows the panel is alive and waiting.
  if (!data && !loading && !error) {
    return (
      <div className="text-gray-700 font-mono text-xs leading-relaxed">
        Click <span className="text-[#FFB800]">Explain →</span> in Panel 3 (or hit{" "}
        <span className="text-[#FFB800]">Re-run</span> below) to fetch the AI
        narrative for this cell.
        <br />
        <br />
        <button
          type="button"
          onClick={() => ivId && run(ivId, language)}
          className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-[#00D4AA] text-[#050814] hover:bg-[#00E5BB]"
        >
          Run for {language.toUpperCase()}
        </button>
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

  return (
    <div className="font-mono text-[11px] text-gray-300 w-full h-full flex flex-col gap-2 overflow-auto">
      <header className="shrink-0 flex items-center justify-between gap-2 pb-1.5 border-b border-gray-800/60">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 uppercase tracking-wider text-[9px]">
            Variance Explainer
          </span>
          {confidencePct !== null && (
            <span
              className="text-[10px] tabular-nums"
              style={{ color: confidenceTone }}
              title="LLM self-rated confidence (0-100%)"
            >
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
            title="Force a fresh LLM call (bypasses cache)"
          >
            {loading ? "…" : "Re-run"}
          </button>
        </div>
      </header>

      {loading && !data && (
        <span className="text-gray-700 text-[11px]">Asking the model…</span>
      )}

      {error && (
        <div className="rounded border border-[#FF4757]/40 bg-[#FF4757]/10 px-2 py-1.5">
          <div className="text-[#FF4757] text-[10px] uppercase tracking-wider mb-0.5">
            Error
          </div>
          <div className="text-gray-200 text-[11px]">{error}</div>
        </div>
      )}

      {data && (
        <>
          <section>
            <div className="text-gray-500 uppercase tracking-wider text-[9px] mb-0.5">
              Narrative
            </div>
            <p className="text-gray-200 text-[12px] leading-snug">
              {data.narrative}
            </p>
          </section>

          <section>
            <div className="text-gray-500 uppercase tracking-wider text-[9px] mb-0.5">
              Recommendations
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
                Top drivers
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
              tokens: {data.usage.inputTokens} in / {data.usage.outputTokens} out
            </p>
          )}
        </>
      )}
    </div>
  );
}
