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
import { BudgetCashFlowEntries } from "@/components/budget-cash-flow-entries"
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
  const [subView, setSubView] = useState<"overview" | "odds" | "plan-fact" | "entries">("overview")
  const { data: cashFlowData } = useCashFlow(year)
  const { data: alerts = [] } = useCashFlowAlerts(year)
  const resolveAlert = useResolveCashFlowAlert()
  const generateCashFlow = useGenerateCashFlow()
  const hasCashFlowData = Boolean(
    cashFlowData &&
      ((cashFlowData.entries?.length ?? 0) > 0 ||
        Math.abs(cashFlowData.totalInflows || 0) > 0 ||
        Math.abs(cashFlowData.totalOutflows || 0) > 0),
  )

  return (
    <div className="space-y-6" data-testid="cash-flow-guide-root">
      {/* Sub-view toggle */}
      <div className="flex items-center justify-between" data-testid="cash-flow-guide-header">
        <div className="flex gap-1 bg-muted rounded-lg p-1" data-testid="cash-flow-subview-tabs">
          {[
            { key: "overview" as const, label: t("cashFlowSubviewOverview"), testId: "cash-flow-subview-overview" },
            { key: "entries" as const, label: t("cashFlowSubviewEntries"), testId: "cash-flow-subview-entries" },
            { key: "odds" as const, label: t("cashFlowSubviewOdds"), testId: "cash-flow-subview-odds" },
            { key: "plan-fact" as const, label: t("cashFlowSubviewPlanFact"), testId: "cash-flow-subview-plan-fact" },
          ].map(({ key, label, testId }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={subView === key}
              data-testid={testId}
              onClick={() => setSubView(key)}
              // Sub-view tab pattern (similar to OnboardingTabbedPage).
              // motion-safe scale tap + focus ring + cursor pointer
              // applied directly to match Button conventions.
              className={`px-4 py-1.5 text-xs font-medium rounded-full transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 motion-safe:active:scale-[0.97] ${
                subView === key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/60"
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
            data-testid="cash-flow-generate-from-budget"
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
        <div data-testid="cash-flow-overview" className="space-y-6">
          {alerts.length > 0 && (
            <BudgetCashFlowAlerts
              alerts={alerts}
              onResolve={(id) => resolveAlert.mutate(id)}
            />
          )}

          {cashFlowData && hasCashFlowData ? (
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
              <CardContent className="py-12 text-center text-muted-foreground" data-testid="cash-flow-empty-state">
                <Banknote className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium text-lg mb-2">{t("cashFlowEmptyTitle")}</p>
                <p className="text-sm">{t("cashFlowEmptyDesc", { year })}</p>
                <p className="text-sm mt-1">{t("cashFlowEmptyHint")}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {subView === "entries" && (
        <div data-testid="cash-flow-entries-view">
          <BudgetCashFlowEntries entries={cashFlowData?.entries ?? []} year={year} />
        </div>
      )}
      {subView === "odds" && (
        <div data-testid="cash-flow-odds-view">
          <BudgetODDSReport year={year} />
        </div>
      )}
      {subView === "plan-fact" && (
        <div data-testid="cash-flow-plan-fact-view">
          <BudgetPlanFactDashboard year={year} />
        </div>
      )}
    </div>
  )
}
