// RollingTab — extracted from `src/app/(dashboard)/budgeting/page.tsx`
// Turn LXXXIV (Phase 3.1 seventh slice; precedent: Variance/Comparison/PL/
// Plans/Import/CashFlow).
//
// Pure refactor — zero functional change. Loads rolling-flagged plan via
// useBudgetPlans + useRollingForecast; renders empty/loading/data states
// over BudgetRollingForecast. Three mutations: autoForecast / closeMonth /
// reopenMonth.
//
// Closure-leak risk: NONE. All children leaf imports; no parent state
// captured; rollingPlanId is derived from hook data inside this component.
"use client"

import { useTranslations } from "next-intl"
import { CalendarRange } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { BudgetRollingForecast } from "@/components/budget-rolling-forecast"
import {
  useBudgetPlans,
  useRollingForecast,
  useAutoForecast,
  useCloseRollingMonth,
  useReopenRollingMonth,
} from "@/lib/budgeting/hooks"

type RollingPlan = { id: string; isRolling?: boolean }

export function RollingTab() {
  const t = useTranslations("budgeting")
  const { data: plans = [] } = useBudgetPlans()
  const rollingPlan = (plans as RollingPlan[]).find((p) => p.isRolling)
  const rollingPlanId = rollingPlan?.id || null
  const { data: rollingData } = useRollingForecast(rollingPlanId)
  const autoForecast = useAutoForecast()
  const closeMonth = useCloseRollingMonth()
  const reopenMonth = useReopenRollingMonth()

  if (!rollingPlan) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <CalendarRange className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-lg mb-2">{t("rollingForecastTitle")}</p>
          <p className="text-sm">{t("rollingNoPlanDesc")}</p>
          <p className="text-sm mt-1">{t("rollingNoPlanHint")}</p>
        </CardContent>
      </Card>
    )
  }

  if (!rollingData || !rollingData.months.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <CalendarRange className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-lg mb-2">{t("rollingLoading")}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <BudgetRollingForecast
        months={rollingData.months}
        totalRevenue={rollingData.revenue}
        totalExpense={rollingData.expense}
        totalMargin={rollingData.margin}
        onAutoForecast={() => autoForecast.mutate({ planId: rollingPlanId! })}
        isForecasting={autoForecast.isPending}
        onCloseMonth={(year, month) => closeMonth.mutate({ planId: rollingPlanId!, year, month })}
        isClosingMonth={closeMonth.isPending}
        onReopenMonth={(year, month) => reopenMonth.mutate({ planId: rollingPlanId!, year, month })}
        isReopeningMonth={reopenMonth.isPending}
      />
    </div>
  )
}
