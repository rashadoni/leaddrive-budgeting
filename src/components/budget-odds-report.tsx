"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown, ArrowDownToLine, ArrowUpFromLine } from "lucide-react"

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function useOrgId() {
  const { data: session } = useSession()
  return (session?.user as any)?.organizationId || ""
}

interface ODDSSection {
  activity: string
  label: string
  totalInflow: number
  totalOutflow: number
  net: number
  compareNet?: number
  yoyChange?: number
  inflowByCategory: { category: string; amount: number }[]
  outflowByCategory: { category: string; amount: number }[]
  monthly: { month: number; label: string; inflow: number; outflow: number; net: number }[]
}

interface ODDSData {
  year: number
  compareYear?: number
  sections: ODDSSection[]
  grandInflow: number
  grandOutflow: number
  grandNet: number
}

export function BudgetODDSReport({ year }: { year: number }) {
  const orgId = useOrgId()
  const [compareYear, setCompareYear] = useState<number | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["operating"]))

  const { data, isLoading } = useQuery({
    queryKey: ["budgeting", "odds", year, compareYear, orgId],
    queryFn: async () => {
      const url = `/api/budgeting/cash-flow/odds?year=${year}${compareYear ? `&compareYear=${compareYear}` : ""}`
      const res = await fetch(url, { headers: { "x-organization-id": orgId } })
      const json = await res.json()
      return json.data as ODDSData
    },
    enabled: !!orgId,
  })

  if (isLoading) return <div className="p-6 text-center text-muted-foreground">Loading cash flow report...</div>
  if (!data) return <div className="p-6 text-center text-muted-foreground">No data</div>

  const toggleSection = (activity: string) => {
    const next = new Set(expandedSections)
    if (next.has(activity)) next.delete(activity)
    else next.add(activity)
    setExpandedSections(next)
  }

  const SECTION_COLORS: Record<string, string> = {
    operating: "#22c55e",
    investing: "#3b82f6",
    financing: "#8b5cf6",
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Cash Flow Statement</h3>
          <p className="text-xs text-muted-foreground">Year {year}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Compare with:</span>
          <select
            value={compareYear || ""}
            onChange={(e) => setCompareYear(e.target.value ? Number(e.target.value) : null)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">None</option>
            <option value={year - 1}>{year - 1}</option>
            <option value={year - 2}>{year - 2}</option>
          </select>
        </div>
      </div>

      {/* Sections */}
      {data.sections.map((section) => {
        const isExpanded = expandedSections.has(section.activity)
        const color = SECTION_COLORS[section.activity]

        return (
          <Card key={section.activity} className="overflow-hidden">
            <div className="h-1" style={{ backgroundColor: color }} />
            <CardHeader
              className="pb-2 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => toggleSection(section.activity)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <CardTitle className="text-sm font-semibold">{section.label}</CardTitle>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-lg font-bold tabular-nums ${section.net >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {section.net >= 0 ? "+" : ""}{fmt(section.net)} AZN
                  </span>
                  {section.yoyChange !== undefined && (
                    <Badge variant={section.yoyChange >= 0 ? "default" : "destructive"} className="text-[10px]">
                      {section.yoyChange >= 0 ? "+" : ""}{section.yoyChange}% YoY
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="pt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Inflows */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <ArrowDownToLine className="w-3.5 h-3.5 text-green-600" />
                      <span className="text-xs font-semibold text-green-600">Inflows: {fmt(section.totalInflow)} AZN</span>
                    </div>
                    {section.inflowByCategory.length > 0 ? (
                      <div className="space-y-1">
                        {section.inflowByCategory.map((item) => (
                          <div key={item.category} className="flex justify-between text-xs py-1 border-b last:border-0">
                            <span className="text-muted-foreground">{item.category}</span>
                            <span className="font-medium tabular-nums text-green-700">{fmt(item.amount)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No inflows</p>
                    )}
                  </div>

                  {/* Outflows */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <ArrowUpFromLine className="w-3.5 h-3.5 text-red-600" />
                      <span className="text-xs font-semibold text-red-600">Outflows: {fmt(section.totalOutflow)} AZN</span>
                    </div>
                    {section.outflowByCategory.length > 0 ? (
                      <div className="space-y-1">
                        {section.outflowByCategory.map((item) => (
                          <div key={item.category} className="flex justify-between text-xs py-1 border-b last:border-0">
                            <span className="text-muted-foreground">{item.category}</span>
                            <span className="font-medium tabular-nums text-red-700">{fmt(item.amount)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No outflows</p>
                    )}
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        )
      })}

      {/* Grand Total */}
      <Card className="bg-muted/30">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">Net Cash Flow</span>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <span className="text-xs text-muted-foreground block">Inflows</span>
                <span className="text-sm font-bold tabular-nums text-green-600">{fmt(data.grandInflow)}</span>
              </div>
              <div className="text-right">
                <span className="text-xs text-muted-foreground block">Outflows</span>
                <span className="text-sm font-bold tabular-nums text-red-600">{fmt(data.grandOutflow)}</span>
              </div>
              <div className="text-right pl-3 border-l">
                <span className="text-xs text-muted-foreground block">Net</span>
                <span className={`text-lg font-bold tabular-nums ${data.grandNet >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {data.grandNet >= 0 ? "+" : ""}{fmt(data.grandNet)} AZN
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
