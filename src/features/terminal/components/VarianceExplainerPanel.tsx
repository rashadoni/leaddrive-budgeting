"use client";

/**
 * Phase 7.D — Panel 4 AI Variance Explainer.
 *
 * Wraps `POST /api/indicators/values/[id]/explain`. Triggered when the
 * user clicks "Explain →" in IndicatorDetail (Panel 3). EN/RU/AZ
 * language picker per `project_ai_output_language.md` — UI strings
 * stay English, only the LLM narrative + recommendations switch.
 *
 * Runs only after an explicit Explain/Re-run action. Selecting or hovering
 * a cell never spends provider tokens, so the user controls cost.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { useTerminalStore } from "../store/terminalStore";
import { CompanySnapshot } from "./CompanySnapshot";
import { localizeFactCheckFlag } from "../lib/localize-fact-check";
import { statusShape } from "@/lib/risk/heatmap-matrix";

type Language = "en" | "ru" | "az";

interface FactCheckFlagShape {
  reason: string;
  claim: string;
  severity: "warn" | "info";
  suggestion: string;
  code?: "numberAbsent" | "numberUnmatched" | "futureYear";
  params?: Record<string, string | number>;
}

interface ExplainResponse {
  indicatorValueId: string;
  narrative: string;
  recommendations: string[];
  confidence: number;
  topDrivers: string[];
  usage?: { inputTokens: number; outputTokens: number };
  /** Phase 7.O C1 — programmatic narrative fact-check.
   *  Optional for back-compat with cached/older responses. */
  factCheck?: {
    flags: FactCheckFlagShape[];
    totalChecked: number;
    matched: number;
  };
}

const LANGUAGE_OPTIONS: Array<{ value: Language; label: string }> = [
  { value: "en", label: "EN" },
  { value: "ru", label: "RU" },
  { value: "az", label: "AZ" },
];

export interface VarianceExplainerHandle {
  runFromExplicitAction: (id: string) => void;
}

export const VarianceExplainerPanel = forwardRef<VarianceExplainerHandle>(
function VarianceExplainerPanel(_props, ref) {
  const t = useTranslations("terminal");
  const ivId = useTerminalStore((s) => s.activeIndicatorValueId);
  const activeCompanyCode = useTerminalStore((s) => s.activeCompanyCode);

  /**
   * 2026-08-04 — the picker used to start on "en" whatever the interface was
   * set to, so an Azerbaijani reader got an English narrative and had to press
   * AZ every single time. The panel already sits inside a localized app; the
   * language it reads is not a fresh question.
   *
   * Still a picker, not a mirror: the owner reads all three, and switching to
   * compare wordings is a real use. This only fixes where it STARTS.
   */
  const uiLocale = useLocale();
  const [language, setLanguage] = useState<Language>(() =>
    LANGUAGE_OPTIONS.some((option) => option.value === uiLocale)
      ? (uiLocale as Language)
      : "en",
  );
  const [data, setData] = useState<ExplainResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
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
      setErrorCode(null);
      try {
        const res = await fetch(
          `/api/indicators/values/${encodeURIComponent(id)}/explain`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ language: lang, userInitiated: true }),
            signal: controller.signal,
          },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(body.error || `HTTP ${res.status}`);
          setErrorCode(typeof body.code === "string" ? body.code : null);
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
  // must explicitly click "Explain →" in Panel 3. This avoids unbounded
  // spend when the CFO browses the HeatMap. If the IV-id changes without
  // an explicit trigger, we just clear stale state.
  useEffect(() => {
    if (!ivId) {
      abortRef.current?.abort();
      setData(null);
      setError(null);
      setErrorCode(null);
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
      setErrorCode(null);
      setStamp(null);
    }
    // language intentionally NOT in deps — switching language without
    // Re-run shouldn't fire an LLM call. Re-run button or Explain
    // trigger is the only path that calls `run()`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ivId]);

  // Panel 3 reaches this method through a React ref owned by PanelGrid.
  // There is deliberately no global CustomEvent bridge: arbitrary scripts
  // must not be able to forge an event that spends paid-provider tokens.
  useImperativeHandle(
    ref,
    () => ({
      runFromExplicitAction(id: string) {
        if (id !== ivId) return;
        void run(id, language);
      },
    }),
    [ivId, language, run],
  );

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
          <div className="text-[10px] text-muted-foreground leading-snug pt-1 border-t border-border/40 shrink-0">
            <span className="text-muted-foreground">
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
        className="text-muted-foreground font-mono text-xs leading-relaxed h-full w-full flex flex-col items-center justify-center text-center px-4"
      >
        <div>
          {t("varianceExplainer.pickCellPrefix")} <span className="text-[#FFB800]">{t("varianceExplainer.explainArrow")}</span>
          <br />
          <br />
          <span className="text-muted-foreground">
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
        className="text-muted-foreground font-mono text-xs leading-relaxed h-full w-full flex flex-col items-center justify-center text-center px-4 gap-3"
      >
        <div>
          {t("varianceExplainer.clickPrefix")}{" "}
          <span className="text-[#FFB800]">{t("varianceExplainer.explainArrow")}</span>{" "}
          {t("varianceExplainer.clickInfix")}{" "}
          <span className="text-[#FFB800]">{t("varianceExplainer.reRun")}</span>{" "}
          {t("varianceExplainer.clickSuffix")}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("varianceExplainer.runFor")}
          </span>
          <div role="radiogroup" className="flex border border-emerald-500/50 rounded overflow-hidden text-[10px]">
            {LANGUAGE_OPTIONS.map((opt) => {
              const active = opt.value === language;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setLanguage(opt.value);
                    if (ivId) run(ivId, opt.value);
                  }}
                  className={`px-2 py-1 uppercase tracking-wider ${
                    active
                      ? "bg-emerald-600 text-white hover:bg-emerald-600"
                      : "bg-transparent text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
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
    <div className="font-mono text-[11px] text-muted-foreground w-full h-full flex flex-col gap-2 overflow-auto">
      <header className="shrink-0 flex items-center justify-between gap-2 pb-1.5 border-b border-border/60">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground uppercase tracking-wider text-[9px]">
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
          <div role="radiogroup" className="flex border border-border rounded overflow-hidden text-[10px]">
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
                      ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground hover:bg-muted/50/40"
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
            className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-muted/50 text-muted-foreground hover:bg-gray-700 disabled:opacity-50"
            title={t("varianceExplainer.reRunTitle")}
          >
            {loading ? "…" : t("varianceExplainer.reRun")}
          </button>
        </div>
      </header>

      {loading && !data && (
        <span className="text-muted-foreground text-[11px]">{t("varianceExplainer.askingModel")}</span>
      )}

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5">
          <div className="text-red-600 dark:text-red-400 text-[10px] uppercase tracking-wider mb-0.5">
            {errorCode === "STATUS_NOT_EXPLAINABLE"
              ? t("varianceExplainer.greenNoVariance.title")
              : t("varianceExplainer.error")}
          </div>
          <div className="text-gray-200 text-[11px]">
            {errorCode === "STATUS_NOT_EXPLAINABLE"
              ? t("varianceExplainer.greenNoVariance.body")
              : /* Neutral copy — never the raw provider error (route now
                   returns a sanitized code). */
                t("aiUnavailable")}
          </div>
        </div>
      )}

      {data && (
        <>
          <section>
            <div className="text-muted-foreground uppercase tracking-wider text-[9px] mb-0.5">
              {t("varianceExplainer.narrative")}
            </div>
            <p className="text-gray-200 text-[12px] leading-snug">
              {data.narrative}
            </p>
            {data.factCheck && data.factCheck.flags.length > 0 && (
              <div
                className="mt-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5"
                role="status"
                aria-live="polite"
              >
                <div className="text-amber-600 dark:text-amber-400 text-[10px] uppercase tracking-wider mb-0.5 flex items-center gap-1.5">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M8 1.5A6.5 6.5 0 1 0 8 14.5 6.5 6.5 0 0 0 8 1.5zm.75 9.5h-1.5v-1.5h1.5V11zm0-3h-1.5V5h1.5v3z" />
                  </svg>
                  {t("varianceExplainer.factCheck.title")}
                </div>
                <ul className="space-y-1">
                  {data.factCheck.flags.map((f, i) => {
                    const localized = localizeFactCheckFlag(f, t);
                    return (
                      <li key={i} className="text-[10px] leading-snug text-gray-200">
                        <span className="font-mono px-1 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
                          {f.claim}
                        </span>{" "}
                        — {localized.reason}{" "}
                        <span className="text-muted-foreground">
                          {localized.suggestion}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-muted-foreground text-[9px] mt-1">
                  {t("varianceExplainer.factCheck.summary", {
                    matched: data.factCheck.matched,
                    total: data.factCheck.totalChecked,
                  })}
                </p>
              </div>
            )}
            {data.factCheck &&
              data.factCheck.flags.length === 0 &&
              data.factCheck.totalChecked > 0 && (
                <p className="mt-1 text-[9px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.5 6.5a.75.75 0 0 1-1.06 0L2.72 8.28a.75.75 0 1 1 1.06-1.06L6.75 10.19l5.97-5.97a.75.75 0 0 1 1.06 0z" />
                  </svg>
                  {t("varianceExplainer.factCheck.allMatched", {
                    total: data.factCheck.totalChecked,
                  })}
                </p>
              )}
          </section>

          <section>
            <div className="text-muted-foreground uppercase tracking-wider text-[9px] mb-0.5">
              {t("varianceExplainer.recommendations")}
            </div>
            <ol className="list-none space-y-1.5">
              {data.recommendations.map((r, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-[11px] leading-snug"
                >
                  <span className="text-emerald-600 dark:text-emerald-400 tabular-nums shrink-0">
                    {i + 1}.
                  </span>
                  <span className="text-gray-200">{r}</span>
                </li>
              ))}
            </ol>
          </section>

          {data.topDrivers.length > 0 && (
            <section>
              <div className="text-muted-foreground uppercase tracking-wider text-[9px] mb-0.5">
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
            <p className="text-muted-foreground text-[9px] mt-auto pt-1">
              {t("varianceExplainer.tokens")}: {data.usage.inputTokens} {t("varianceExplainer.tokensIn")} / {data.usage.outputTokens} {t("varianceExplainer.tokensOut")}
            </p>
          )}
        </>
      )}
    </div>
  );
});

VarianceExplainerPanel.displayName = "VarianceExplainerPanel";
