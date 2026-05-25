"use client"

/**
 * Phase 7.E ad-hoc Scenario "What-If" preview panel — v2.
 *
 * Extends the original FX-only panel with four scenario groups:
 *   💱 FX Rates      — USD/EUR/TRY/RUB vs AZN
 *   🛢️ Commodities   — Brent, Sugar, Wheat, Natural Gas
 *   📊 Macro         — Azerbaijan CPI (all items & food)
 *   🌾 Agricultural  — Rainfall (90-day), Avg Temperature
 *
 * Five one-click presets (AZN Stress, Oil Crash, Sugar Rally,
 * Drought, Stagflation) let users apply canonical stress scenarios
 * without having to dial each variable manually.
 *
 * UI improvements over v1:
 *   - Tabbed groups with changed-count badge per tab
 *   - Changed variables highlighted in amber while active
 *   - Summary banner: "N will breach · M improved · K stable"
 *   - Per-company column headers: Indicator | Baseline | Scenario | Δ%
 *   - Rows where status changes are highlighted with color ring
 *   - valueAsNumber for input reading (bypasses locale comma/period)
 *   - Only changed overrides (diff from defaults) sent to backend
 *
 * Opens on `terminal:open-whatif` window event.
 * Closes on Esc or backdrop click.
 * Pure preview — never writes to DB.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { FlaskConical, X, Play } from "lucide-react"
import { currentBakuYear } from "@/lib/risk/periods"

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Scenario Definitions ─────────────────────────────────────────────────────

interface ScenarioVar {
  key: string
  label: string
  unit: string
  default: number
  step: number
  min: number
  max: number
}

interface ScenarioGroup {
  key: string
  emoji: string
  label: string
  vars: ScenarioVar[]
}

const SCENARIO_GROUPS: ScenarioGroup[] = [
  {
    key: "fx",
    emoji: "💱",
    label: "FX Rates",
    vars: [
      { key: "fx_usd", label: "AZN per 1 USD", unit: "AZN", default: 1.70, step: 0.01, min: 0.5, max: 5 },
      { key: "fx_eur", label: "AZN per 1 EUR", unit: "AZN", default: 1.85, step: 0.01, min: 0.5, max: 5 },
      { key: "fx_try", label: "AZN per 1 TRY", unit: "AZN", default: 0.050, step: 0.001, min: 0.005, max: 0.5 },
      { key: "fx_rub", label: "AZN per 1 RUB", unit: "AZN", default: 0.018, step: 0.001, min: 0.002, max: 0.2 },
    ],
  },
  {
    key: "commodity",
    emoji: "🛢️",
    label: "Commodities",
    vars: [
      { key: "brent_price_latest", label: "Brent Crude", unit: "USD/bbl", default: 75, step: 1, min: 20, max: 200 },
      { key: "sugar_price_latest", label: "Sugar", unit: "USD/t", default: 450, step: 5, min: 100, max: 1_200 },
      { key: "wheat_price_latest", label: "Wheat", unit: "USD/t", default: 210, step: 5, min: 50, max: 800 },
      { key: "natgas_price_latest", label: "Natural Gas", unit: "USD/MMBtu", default: 3.2, step: 0.1, min: 0.5, max: 20 },
    ],
  },
  {
    key: "macro",
    emoji: "📊",
    label: "Macro",
    vars: [
      { key: "az_cpi_all_latest", label: "AZ CPI (all items)", unit: "% YoY", default: 8.5, step: 0.5, min: 0, max: 50 },
      { key: "az_cpi_food_latest", label: "AZ Food CPI", unit: "% YoY", default: 10.2, step: 0.5, min: 0, max: 80 },
    ],
  },
  {
    key: "agro",
    emoji: "🌾",
    label: "Agricultural",
    vars: [
      { key: "rainfall_mm_90d", label: "Rainfall (90-day)", unit: "mm", default: 180, step: 10, min: 0, max: 600 },
      { key: "temp_avg_c_30d", label: "Avg Temperature", unit: "°C", default: 22, step: 0.5, min: -10, max: 50 },
    ],
  },
]

/** All variable defaults — used for reset and change detection. */
const ALL_DEFAULTS: Record<string, number> = Object.fromEntries(
  SCENARIO_GROUPS.flatMap((g) => g.vars.map((v) => [v.key, v.default])),
)

// ─── Preset Stress Scenarios ──────────────────────────────────────────────────

interface Preset {
  label: string
  desc: string
  icon: string
  overrides: Record<string, number>
}

const PRESETS: Preset[] = [
  {
    label: "AZN Stress",
    desc: "FX −15% across all currencies (AZN devaluation scenario)",
    icon: "💸",
    overrides: { fx_usd: 1.95, fx_eur: 2.13, fx_try: 0.056, fx_rub: 0.021 },
  },
  {
    label: "Oil Crash $50",
    desc: "Brent drops to $50/bbl — fiscal shock to AZ economy (−33%)",
    icon: "🛢️",
    overrides: { brent_price_latest: 50 },
  },
  {
    label: "Sugar +40%",
    desc: "Sugar rally to $630/t — key input cost for AZSEKER sugar operations",
    icon: "🍬",
    overrides: { sugar_price_latest: 630 },
  },
  {
    label: "Drought Year",
    desc: "Rainfall −70% (55 mm) + heat stress +6°C — agro yield shock",
    icon: "☀️",
    overrides: { rainfall_mm_90d: 55, temp_avg_c_30d: 34 },
  },
  {
    label: "Stagflation",
    desc: "CPI 18% + AZN −10% + Brent +20% — combined macro stress",
    icon: "📉",
    overrides: {
      az_cpi_all_latest: 18,
      az_cpi_food_latest: 24,
      fx_usd: 1.87,
      fx_eur: 2.04,
      brent_price_latest: 90,
    },
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusRank(s: PreviewCell["baselineStatus"]): number {
  if (s === "green") return 0
  if (s === "amber") return 1
  if (s === "red") return 2
  return -1
}

function formatValue(v: number | null, unit: string): string {
  if (v === null || !Number.isFinite(v)) return "—"
  if (unit === "%" || unit === "% YoY") return `${v.toFixed(1)}%`
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return v.toFixed(2)
}

const STATUS_PILL: Record<NonNullable<PreviewCell["baselineStatus"]>, string> = {
  green: "bg-emerald-500/15 text-emerald-400",
  amber: "bg-amber-500/15 text-amber-400",
  red: "bg-red-500/15 text-red-400",
  unknown: "bg-slate-500/15 text-slate-400",
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WhatIfPreviewPanel() {
  const t = useTranslations("terminal")
  const [open, setOpen] = useState(false)
  const [activeGroup, setActiveGroup] = useState("fx")
  const [overrides, setOverrides] = useState<Record<string, number>>(ALL_DEFAULTS)
  const [state, setState] = useState<State>({ kind: "idle" })
  const period = currentBakuYear()

  // Open on event
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener("terminal:open-whatif", onOpen)
    return () => window.removeEventListener("terminal:open-whatif", onOpen)
  }, [])

  // Esc closes
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

  /** Only variables that differ from baseline defaults — keeps the backend
   *  result semantically accurate (not polluted by hardcoded default values
   *  which may diverge from live DB data). */
  const changedOverrides = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(overrides).filter(([k, v]) => {
          const def = ALL_DEFAULTS[k]
          return def === undefined || Math.abs(v - def) > 1e-9
        }),
      ),
    [overrides],
  )

  const hasChanges = Object.keys(changedOverrides).length > 0

  /** Number of variables in a group that differ from default. */
  const groupChangedCount = useCallback(
    (group: ScenarioGroup) =>
      group.vars.filter((v) => Math.abs((overrides[v.key] ?? v.default) - v.default) > 1e-9)
        .length,
    [overrides],
  )

  /** Apply a preset (merges into current override state). */
  const applyPreset = useCallback((preset: Preset) => {
    setOverrides((prev) => ({ ...prev, ...preset.overrides }))
    // Switch to first tab that has preset variables
    const firstChanged = SCENARIO_GROUPS.find((g) =>
      g.vars.some((v) => v.key in preset.overrides),
    )
    if (firstChanged) setActiveGroup(firstChanged.key)
  }, [])

  const runPreview = useCallback(async () => {
    if (!hasChanges) return
    setState({ kind: "loading" })
    try {
      const res = await fetch("/api/indicators/matrix/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, overrides: changedOverrides }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as PreviewResponse
        setState({ kind: "error", message: body.error ?? `HTTP ${res.status}` })
        return
      }
      const data = (await res.json()) as PreviewResponse
      setState({ kind: "loaded", data })
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) })
    }
  }, [changedOverrides, hasChanges, period])

  /** Aggregate status change summary for the banner. */
  const summary = useMemo(() => {
    if (state.kind !== "loaded") return null
    let breaches = 0
    let improved = 0
    let stable = 0
    for (const c of state.data.cells) {
      const bRank = statusRank(c.baselineStatus)
      const sRank = statusRank(c.scenarioStatus)
      if (bRank === -1 || sRank === -1) continue
      if (sRank > bRank) breaches++
      else if (sRank < bRank) improved++
      else stable++
    }
    return { breaches, improved, stable }
  }, [state])

  /** Group result cells by company code. */
  const cellsByCompany = useMemo(() => {
    if (state.kind !== "loaded") return new Map<string, PreviewCell[]>()
    const m = new Map<string, PreviewCell[]>()
    for (const c of state.data.cells) {
      const arr = m.get(c.companyCode) ?? []
      arr.push(c)
      m.set(c.companyCode, arr)
    }
    return m
  }, [state])

  if (!open) return null

  const currentGroup = SCENARIO_GROUPS.find((g) => g.key === activeGroup) ?? SCENARIO_GROUPS[0]!

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
      <div className="relative w-full max-w-5xl max-h-[88vh] overflow-y-auto rounded-lg border border-cyan-500/20 bg-[#0D1117] shadow-2xl shadow-black/60">

        {/* ── Header ────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800/60 bg-[#0D1117]/95 px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <FlaskConical size={16} className="text-[#FFB800]" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-gray-100">
                {t("whatif.title")}
              </h2>
              <p className="text-xs text-gray-500">{t("whatif.subtitle")}</p>
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

        {/* ── Quick Preset Scenarios ─────────────────────────────────── */}
        <section className="px-6 pt-4 pb-3 border-b border-gray-800/60">
          <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">
            {t("whatif.presetsHeader")}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                title={preset.desc}
                onClick={() => applyPreset(preset)}
                className="inline-flex items-center gap-1.5 rounded border border-gray-700/60 px-2.5 py-1 text-[11px] text-gray-300 hover:border-[#FFB800]/50 hover:bg-[#FFB800]/5 hover:text-[#FFB800] transition-colors"
              >
                <span aria-hidden="true">{preset.icon}</span>
                <span className="font-medium">{preset.label}</span>
              </button>
            ))}
            {hasChanges && (
              <button
                type="button"
                onClick={() => {
                  setOverrides(ALL_DEFAULTS)
                  setState({ kind: "idle" })
                }}
                className="ml-auto text-[11px] text-gray-600 hover:text-gray-400 transition-colors"
              >
                {t("whatif.resetToBase")}
              </button>
            )}
          </div>
        </section>

        {/* ── Scenario Tabs + Variable Inputs ───────────────────────── */}
        <section className="px-6 py-4 border-b border-gray-800/60">

          {/* Tab row */}
          <div className="flex items-center gap-1 mb-4 flex-wrap">
            {SCENARIO_GROUPS.map((group) => {
              const changed = groupChangedCount(group)
              const isActive = activeGroup === group.key
              return (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => setActiveGroup(group.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors ${
                    isActive
                      ? "bg-gray-800 text-gray-100 border border-gray-700/80"
                      : "text-gray-500 hover:text-gray-300 border border-transparent hover:border-gray-800"
                  }`}
                >
                  <span aria-hidden="true">{group.emoji}</span>
                  <span>{group.label}</span>
                  {changed > 0 && (
                    <span className="ml-0.5 h-4 min-w-[16px] rounded-full bg-cyan-500/20 text-cyan-400 text-[9px] font-mono flex items-center justify-center px-1">
                      {changed}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Variable inputs for active group */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {currentGroup.vars.map((v) => {
              const value = overrides[v.key] ?? v.default
              const deltaPct = ((value - v.default) / v.default) * 100
              const changed = Math.abs(deltaPct) > 0.01
              return (
                <label key={v.key} className="flex items-center gap-3 text-xs">
                  <span
                    className={`font-mono w-40 shrink-0 truncate transition-colors ${
                      changed ? "text-[#FFB800]" : "text-gray-400"
                    }`}
                  >
                    {v.label}
                  </span>
                  <input
                    type="number"
                    step={v.step}
                    min={v.min}
                    max={v.max}
                    value={value}
                    /* valueAsNumber bypasses locale comma/period formatting */
                    onChange={(e) => {
                      const val = e.target.valueAsNumber
                      if (Number.isFinite(val)) {
                        setOverrides((o) => ({ ...o, [v.key]: val }))
                      }
                    }}
                    className={`font-mono w-24 shrink-0 px-2 py-1 rounded border bg-gray-900/60 text-gray-200 text-xs tabular-nums transition-colors ${
                      changed ? "border-[#FFB800]/50" : "border-gray-700/60"
                    }`}
                  />
                  <span className="text-[10px] text-gray-600 font-mono w-16 shrink-0">{v.unit}</span>
                  <span
                    className={`font-mono text-[10px] tabular-nums w-20 ${
                      Math.abs(deltaPct) < 0.01
                        ? "text-gray-600"
                        : deltaPct > 0
                        ? "text-amber-400"
                        : "text-emerald-400"
                    }`}
                  >
                    {Math.abs(deltaPct) >= 0.01
                      ? `${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}%`
                      : "base"}
                  </span>
                </label>
              )
            })}
          </div>

          {/* Run bar */}
          <div className="flex items-center gap-3 mt-4">
            <button
              type="button"
              onClick={() => void runPreview()}
              disabled={state.kind === "loading" || !hasChanges}
              data-testid="whatif-run-button"
              className="inline-flex items-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 px-3 py-1.5 text-xs hover:bg-cyan-500/20 disabled:opacity-40 transition-colors"
            >
              <Play size={11} aria-hidden="true" />
              {state.kind === "loading"
                ? `${t("whatif.previewLoading")}…`
                : t("whatif.previewRun")}
            </button>
            {!hasChanges && (
              <span className="text-[11px] text-gray-600 italic">
                {t("whatif.noChanges")}
              </span>
            )}
            <span className="ml-auto text-[10px] text-gray-600 font-mono">
              {t("whatif.periodLabel")}: {period}
            </span>
          </div>
        </section>

        {/* ── Results ────────────────────────────────────────────────── */}
        <section className="px-6 py-4">
          {state.kind === "idle" && (
            <p className="text-[11px] text-gray-500 italic">{t("whatif.idleHint")}</p>
          )}
          {state.kind === "loading" && (
            <p className="text-[11px] text-cyan-300">{t("whatif.previewLoading")}…</p>
          )}
          {state.kind === "error" && (
            <p className="text-[11px] text-red-400" role="alert">
              {state.message}
            </p>
          )}
          {state.kind === "loaded" && (
            <div data-testid="whatif-results">

              {/* Summary banner — shown only when something changes status */}
              {summary && (summary.breaches > 0 || summary.improved > 0) && (
                <div
                  data-testid="whatif-summary-banner"
                  className={`flex items-center gap-4 rounded border px-3 py-2 mb-4 text-[11px] font-mono ${
                    summary.breaches > 0
                      ? "border-amber-500/30 bg-amber-500/5"
                      : "border-emerald-500/30 bg-emerald-500/5"
                  }`}
                >
                  {summary.breaches > 0 && (
                    <span className="text-amber-400 font-semibold">
                      ⚠ {summary.breaches} {t("whatif.summaryBreaches")}
                    </span>
                  )}
                  {summary.improved > 0 && (
                    <span className="text-emerald-400">
                      ↑ {summary.improved} {t("whatif.summaryImproved")}
                    </span>
                  )}
                  <span className="text-gray-500">
                    {summary.stable} {t("whatif.summaryStable")}
                  </span>
                </div>
              )}

              {/* Cell-count info line */}
              <p className="text-[11px] text-gray-500 mb-3">
                {t("whatif.summaryLine", {
                  affected: state.data.affectedIndicatorCount,
                  cells: state.data.cells.length,
                  companies: cellsByCompany.size,
                })}
              </p>

              {state.data.cells.length === 0 ? (
                <p className="text-[11px] text-gray-500 italic">{t("whatif.noAffected")}</p>
              ) : (
                <div className="space-y-3">
                  {Array.from(cellsByCompany.entries()).map(([co, rows]) => (
                    <div
                      key={co}
                      className="rounded border border-gray-800/60 bg-gray-900/30"
                    >
                      {/* Company header */}
                      <header className="px-3 py-1.5 border-b border-gray-800/60 bg-gray-900/50">
                        <h4 className="text-[11px] font-mono font-semibold tracking-wide text-cyan-300">
                          {co}
                        </h4>
                      </header>

                      {/* Column headers */}
                      <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 px-3 py-1 text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800/40">
                        <div>{t("whatif.colIndicator")}</div>
                        <div className="text-right">{t("whatif.colBaseline")}</div>
                        <div className="text-right">{t("whatif.colScenario")}</div>
                        <div className="text-right">{t("whatif.colDelta")}</div>
                      </div>

                      <ul className="divide-y divide-gray-800/40">
                        {rows.map((c) => {
                          const bRank = statusRank(c.baselineStatus)
                          const sRank = statusRank(c.scenarioStatus)
                          const worsened = bRank !== -1 && sRank !== -1 && sRank > bRank
                          const improved = bRank !== -1 && sRank !== -1 && sRank < bRank

                          const rowCls = worsened
                            ? "bg-amber-500/5 ring-1 ring-inset ring-amber-500/20"
                            : improved
                            ? "bg-emerald-500/5 ring-1 ring-inset ring-emerald-500/20"
                            : ""

                          return (
                            <li
                              key={c.indicatorId}
                              className={`px-3 py-2 grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 items-center text-[11px] ${rowCls}`}
                            >
                              <div
                                className="font-mono text-gray-400 truncate"
                                title={c.indicatorCode}
                              >
                                {c.indicatorCode}
                                {worsened && (
                                  <span className="ml-1.5 text-[9px] text-amber-400 font-semibold">
                                    ▲ status
                                  </span>
                                )}
                                {improved && (
                                  <span className="ml-1.5 text-[9px] text-emerald-400 font-semibold">
                                    ▼ status
                                  </span>
                                )}
                              </div>
                              <div className="text-right tabular-nums font-mono">
                                <span
                                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] ${
                                    c.baselineStatus ? STATUS_PILL[c.baselineStatus] : "text-gray-500"
                                  }`}
                                >
                                  {formatValue(c.baselineValue, c.unit)}
                                </span>
                              </div>
                              <div className="text-right tabular-nums font-mono">
                                <span
                                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] ${
                                    c.scenarioStatus ? STATUS_PILL[c.scenarioStatus] : "text-gray-500"
                                  }`}
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
                          )
                        })}
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
