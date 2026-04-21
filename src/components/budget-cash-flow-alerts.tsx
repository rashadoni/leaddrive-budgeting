"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react"

interface Alert {
  id: string
  year: number
  month: number
  alertType: string
  message: string
  threshold: number | null
  projectedBalance: number
  isResolved: boolean
  createdAt: string
}

interface Props {
  alerts: Alert[]
  onResolve?: (alertId: string) => void
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const ALERT_STYLES: Record<string, { bg: string; icon: string }> = {
  negative_balance: { bg: "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800", icon: "text-red-600 dark:text-red-400" },
  low_balance: { bg: "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-800", icon: "text-yellow-600 dark:text-yellow-400" },
  large_outflow: { bg: "bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-800", icon: "text-orange-600 dark:text-orange-400" },
}

const COLLAPSED_COUNT = 2

export function BudgetCashFlowAlerts({ alerts, onResolve }: Props) {
  const [expanded, setExpanded] = useState(false)

  if (alerts.length === 0) return null

  const visible = expanded ? alerts : alerts.slice(0, COLLAPSED_COUNT)
  const hiddenCount = alerts.length - COLLAPSED_COUNT

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            Cash Flow Alerts
            <Badge className="bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300 text-[10px] px-1.5">{alerts.length}</Badge>
          </span>
          {hiddenCount > 0 && (
            <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
              {expanded ? "Collapse" : `+${hiddenCount} more`}
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-1.5">
          {visible.map((alert) => {
            const style = ALERT_STYLES[alert.alertType] || ALERT_STYLES.negative_balance
            return (
              <div key={alert.id} className={`flex items-center justify-between p-2.5 rounded-lg border ${style.bg}`}>
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${style.icon}`} />
                  <div>
                    <span className="text-xs font-medium">
                      {MONTH_NAMES[alert.month - 1]} {alert.year}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-1.5">
                      ({alert.alertType.replace("_", " ")})
                    </span>
                    <span className="text-xs font-mono ml-2">
                      Balance: <span className="font-bold text-red-700 dark:text-red-400">{fmt(alert.projectedBalance)}</span>
                    </span>
                  </div>
                </div>
                {onResolve && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onResolve(alert.id)}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    Resolve
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
