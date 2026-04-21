"use client"

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

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function fmt(n: number): string {
  if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1) + "M"
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(0) + "K"
  return n.toFixed(0)
}

export function BudgetCashFlowChart({ months, year, totalInflows, totalOutflows }: Props) {
  const chartData = months.map((m) => ({
    name: MONTH_NAMES[m.month - 1],
    inflows: m.inflows,
    outflows: -m.outflows,
    closing: m.closing,
  }))

  const hasNegative = months.some((m) => m.closing < 0)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Banknote className="h-4 w-4" />
            Cash Flow — {year}
          </span>
          <div className="flex gap-2">
            <Badge variant="outline" className="text-green-700 bg-green-50">
              Inflows: {fmt(totalInflows)}
            </Badge>
            <Badge variant="outline" className="text-red-700 bg-red-50">
              Outflows: {fmt(totalOutflows)}
            </Badge>
            {hasNegative && (
              <Badge className="bg-red-100 text-red-800">Cash Gap</Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt} />
              <Tooltip
                formatter={((value: number, name: string) => [
                  fmt(Math.abs(value)),
                  name === "outflows" ? "Expenses" : name === "inflows" ? "Receipts" : "Balance",
                ]) as any}
              />
              <Legend />
              <Bar dataKey="inflows" fill="#22c55e" name="Receipts" radius={[2, 2, 0, 0]} />
              <Bar dataKey="outflows" fill="#ef4444" name="Expenses" radius={[2, 2, 0, 0]} />
              <Line
                type="monotone"
                dataKey="closing"
                stroke="#6366f1"
                strokeWidth={2}
                dot={{ r: 3, fill: "#6366f1" }}
                name="Balance"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
