"use client"

import { useLocale, useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Banknote } from "lucide-react"
import {
  BarChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ComposedChart, Legend,
} from "recharts"

interface MonthData {
  month: number
  year: number
  opening: number
  inflows: number
  outflows: number
  net: number
  closing: number
}

interface Props {
  months: MonthData[]
  year: number
  totalInflows: number
  totalOutflows: number
}

const MONTH_KEYS = ["monthJan", "monthFeb", "monthMar", "monthApr", "monthMay", "monthJun", "monthJul", "monthAug", "monthSep", "monthOct", "monthNov", "monthDec"] as const

export function BudgetCashFlowChart({ months, year, totalInflows, totalOutflows }: Props) {
  const t = useTranslations("budgeting")
  const locale = useLocale()
  const fmt = (n: number): string => {
    if (Math.abs(n) >= 1000000) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n / 1000000)}M`
    if (Math.abs(n) >= 1000) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n / 1000)}K`
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n)
  }
  const chartData = months.map((m) => ({
    name: MONTH_KEYS[m.month - 1] ? t(MONTH_KEYS[m.month - 1]).slice(0, 3) : String(m.month),
    inflows: m.inflows,
    outflows: -m.outflows,
    closing: m.closing,
  }))

  const hasNegative = months.some((m) => m.closing < 0)

  return (
    <Card data-testid="cash-flow-chart">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Banknote className="h-4 w-4" />
            {t("cashFlowChartTitle", { year })}
          </span>
          <div className="flex gap-2" data-testid="cash-flow-chart-totals">
            <Badge variant="outline" className="text-green-700 bg-green-50">
              {t("cashFlowChartInflows", { amount: fmt(totalInflows) })}
            </Badge>
            <Badge variant="outline" className="text-red-700 bg-red-50">
              {t("cashFlowChartOutflows", { amount: fmt(totalOutflows) })}
            </Badge>
            {hasNegative && (
              <Badge className="bg-red-100 text-red-800">{t("cashFlowChartGap")}</Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64" data-testid="cash-flow-chart-visual">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt} />
              <Tooltip
                formatter={((value: number, name: string) => [
                  fmt(Math.abs(value)),
                  name,
                ]) as any}
              />
              <Legend />
              <Bar dataKey="inflows" fill="#22c55e" name={t("cashFlowChartReceipts")} radius={[2, 2, 0, 0]} />
              <Bar dataKey="outflows" fill="#ef4444" name={t("cashFlowChartExpenses")} radius={[2, 2, 0, 0]} />
              <Line
                type="monotone"
                dataKey="closing"
                stroke="#6366f1"
                strokeWidth={2}
                dot={{ r: 3, fill: "#6366f1" }}
                name={t("cashFlowChartBalance")}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
