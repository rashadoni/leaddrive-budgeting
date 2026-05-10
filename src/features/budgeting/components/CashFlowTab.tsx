// CashFlowTab — extracted from `src/app/(dashboard)/budgeting/page.tsx`
// Turn LXXXIII (Phase 3.1 sixth slice; precedent: Variance/Comparison/PL/Plans/Import).
//
// Pure refactor — zero functional change. 3 sub-views toggled via local state:
// overview (chart + table + alerts + generate-from-budget button),
// odds (BudgetODDSReport), plan-fact (BudgetPlanFactDashboard).
//
// Closure-leak risk: NONE. All children are leaf imports; only state is the
// local year (frozen via useState init) + subView toggle. No cross-tab deps.
"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Sparkles, Banknote } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { BudgetCashFlowChart } from "@/components/budget-cash-flow-chart"
import { BudgetCashFlowTable } from "@/components/budget-cash-flow-table"
import { BudgetCashFlowAlerts } from "@/components/budget-cash-flow-alerts"
import { BudgetODDSReport } from "@/components/budget-odds-report"
import { BudgetPlanFactDashboard } from "@/components/budget-plan-fact-dashboard"
import {
  useCashFlow,
  useCashFlowAlerts,
  useResolveCashFlowAlert,
  useGenerateCashFlow,
} from "@/lib/budgeting/hooks"

export function CashFlowTab() {
  const t = useTranslations("budgeting")
  const [year] = useState(new Date().getFullYear())
  const [subView, setSubView] = useState<"overview" | "odds" | "plan-fact">("overview")
  const { data: cashFlowData } = useCashFlow(year)
  const { data: alerts = [] } = useCashFlowAlerts(year)
  const resolveAlert = useResolveCashFlowAlert()
  const generateCashFlow = useGenerateCashFlow()

  return (
    <div className="space-y-6">
      {/* Sub-view toggle */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {[
            { key: "overview" as const, label: t("cashFlowSubviewOverview") },
            { key: "odds" as const, label: t("cashFlowSubviewOdds") },
            { key: "plan-fact" as const, label: t("cashFlowSubviewPlanFact") },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSubView(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                subView === key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {subView === "overview" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => generateCashFlow.mutate({ year })}
            disabled={generateCashFlow.isPending}
          >
            {generateCashFlow.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
            {t("cashFlowGenerateFromBudget")}
          </Button>
        )}
      </div>

      {/* Sub-views */}
      {subView === "overview" && (
        <>
          {alerts.length > 0 && (
            <BudgetCashFlowAlerts
              alerts={alerts}
              onResolve={(id) => resolveAlert.mutate(id)}
            />
          )}

          {cashFlowData && cashFlowData.months.length > 0 ? (
            <>
              <BudgetCashFlowChart
                months={cashFlowData.months}
                year={cashFlowData.year}
                totalInflows={cashFlowData.totalInflows}
                totalOutflows={cashFlowData.totalOutflows}
              />
              <BudgetCashFlowTable months={cashFlowData.months} />
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Banknote className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium text-lg mb-2">{t("cashFlowEmptyTitle")}</p>
                <p className="text-sm">{t("cashFlowEmptyDesc", { year })}</p>
                <p className="text-sm mt-1">{t("cashFlowEmptyHint")}</p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {subView === "odds" && <BudgetODDSReport year={year} />}
      {subView === "plan-fact" && <BudgetPlanFactDashboard year={year} />}
    </div>
  )
}
