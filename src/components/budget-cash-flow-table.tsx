"use client"

import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table2 } from "lucide-react"

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
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function BudgetCashFlowTable({ months }: Props) {
  const t = useTranslations("budgeting")
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Table2 className="h-4 w-4" />
          {t("oddsTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="py-2 px-3 text-left font-medium">{t("cashFlowColMonth")}</th>
                <th className="py-2 px-3 text-right font-medium">{t("cashFlowColOpening")}</th>
                <th className="py-2 px-3 text-right font-medium text-green-700">{t("cashFlowColInflows")}</th>
                <th className="py-2 px-3 text-right font-medium text-red-700">{t("cashFlowColOutflows")}</th>
                <th className="py-2 px-3 text-right font-medium">{t("cashFlowColNet")}</th>
                <th className="py-2 px-3 text-right font-medium">{t("cashFlowColClosing")}</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className={`border-b ${m.closing < 0 ? "bg-red-50 dark:bg-red-900/10" : ""}`}>
                  <td className="py-1.5 px-3 font-medium">{MONTH_NAMES[m.month - 1]} {m.year}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-xs">{fmt(m.opening)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-xs text-green-700">+{fmt(m.inflows)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-xs text-red-700">-{fmt(m.outflows)}</td>
                  <td className={`py-1.5 px-3 text-right font-mono text-xs font-medium ${m.net >= 0 ? "text-green-700" : "text-red-700"}`}>
                    {m.net >= 0 ? "+" : ""}{fmt(m.net)}
                  </td>
                  <td className={`py-1.5 px-3 text-right font-mono text-xs font-bold ${m.closing < 0 ? "text-red-700" : ""}`}>
                    {fmt(m.closing)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 font-bold">
                <td className="py-2 px-3">{t("cashFlowTotal")}</td>
                <td className="py-2 px-3 text-right font-mono text-xs">{fmt(months[0]?.opening || 0)}</td>
                <td className="py-2 px-3 text-right font-mono text-xs text-green-700">
                  +{fmt(months.reduce((s, m) => s + m.inflows, 0))}
                </td>
                <td className="py-2 px-3 text-right font-mono text-xs text-red-700">
                  -{fmt(months.reduce((s, m) => s + m.outflows, 0))}
                </td>
                <td className="py-2 px-3 text-right font-mono text-xs">
                  {fmt(months.reduce((s, m) => s + m.net, 0))}
                </td>
                <td className="py-2 px-3 text-right font-mono text-xs font-bold">
                  {fmt(months[months.length - 1]?.closing || 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
