"use client"

/**
 * Phase 7.E AI Morning Brief — narrative intro for Today's Brief panel.
 *
 * POSTs the already-derived worst/movers/alerts + last news bullets to
 * /api/intel/morning-brief and renders the LLM-composed:
 *   - headline (one-line "what matters most today")
 *   - narrative (2 short paragraphs)
 *   - priorityAction (single actionable next step)
 *
 * Sits at the top of TodayBrief, above the existing 4 derived sections.
 */

import { useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Sparkles, RefreshCw } from "lucide-react"

interface BriefInputs {
  worstCells: Array<{
    companyCode: string
    indicatorCode: string
    value: number
    unit: string
  }>
  topMovers: Array<{
    companyCode: string
    indicatorCode: string
    deltaPct: number
  }>
  activeAlerts: Array<{
    severity: "info" | "warning" | "critical"
    message: string
  }>
}

interface BriefResponse {
  headline?: string
  narrative?: string
  priorityAction?: string
  isEmpty?: boolean
  fromCache?: boolean
  generatedAt?: string
  error?: string
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; data: BriefResponse }
  | { kind: "empty" }
  | { kind: "error"; message: string }

interface Props {
  inputs: BriefInputs
  /** True once the matrix has loaded — gates the LLM call so we never
   *  fire the morning brief with empty worst/movers/alerts just because
   *  the matrix is still fetching. Without this guard the brief fires on
   *  first render (empty arrays), gets a "calm morning" from the LLM,
   *  then re-fires when real data arrives — two LLM calls, first one
   *  always wrong. */
  matrixReady?: boolean
}

export function MorningBriefIntro({ inputs, matrixReady = true }: Props) {
  const locale = useLocale() as "en" | "ru" | "az"
  const t = useTranslations("terminal")
  const [state, setState] = useState<State>({ kind: "idle" })
  const lastSigRef = useRef<string>("")

  const fetchBrief = async () => {
    setState({ kind: "loading" })
    try {
      // Pull latest news bullets from the news-summary endpoint —
      // already-cached for the org, so no duplicate LLM cost.
      let newsBullets: string[] = []
      try {
        const newsRes = await fetch(
          `/api/intel/news-summary?language=${locale}`,
          { cache: "no-store" },
        )
        if (newsRes.ok) {
          const newsData = (await newsRes.json()) as { bullets?: string[] }
          newsBullets = Array.isArray(newsData.bullets) ? newsData.bullets : []
        }
      } catch {
        // News fetch failure is non-fatal — brief works without it.
      }

      const res = await fetch("/api/intel/morning-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: locale,
          worstCells: inputs.worstCells,
          topMovers: inputs.topMovers,
          activeAlerts: inputs.activeAlerts,
          newsBullets,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setState({ kind: "error", message: body.error || `HTTP ${res.status}` })
        return
      }
      const data = (await res.json()) as BriefResponse
      if (data.isEmpty) {
        setState({ kind: "empty" })
      } else {
        setState({ kind: "loaded", data })
      }
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  useEffect(() => {
    // Don't fire until the matrix has loaded — prevents "calm morning"
    // false-positive when worst/movers are still empty because the matrix
    // fetch hasn't returned yet.
    if (!matrixReady) return
    // Re-fetch only when the input signature actually changes — avoids
    // useEffect loops on every parent re-render.
    const sig = JSON.stringify({
      w: inputs.worstCells.length,
      m: inputs.topMovers.length,
      a: inputs.activeAlerts.length,
      l: locale,
    })
    if (sig !== lastSigRef.current) {
      lastSigRef.current = sig
      void fetchBrief()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrixReady, inputs.worstCells.length, inputs.topMovers.length, inputs.activeAlerts.length, locale])

  return (
    <section
      className="rounded border border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-transparent p-3"
      data-testid="morning-brief-intro"
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-cyan-300 text-[10px] uppercase tracking-wider">
          <Sparkles size={11} />
          <span>{t("morningBrief.header")}</span>
        </div>
        <button
          type="button"
          onClick={fetchBrief}
          disabled={state.kind === "loading"}
          className="text-gray-600 hover:text-cyan-300 disabled:opacity-30 transition-colors"
          title={t("morningBrief.refresh")}
        >
          <RefreshCw
            size={10}
            className={state.kind === "loading" ? "animate-spin" : ""}
          />
        </button>
      </div>

      {state.kind === "loading" && (
        <p className="text-gray-700 text-[10px]">{t("morningBrief.loading")}</p>
      )}
      {state.kind === "error" && (
        <p className="text-[#FF4757] text-[10px]" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === "empty" && (
        <p className="text-gray-500 text-[11px] italic">
          {t("morningBrief.calmMorning")}
        </p>
      )}
      {state.kind === "loaded" && state.data.headline && (
        <div className="space-y-1.5">
          <h4 className="text-cyan-100 text-[12px] font-semibold leading-snug">
            {state.data.headline}
          </h4>
          {state.data.narrative && (
            <p className="text-gray-300 text-[10.5px] leading-relaxed whitespace-pre-line">
              {state.data.narrative}
            </p>
          )}
          {state.data.priorityAction && (
            <div className="flex items-start gap-1.5 mt-2 pt-1.5 border-t border-cyan-500/15">
              <span className="text-[#00D4AA] text-[9px] uppercase tracking-wider font-semibold mt-0.5">
                →
              </span>
              <p className="text-[#00D4AA] text-[10.5px] leading-snug flex-1">
                {state.data.priorityAction}
              </p>
            </div>
          )}
          <p className="text-gray-700 text-[8.5px] mt-1">
            {state.data.fromCache
              ? t("morningBrief.cached")
              : t("morningBrief.fresh")}
          </p>
        </div>
      )}
    </section>
  )
}
