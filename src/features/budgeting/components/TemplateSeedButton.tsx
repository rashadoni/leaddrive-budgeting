// TemplateSeedButton — extracted from `src/app/(dashboard)/budgeting/page.tsx`
// Turn LXXXX (Phase 3.1 cleanup batch slice 3; TemplateSeedButton ~76 LOC).
// Pure refactor — zero functional change. Auto-seed default expense+revenue
// categories from cost-model when a fresh plan has 0 lines. Mounted in
// page header on every /budgeting tab; uses count-only hook to avoid
// prefetching 4.3 MB of BudgetLines (Turn-38-sub12 architect Round-1
// closure for hot-path).
"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { useCreateBudgetLine, useBudgetLineCount } from "@/lib/budgeting/hooks"
import {
  DEFAULT_EXPENSE_CATEGORIES, DEFAULT_REVENUE_CATEGORIES,
} from "@/lib/budgeting/types"
import { TEMPLATE_CATEGORY_MAP } from "@/lib/budgeting/cost-model-map"

export function TemplateSeedButton({ planId }: { planId: string }) {
  const t = useTranslations("budgeting")
  const createLine = useCreateBudgetLine()
  const { data: countData } = useBudgetLineCount(planId)
  const lineCount = countData?.count ?? 0
  const [seeding, setSeeding] = useState(false)

  if (lineCount > 0) return null

  const seed = async () => {
    setSeeding(true)

    // Collect all costModelKeys to resolve from cost model
    const allCategories = [...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_REVENUE_CATEGORIES]
    const keysToResolve = allCategories
      .map(cat => TEMPLATE_CATEGORY_MAP[cat])
      .filter(Boolean) as string[]

    // Resolve cost model values in one API call
    let costValues: Record<string, number> = {}
    if (keysToResolve.length > 0) {
      try {
        const res = await fetch("/api/budgeting/resolve-costs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keys: keysToResolve }),
        })
        const json = await res.json()
        if (json.success) costValues = json.data
      } catch { /* fallback to 0 if cost model unavailable */ }
    }

    const expenseLines = DEFAULT_EXPENSE_CATEGORIES.map((category, i) => {
      const cmKey = TEMPLATE_CATEGORY_MAP[category] || undefined
      const cmValue = cmKey ? (costValues[cmKey] ?? 0) : 0
      return {
        planId,
        category,
        lineType: "expense" as const,
        plannedAmount: cmValue,
        forecastAmount: cmValue || undefined,
        sortOrder: i,
        costModelKey: cmKey,
        isAutoActual: !!cmKey,
      }
    })
    const revenueLines = DEFAULT_REVENUE_CATEGORIES.map((category, i) => {
      const cmKey = TEMPLATE_CATEGORY_MAP[category] || undefined
      const cmValue = cmKey ? (costValues[cmKey] ?? 0) : 0
      return {
        planId,
        category,
        lineType: "revenue" as const,
        plannedAmount: cmValue,
        forecastAmount: cmValue || undefined,
        sortOrder: i + 100,
        costModelKey: cmKey,
        isAutoActual: !!cmKey,
      }
    })
    for (const line of [...expenseLines, ...revenueLines]) {
      await createLine.mutateAsync(line)
    }
    setSeeding(false)
  }

  return (
    <button onClick={seed} disabled={seeding}
      className="ml-2 text-xs text-purple-600 dark:text-purple-400 underline underline-offset-2 hover:no-underline disabled:opacity-50">
      {seeding ? t("templateLoading") : t("templateReady")}
    </button>
  )
}
