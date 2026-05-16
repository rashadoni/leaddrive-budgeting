"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DataBoundary } from "@/components/ui/data-boundary"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LabelList,
} from "recharts"
import { BUDGET_COLORS, ANIMATION, AXIS_TICK, GRID_STYLE } from "@/lib/budget-chart-theme"
import { BudgetChartTooltip } from "@/components/budget-chart-tooltip"
import { TrendingUp, TrendingDown, Target } from "lucide-react"

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function useOrgId() {
  const { data: session } = useSession()
  return session?.user?.organizationId ?? ""
}

interface MonthlyPlanFact {
  month: number
  label: string
  revenuePlan: number
  revenueFact: number
  revenueVariance: number
  revenueVariancePct: number
  expensePlan: number
  expenseFact: number
  expenseVariance: number
  expenseVariancePct: number
  netPlan: number
  netFact: number
}

interface PlanFactData {
  year: number
  monthly: MonthlyPlanFact[]
  totals: {
    revenuePlan: number
    revenueFact: number
    revenueVariance: number
    revenueVariancePct: number
    expensePlan: number
    expenseFact: number
    expenseVariance: number
    expenseVariancePct: number
    netPlan: number
    netFact: number
  }
}

export function BudgetPlanFactDashboard({ year }: { year: number }) {
  const orgId = useOrgId()

  const { data, isLoading } = useQuery({
    queryKey: ["budgeting", "plan-fact", year, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/budgeting/cash-flow/plan-fact?year=${year}`, {
        headers: { "x-organization-id": orgId },
      })
      const json = await res.json()
      return json.data as PlanFactData
    },
    enabled: !!orgId,
  })

  if (isLoading) return <DataBoundary loading>{null}</DataBoundary>
  if (!data) return <div className="p-6 text-center text-muted-foreground">No data</div>

  const { totals } = data

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold">Plan vs Actual</h3>
        <p className="text-xs text-muted-foreground">Budget variance analysis — {year}</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <VarianceCard
          title="Revenue"
          plan={totals.revenuePlan}
          fact={totals.revenueFact}
          variance={totals.revenueVariance}
          variancePct={totals.revenueVariancePct}
          positiveIsGood={true}
        />
        <VarianceCard
          title="Expenses"
          plan={totals.expensePlan}
          fact={totals.expenseFact}
          variance={totals.expenseVariance}
          variancePct={totals.expenseVariancePct}
          positiveIsGood={false}
        />
        <VarianceCard
          title="Net Profit"
          plan={totals.netPlan}
          fact={totals.netFact}
          variance={totals.netFact - totals.netPlan}
          variancePct={totals.netPlan !== 0 ? Math.round(((totals.netFact - totals.netPlan) / Math.abs(totals.netPlan)) * 100) : 0}
          positiveIsGood={true}
        />
      </div>

      {/* Revenue Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Revenue: Plan vs Actual</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthly} barGap={2}>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="label" tick={AXIS_TICK} />
                <YAxis tick={AXIS_TICK} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip content={<BudgetChartTooltip />} />
                <Bar dataKey="revenuePlan" name="Plan" fill="#93c5fd" radius={[2, 2, 0, 0]} {...ANIMATION} />
                <Bar dataKey="revenueFact" name="Actual" fill="#2563eb" radius={[2, 2, 0, 0]} {...ANIMATION} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Expense Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Expenses: Plan vs Actual</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthly} barGap={2}>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="label" tick={AXIS_TICK} />
                <YAxis tick={AXIS_TICK} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip content={<BudgetChartTooltip />} />
                <Bar dataKey="expensePlan" name="Plan" fill="#fca5a5" radius={[2, 2, 0, 0]} {...ANIMATION} />
                <Bar dataKey="expenseFact" name="Actual" fill="#dc2626" radius={[2, 2, 0, 0]} {...ANIMATION} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Monthly Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Monthly Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-2 px-3 font-medium">Month</th>
                  <th className="text-right py-2 px-3 font-medium">Rev. Plan</th>
                  <th className="text-right py-2 px-3 font-medium">Rev. Actual</th>
                  <th className="text-right py-2 px-3 font-medium">Var %</th>
                  <th className="text-right py-2 px-3 font-medium">Exp. Plan</th>
                  <th className="text-right py-2 px-3 font-medium">Exp. Actual</th>
                  <th className="text-right py-2 px-3 font-medium">Var %</th>
                  <th className="text-right py-2 px-3 font-medium">Net Plan</th>
                  <th className="text-right py-2 px-3 font-medium">Net Actual</th>
                </tr>
              </thead>
              <tbody>
                {data.monthly.map((m) => (
                  <tr key={m.month} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-2 px-3 font-medium">{m.label}</td>
                    <td className="text-right py-2 px-3 tabular-nums">{fmt(m.revenuePlan)}</td>
                    <td className="text-right py-2 px-3 tabular-nums font-medium">{fmt(m.revenueFact)}</td>
                    <td className="text-right py-2 px-3">
                      <VarianceBadge value={m.revenueVariancePct} positiveIsGood={true} />
                    </td>
                    <td className="text-right py-2 px-3 tabular-nums">{fmt(m.expensePlan)}</td>
                    <td className="text-right py-2 px-3 tabular-nums font-medium">{fmt(m.expenseFact)}</td>
                    <td className="text-right py-2 px-3">
                      <VarianceBadge value={m.expenseVariancePct} positiveIsGood={false} />
                    </td>
                    <td className="text-right py-2 px-3 tabular-nums">{fmt(m.netPlan)}</td>
                    <td className={`text-right py-2 px-3 tabular-nums font-bold ${m.netFact >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {fmt(m.netFact)}
                    </td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="border-t-2 bg-muted/30 font-bold">
                  <td className="py-2 px-3">Total</td>
                  <td className="text-right py-2 px-3 tabular-nums">{fmt(totals.revenuePlan)}</td>
                  <td className="text-right py-2 px-3 tabular-nums">{fmt(totals.revenueFact)}</td>
                  <td className="text-right py-2 px-3">
                    <VarianceBadge value={totals.revenueVariancePct} positiveIsGood={true} />
                  </td>
                  <td className="text-right py-2 px-3 tabular-nums">{fmt(totals.expensePlan)}</td>
                  <td className="text-right py-2 px-3 tabular-nums">{fmt(totals.expenseFact)}</td>
                  <td className="text-right py-2 px-3">
                    <VarianceBadge value={totals.expenseVariancePct} positiveIsGood={false} />
                  </td>
                  <td className="text-right py-2 px-3 tabular-nums">{fmt(totals.netPlan)}</td>
                  <td className={`text-right py-2 px-3 tabular-nums ${totals.netFact >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {fmt(totals.netFact)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function VarianceCard({ title, plan, fact, variance, variancePct, positiveIsGood }: {
  title: string
  plan: number
  fact: number
  variance: number
  variancePct: number
  positiveIsGood: boolean
}) {
  const isGood = positiveIsGood ? variance >= 0 : variance <= 0

  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground">{title}</span>
          <VarianceBadge value={variancePct} positiveIsGood={positiveIsGood} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-[10px] text-muted-foreground block">Plan</span>
            <span className="text-sm font-semibold tabular-nums">{fmt(plan)}</span>
          </div>
          <div>
            <span className="text-[10px] text-muted-foreground block">Actual</span>
            <span className="text-sm font-bold tabular-nums">{fmt(fact)}</span>
          </div>
        </div>
        <div className="mt-1 pt-1 border-t">
          <span className={`text-xs font-semibold tabular-nums ${isGood ? "text-green-600" : "text-red-600"}`}>
            {variance >= 0 ? "+" : ""}{fmt(variance)} AZN
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function VarianceBadge({ value, positiveIsGood }: { value: number; positiveIsGood: boolean }) {
  if (value === 0) return <span className="text-[10px] text-muted-foreground">—</span>

  const isGood = positiveIsGood ? value > 0 : value < 0

  return (
    <Badge
      variant={isGood ? "default" : "destructive"}
      className="text-[10px] px-1.5 py-0"
    >
      {value > 0 ? "+" : ""}{value}%
    </Badge>
  )
}
