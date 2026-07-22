"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useLocale, useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { GitCompare } from "lucide-react"
import { formatComparisonAmount } from "@/lib/budgeting/comparison-view"

interface DiffLine {
  category: string
  department: string | null
  lineType: string
  planA: number
  planB: number
  delta: number
  status: "added" | "removed" | "changed" | "unchanged"
}

interface DiffData {
  planA: string
  planB: string
  totalChanges: number
  diff: DiffLine[]
}

interface Props {
  data: DiffData | null
  isLoading?: boolean
  versionLabelA?: string
  versionLabelB?: string
  currencyCode: string
}

const STATUS_STYLES: Record<DiffLine["status"], { bg: string; text: string; key: "plansDiffAdded" | "plansDiffRemoved" | "plansDiffChanged" | "plansDiffSame" }> = {
  added: { bg: "bg-green-50", text: "text-green-700", key: "plansDiffAdded" },
  removed: { bg: "bg-red-50", text: "text-red-700", key: "plansDiffRemoved" },
  changed: { bg: "bg-yellow-50", text: "text-yellow-700", key: "plansDiffChanged" },
  unchanged: { bg: "bg-card", text: "text-muted-foreground", key: "plansDiffSame" },
}

export function BudgetVersionDiff({ data, isLoading, versionLabelA, versionLabelB, currencyCode }: Props) {
  const t = useTranslations("budgeting")
  const locale = useLocale()
  const fmt = (value: number) => formatComparisonAmount(value, locale, currencyCode)
  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          {t("plansDiffLoading")}
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  const changes = data.diff.filter((d) => d.status !== "unchanged")
  const unchanged = data.diff.filter((d) => d.status === "unchanged")

  return (
    <Card data-testid="plans-version-diff">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <GitCompare className="h-4 w-4" />
          {t("plansVersionComparisonTitle")}
          <Badge variant="outline" className="ml-2">
            {t("plansDiffChangeCount", { count: data.totalChanges })}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4 font-medium">{t("plansDiffCategory")}</th>
                <th className="py-2 pr-4 font-medium">{t("plansDiffDepartment")}</th>
                <th className="py-2 pr-4 font-medium">{t("plansDiffType")}</th>
                <th className="py-2 pr-4 font-medium text-right">{versionLabelA || "Plan A"}</th>
                <th className="py-2 pr-4 font-medium text-right">{versionLabelB || "Plan B"}</th>
                <th className="py-2 pr-4 font-medium text-right">{t("plansDiffDelta")}</th>
                <th className="py-2 font-medium">{t("plansDiffStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((line, i) => {
                const style = STATUS_STYLES[line.status]
                return (
                  <tr key={i} className={`border-b ${style.bg}`}>
                    <td className="py-1.5 pr-4">{line.category}</td>
                    <td className="py-1.5 pr-4 text-muted-foreground">{line.department || "—"}</td>
                    <td className="py-1.5 pr-4">{line.lineType}</td>
                    <td className="py-1.5 pr-4 text-right font-mono">{line.status === "added" ? "—" : fmt(line.planA)}</td>
                    <td className="py-1.5 pr-4 text-right font-mono">{line.status === "removed" ? "—" : fmt(line.planB)}</td>
                    <td className="py-1.5 pr-4 text-right font-mono font-medium text-foreground">
                      {line.delta > 0 ? "+" : ""}{fmt(line.delta)}
                    </td>
                    <td className="py-1.5">
                      <Badge className={`text-[10px] ${style.bg} ${style.text} border`}>
                        {t(style.key)}
                      </Badge>
                    </td>
                  </tr>
                )
              })}
              {unchanged.length > 0 && (
                <tr className="border-b bg-muted/30">
                  <td colSpan={7} className="py-2 text-center text-xs text-muted-foreground">
                    {t("plansDiffUnchangedHidden", { count: unchanged.length })}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
