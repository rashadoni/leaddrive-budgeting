"use client"

/**
 * Phase 7.B v2 Day 6 — admin dashboard for AI token usage.
 *
 * Hits `/api/admin/ai-usage` on mount + 60s polling, renders 4 cards
 * (today / mtd / daily-remaining / monthly-remaining) + a 30-day
 * sparkline of total-tokens-per-day. Over-budget warning chip
 * appears above the cards when applicable.
 */

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"

interface UsageStats {
  tokensIn: number
  tokensOut: number
  calls: number
  total: number
}
interface UsageResponse {
  today: UsageStats
  mtd: UsageStats
  budget: { daily: number; monthly: number }
  remaining: { daily: number; monthly: number }
  overBudget: { daily: boolean; monthly: boolean }
  last30: Array<{ date: string; total: number; calls: number }>
}

const POLL_INTERVAL_MS = 60_000

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString("en-US")
}

function pctFmt(used: number, cap: number): string {
  if (cap === 0) return "—"
  return `${((used / cap) * 100).toFixed(1)}%`
}

function Sparkline({ data, ariaLabel }: { data: number[]; ariaLabel: string }) {
  const max = Math.max(1, ...data)
  // 30 days × ~6px each = 180px wide. Tiny inline svg, no chart lib.
  return (
    <svg
      viewBox="0 0 180 40"
      width="180"
      height="40"
      role="img"
      aria-label={ariaLabel}
    >
      {data.map((v, i) => {
        const h = Math.round((v / max) * 36)
        return (
          <rect
            key={i}
            x={i * 6}
            y={40 - h}
            width={5}
            height={h}
            fill={v > 0 ? "#06b6d4" : "#1f2937"}
            opacity={v > 0 ? 0.85 : 0.4}
          />
        )
      })}
    </svg>
  )
}

export function AIUsageAdmin() {
  const t = useTranslations("adminAiUsage")
  const [data, setData] = useState<UsageResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch("/api/admin/ai-usage")
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const body = (await res.json()) as UsageResponse
        if (!cancelled) {
          setData(body)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const id = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (loading && !data) {
    return (
      <div className="p-6 text-sm text-muted-foreground" data-testid="ai-usage-loading">
        {t("loading")}
      </div>
    )
  }
  if (error && !data) {
    return (
      <div
        className="p-6 text-sm text-red-600 dark:text-red-300"
        data-testid="ai-usage-error"
      >
        {t("error", { error })}
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto" data-testid="ai-usage-admin">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      {(data.overBudget.daily || data.overBudget.monthly) && (
        <div
          data-testid="ai-usage-overbudget"
          className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200"
        >
          {t("overBudgetPrefix")}
          {data.overBudget.daily &&
            t("overBudgetDaily", {
              today: fmt(data.today.total),
              cap: fmt(data.budget.daily),
            })}
          {data.overBudget.monthly &&
            t("overBudgetMonthly", {
              mtd: fmt(data.mtd.total),
              cap: fmt(data.budget.monthly),
            })}
          {t("overBudgetSuffix")}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card
          label={t("cardToday")}
          primary={fmt(data.today.total)}
          secondary={
            data.today.calls === 1
              ? t("callsOne", { n: data.today.calls })
              : t("callsOther", { n: data.today.calls })
          }
          tone={data.overBudget.daily ? "red" : data.today.total > data.budget.daily * 0.8 ? "amber" : "green"}
        />
        <Card
          label={t("cardMtd")}
          primary={fmt(data.mtd.total)}
          secondary={
            data.mtd.calls === 1
              ? t("callsOne", { n: data.mtd.calls })
              : t("callsOther", { n: data.mtd.calls })
          }
          tone={data.overBudget.monthly ? "red" : data.mtd.total > data.budget.monthly * 0.8 ? "amber" : "green"}
        />
        <Card
          label={t("cardDailyBudget")}
          primary={fmt(data.budget.daily)}
          secondary={t("usedLeftLabel", {
            pct: pctFmt(data.today.total, data.budget.daily),
            remaining: fmt(data.remaining.daily),
          })}
        />
        <Card
          label={t("cardMonthlyBudget")}
          primary={fmt(data.budget.monthly)}
          secondary={t("usedLeftLabel", {
            pct: pctFmt(data.mtd.total, data.budget.monthly),
            remaining: fmt(data.remaining.monthly),
          })}
        />
      </div>

      <div className="rounded-md border border-gray-800/60 bg-[#0F1535] px-4 py-4 text-gray-100">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] uppercase tracking-wider text-gray-400">
            {t("chart30dTitle")}
          </div>
          <div className="text-[11px] text-gray-500">
            {data.last30[0].date} → {data.last30[29].date}
          </div>
        </div>
        <Sparkline data={data.last30.map((d) => d.total)} ariaLabel={t("ariaTrend")} />
      </div>
    </div>
  )
}

function Card({
  label,
  primary,
  secondary,
  tone,
}: {
  label: string
  primary: string
  secondary: string
  tone?: "green" | "amber" | "red"
}) {
  const toneClass =
    tone === "red"
      ? "border-red-500/50 bg-red-500/10"
      : tone === "amber"
      ? "border-amber-500/50 bg-amber-500/10"
      : tone === "green"
      ? "border-emerald-500/40 bg-emerald-500/5"
      : "border-gray-700/80 bg-[#0F1535]"
  return (
    <div className={`rounded-md border px-3 py-3 text-gray-100 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{primary}</div>
      <div className="text-[10px] text-gray-500 mt-1">{secondary}</div>
    </div>
  )
}
