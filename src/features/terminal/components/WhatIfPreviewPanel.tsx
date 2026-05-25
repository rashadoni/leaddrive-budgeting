"use client"

/**
 * Phase 7.E ad-hoc Scenario "What-If" preview panel.
 *
 * Bloomberg-style overlay: 4 sliders for FX rates (USD, EUR, TRY, RUB),
 * "Preview" button → POST /api/indicators/matrix/preview, side-by-side
 * baseline-vs-scenario table grouped by company. Pure preview — never
 * writes to DB.
 *
 * Opens on `terminal:open-whatif` window event (HotkeyToolbar
 * "WHAT-IF" button OR future CommandBar `WHAT GO` verb).
 *
 * Sister overlay to ScenarioPanel (preset catalog) and BreachForecastPanel
 * (predictive breaches) — same modal frame, same close + Esc behavior.
 */

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { FlaskConical, X, Play } from "lucide-react"
import { currentBakuYear } from "@/lib/risk/periods"

interface PreviewCell {
  companyId: string
  companyCode: string
  indicatorId: string
  indicatorCode: string
  unit: string
  baselineValue: number | null
  baselineStatus: "green" | "amber" | "red" | "unknown" | null
  scenarioValue: number | null
  scenarioStatus: "green" | "amber" | "red" | "unknown" | null
  deltaPct: number | null
}

interface PreviewResponse {
  period: string
  overrides: Record<string, number>
  affectedIndicatorCount: number
  pairsAttempted?: number
  pairsErrored?: number
  lastError?: string | null
  cells: PreviewCell[]
  error?: string
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; data: PreviewResponse }
  | { kind: "error"; message: string }

const FX_DEFAULTS = { fx_usd: 1.7, fx_eur: 1.85, fx_try: 0.05, fx_rub: 0.018 }

const STATUS_PILL: Record<NonNullable<PreviewCell["baselineStatus"]>, string> =
  {
    green: "bg-emerald-500/15 text-emerald-400",
    amber: "bg-amber-500/15 text-amber-400",
    red: "bg-red-500/15 text-red-400",
    unknown: "bg-slate-500/15 text-slate-400",
  }

function formatValue(v: number | null, unit: string): string {
  if (v === null || !Number.isFinite(v)) return "—"
  if (unit === "%") return `${v.toFixed(1)}%`
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return v.toFixed(2)
}

export function WhatIfPreviewPanel() {
  const t = useTranslations("terminal")
  const [open, setOpen] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, number>>(FX_DEFAULTS)
  const [state, setState] = useState<State>({ kind: "idle" })
  const period = currentBakuYear()

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener("terminal:open-whatif", onOpen)
    return () => window.removeEventListener("terminal:open-whatif", onOpen)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  const runPreview = useCallback(async () => {
    setState({ kind: "loading" })
    try {
      const res = await fetch("/api/indicators/matrix/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, overrides }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as PreviewResponse
        setState({
          kind: "error",
          message: body.error || `HTTP ${res.status}`,
        })
        return
      }
      const data = (await res.json()) as PreviewResponse
      setState({ kind: "loaded", data })
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }, [overrides, period])

  if (!open) return null

  const cellsByCompany = new Map<string, PreviewCell[]>()
  if (state.kind === "loaded") {
    for (const c of state.data.cells) {
      const arr = cellsByCompany.get(c.companyCode) ?? []
      arr.push(c)
      cellsByCompany.set(c.companyCode, arr)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("whatif.dialogAriaLabel")}
      data-testid="whatif-preview-panel"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div className="relative w-full max-w-5xl max-h-[85vh] overflow-y-auto rounded-lg border border-cyan-500/20 bg-[#0D1117] shadow-2xl shadow-black/60">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800/60 bg-[#0D1117]/95 px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <FlaskConical size={16} className="text-[#FFB800]" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-gray-100">
                {t("whatif.title")}
              </h2>
              <p className="text-xs text-gray-500">
                {t("whatif.subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("whatif.closeAriaLabel")}
            className="rounded border border-gray-700/60 px-2 py-1 text-xs text-gray-400 hover:bg-gray-800/60 hover:text-gray-200"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        {/* FX sliders */}
        <section className="px-6 py-4 border-b border-gray-800/60">
          <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">
            {t("whatif.fxOverridesHeader")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(["fx_usd", "fx_eur", "fx_try", "fx_rub"] as const).map((key) => {
              const code = key.slice(3).toUpperCase()
              const value = overrides[key] ?? FX_DEFAULTS[key]
              const baseline = FX_DEFAULTS[key]
              const deltaPct = ((value - baseline) / baseline) * 100
              return (
                <label key={key} className="flex items-center gap-3 text-xs">
                  <span className="font-mono text-gray-400 w-16">AZN/{code}</span>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={value}
                    onChange={(e) =>
                      setOverrides((o) => ({
                        ...o,
                        [key]: Number.parseFloat(e.target.value) || 0,
                      }))
                    }
                    className="font-mono w-24 px-2 py-1 rounded border border-gray-700/60 bg-gray-900/60 text-gray-200 text-xs tabular-nums"
                  />
                  <span
                    className={`font-mono text-[10px] tabular-nums w-20 ${deltaPct === 0 ? "text-gray-500" : deltaPct > 0 ? "text-amber-400" : "text-emerald-400"}`}
                  >
                    {deltaPct >= 0 ? "+" : ""}
                    {deltaPct.toFixed(1)}% vs base
                  </span>
                </label>
              )
            })}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={() => void runPreview()}
              disabled={state.kind === "loading"}
              className="inline-flex items-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 px-3 py-1.5 text-xs hover:bg-cyan-500/20 disabled:opacity-50"
            >
              <Play size={11} aria-hidden="true" />
              {state.kind === "loading"
                ? t("whatif.previewLoading")
                : t("whatif.previewRun")}
            </button>
            <button
              type="button"
              onClick={() => setOverrides(FX_DEFAULTS)}
              className="text-[11px] text-gray-500 hover:text-gray-300"
            >
              {t("whatif.resetToBase")}
            </button>
            <span className="ml-auto text-[10px] text-gray-600 font-mono">
              {t("whatif.periodLabel")}: {period}
            </span>
          </div>
        </section>

        {/* Results */}
        <section className="px-6 py-4">
          {state.kind === "idle" && (
            <p className="text-[11px] text-gray-500 italic">
              {t("whatif.idleHint")}
            </p>
          )}
          {state.kind === "loading" && (
            <p className="text-[11px] text-cyan-300">
              {t("whatif.previewLoading")}…
            </p>
          )}
          {state.kind === "error" && (
            <p className="text-[11px] text-red-400" role="alert">
              {state.message}
            </p>
          )}
          {state.kind === "loaded" && (
            <div data-testid="whatif-results">
              <p className="text-[11px] text-gray-500 mb-3">
                {t("whatif.summaryLine", {
                  affected: state.data.affectedIndicatorCount,
                  cells: state.data.cells.length,
                  companies: cellsByCompany.size,
                })}
              </p>
              {state.data.cells.length === 0 ? (
                <p className="text-[11px] text-gray-500 italic">
                  {t("whatif.noAffected")}
                </p>
              ) : (
                <div className="space-y-3">
                  {Array.from(cellsByCompany.entries()).map(([co, rows]) => (
                    <div
                      key={co}
                      className="rounded border border-gray-800/60 bg-gray-900/30"
                    >
                      <header className="px-3 py-1.5 border-b border-gray-800/60 bg-gray-900/50">
                        <h4 className="text-[11px] font-mono font-semibold tracking-wide text-cyan-300">
                          {co}
                        </h4>
                      </header>
                      <ul className="divide-y divide-gray-800">
                        {rows.map((c) => (
                          <li
                            key={c.indicatorId}
                            className="px-3 py-2 grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 items-center text-[11px]"
                          >
                            <div
                              className="font-mono text-gray-400 truncate"
                              title={c.indicatorCode}
                            >
                              {c.indicatorCode}
                            </div>
                            <div className="text-right tabular-nums font-mono">
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] ${c.baselineStatus ? STATUS_PILL[c.baselineStatus] : "text-gray-500"}`}
                              >
                                {formatValue(c.baselineValue, c.unit)}
                              </span>
                            </div>
                            <div className="text-right tabular-nums font-mono">
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] ${c.scenarioStatus ? STATUS_PILL[c.scenarioStatus] : "text-gray-500"}`}
                              >
                                {formatValue(c.scenarioValue, c.unit)}
                              </span>
                            </div>
                            <div
                              className={`text-right tabular-nums font-mono text-[10px] ${
                                c.deltaPct === null
                                  ? "text-gray-500"
                                  : Math.abs(c.deltaPct) < 0.5
                                    ? "text-gray-500"
                                    : c.deltaPct > 0
                                      ? "text-amber-400"
                                      : "text-emerald-400"
                              }`}
                            >
                              {c.deltaPct === null
                                ? "—"
                                : `${c.deltaPct >= 0 ? "+" : ""}${c.deltaPct.toFixed(1)}%`}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <footer className="px-6 py-2 border-t border-gray-800/60 text-[10px] text-gray-600">
          {t("whatif.footerNote")}
        </footer>
      </div>
    </div>
  )
}
