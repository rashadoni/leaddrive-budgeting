"use client"

/**
 * Where the year lands (2026-08-19).
 *
 * The owner's first question — are we going to make the year — had no screen.
 * Actuals stop in May, the budget runs to December, and nothing put the two
 * together.
 *
 * Method, chosen by the owner: actual to date, plan for the rest. It keeps the
 * seasonality the budget already encodes, which matters in farming, where a
 * run-rate off January–May would smear pre-harvest months across the year.
 *
 * ## Where the numbers come from
 *
 * The monthly series on `/api/budgeting/pnl` — the payload that already draws
 * the P&L screen — summed over three windows and composed by `computeEbitda`,
 * the same function that screen uses. Nothing is re-derived from accounts, so
 * the landing cannot disagree with the statement it projects from.
 *
 * Sign handling mirrors `budget-pnl-view`: budget COGS arrives signed and is
 * taken as a magnitude, actual COGS arrives already positive. If that payload
 * convention ever changes, this file and that one change together — which is
 * why the dependency is written down here rather than left to be rediscovered.
 */

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import { BUDGET_COLORS, GRID_STYLE, AXIS_TICK, fmtK } from "@/lib/budget-chart-theme"
import type { PnlSectionTotals } from "@/lib/budgeting/ebitda"
import { projectYearEnd } from "@/lib/budgeting/year-end-landing"

type Monthly = Record<number, number> | undefined

interface PnlResponse {
  year?: number
  hasActuals?: boolean
  monthlyRevenue?: Monthly
  monthlyCogs?: Monthly
  monthlyOpex?: Monthly
  monthlyOtherOperating?: Monthly
  monthlyDa?: Monthly
  monthlyBelowEbitda?: Monthly
  monthlyActualRevenue?: Monthly
  monthlyActualCogs?: Monthly
  monthlyActualOpex?: Monthly
  monthlyActualOtherOperating?: Monthly
  monthlyActualDa?: Monthly
  monthlyActualBelowEbitda?: Monthly
}

const money = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

function sum(series: Monthly, months: number[], abs = false): number {
  let total = 0
  for (const m of months) {
    const v = series?.[m] ?? 0
    total += abs ? Math.abs(v) : v
  }
  return total
}

function budgetTotals(d: PnlResponse, months: number[]): PnlSectionTotals {
  return {
    totalRevenue: sum(d.monthlyRevenue, months),
    // Budget COGS arrives signed; the P&L screen takes its magnitude here too.
    totalCogs: sum(d.monthlyCogs, months, true),
    totalOpex: sum(d.monthlyOpex, months),
    totalOtherOperating: sum(d.monthlyOtherOperating, months),
    totalBelowEbitda: sum(d.monthlyBelowEbitda, months),
    // computeEbitda only ever reads the sum of the two D&A buckets.
    daInCogs: sum(d.monthlyDa, months),
    daInOpex: 0,
  }
}

function actualTotals(d: PnlResponse, months: number[]): PnlSectionTotals {
  return {
    totalRevenue: sum(d.monthlyActualRevenue, months),
    totalCogs: sum(d.monthlyActualCogs, months),
    totalOpex: sum(d.monthlyActualOpex, months),
    totalOtherOperating: sum(d.monthlyActualOtherOperating, months),
    totalBelowEbitda: sum(d.monthlyActualBelowEbitda, months),
    daInCogs: sum(d.monthlyActualDa, months),
    daInOpex: 0,
  }
}

export function YearEndPanel({
  planId,
  companyId,
}: {
  planId: string
  companyId?: string | null
}) {
  const t = useTranslations("yearEnd")

  const { data, isLoading, error } = useQuery<PnlResponse>({
    queryKey: ["pnl-year-end", planId, companyId ?? null],
    enabled: Boolean(planId),
    queryFn: async () => {
      const q = new URLSearchParams({ planId })
      if (companyId) q.set("companyId", companyId)
      const res = await fetch(`/api/budgeting/pnl?${q.toString()}`)
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    },
  })

  const model = useMemo(() => {
    if (!data) return null
    // A month counts as delivered when it carries any actual movement at all.
    const delivered = ALL_MONTHS.filter(
      (m) =>
        (data.monthlyActualRevenue?.[m] ?? 0) !== 0 ||
        (data.monthlyActualCogs?.[m] ?? 0) !== 0 ||
        (data.monthlyActualOpex?.[m] ?? 0) !== 0,
    )
    if (delivered.length === 0) return null
    const remaining = ALL_MONTHS.filter((m) => !delivered.includes(m))
    return projectYearEnd({
      actualToDate: actualTotals(data, delivered),
      budgetToDate: budgetTotals(data, delivered),
      budgetRemaining: budgetTotals(data, remaining),
      monthsActual: delivered,
      monthsRemaining: remaining,
    })
  }, [data])

  if (!planId) return null
  if (isLoading) return <Card><CardContent className="p-6 text-muted-foreground">{t("loading")}</CardContent></Card>
  if (error) return <Card><CardContent className="p-6 text-muted-foreground">{t("failed")}</CardContent></Card>
  if (!model) return <Card><CardContent className="p-6 text-muted-foreground">{t("noActuals")}</CardContent></Card>

  const chart = [
    { key: "revenue", budget: model.originalBudget.totals.totalRevenue, landing: model.landing.totals.totalRevenue },
    { key: "grossProfit", budget: model.originalBudget.derived.grossProfit, landing: model.landing.derived.grossProfit },
    { key: "ebitda", budget: model.originalBudget.derived.ebitda, landing: model.landing.derived.ebitda },
    { key: "netProfit", budget: model.originalBudget.derived.netProfit, landing: model.landing.derived.netProfit },
  ].map((r) => ({ ...r, name: t(`line.${r.key}`), gap: r.landing - r.budget }))

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6 space-y-1">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          <p className="text-xs text-muted-foreground pt-2">
            {t("window", {
              delivered: model.monthsActual.length,
              planned: model.monthsRemaining.length,
            })}
          </p>
        </CardContent>
      </Card>

      {/* The caveat is not a footnote. Under this method the projected miss IS
          the miss already banked, and a reader who thinks it models the future
          will over-trust it. */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <Badge variant="secondary">{t("methodBadge")}</Badge>
          <p className="text-sm text-muted-foreground">{t("bankedOnly")}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {chart.map((r) => (
          <Card key={r.key}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{r.name}</div>
              <div className="text-xl font-semibold tabular-nums">{money.format(r.landing)}</div>
              <div className="text-xs tabular-nums" style={{ color: r.gap < 0 ? BUDGET_COLORS.negative : BUDGET_COLORS.positive }}>
                {r.gap >= 0 ? "+" : ""}{money.format(r.gap)} {t("vsPlan")}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-6">
          <h3 className="font-medium mb-4">{t("chartTitle")}</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chart}>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="name" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} tickFormatter={fmtK} />
              <Tooltip
                formatter={(v) => (typeof v === "number" ? money.format(v) : String(v ?? ""))}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="budget" name={t("plan")} fill={BUDGET_COLORS.planIndigo} radius={[4, 4, 0, 0]} />
              <Bar dataKey="landing" name={t("landing")} radius={[4, 4, 0, 0]}>
                {chart.map((r) => (
                  <Cell key={r.key} fill={r.gap < 0 ? BUDGET_COLORS.negative : BUDGET_COLORS.actualGreen} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left">
                <th className="p-3 font-medium">{t("line.header")}</th>
                <th className="p-3 font-medium text-right">{t("delivered")}</th>
                <th className="p-3 font-medium text-right">{t("landing")}</th>
                <th className="p-3 font-medium text-right">{t("plan")}</th>
                <th className="p-3 font-medium text-right">{t("gap")}</th>
              </tr>
            </thead>
            <tbody>
              {[
                { key: "revenue", d: model.toDate.totals.totalRevenue, l: model.landing.totals.totalRevenue, b: model.originalBudget.totals.totalRevenue },
                { key: "grossProfit", d: model.toDate.derived.grossProfit, l: model.landing.derived.grossProfit, b: model.originalBudget.derived.grossProfit },
                { key: "ebitda", d: model.toDate.derived.ebitda, l: model.landing.derived.ebitda, b: model.originalBudget.derived.ebitda },
                { key: "netProfit", d: model.toDate.derived.netProfit, l: model.landing.derived.netProfit, b: model.originalBudget.derived.netProfit },
              ].map((r) => (
                <tr key={r.key} className="border-b last:border-0">
                  <td className="p-3">{t(`line.${r.key}`)}</td>
                  <td className="p-3 text-right tabular-nums">{money.format(r.d)}</td>
                  <td className="p-3 text-right tabular-nums font-medium">{money.format(r.l)}</td>
                  <td className="p-3 text-right tabular-nums">{money.format(r.b)}</td>
                  <td
                    className="p-3 text-right tabular-nums"
                    style={{ color: r.l - r.b < 0 ? BUDGET_COLORS.negative : BUDGET_COLORS.positive }}
                  >
                    {r.l - r.b >= 0 ? "+" : ""}{money.format(r.l - r.b)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
