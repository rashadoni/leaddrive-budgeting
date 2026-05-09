"use client"

/**
 * Phase 7.G Turn LXXIV (Phase 4.2 indicator UI badges).
 *
 * Visual indicator that the active plan's period is locked. Renders
 * NOTHING when no lock is active — pure indicator, no layout reservation.
 * Hover shows reason + locked-by + locked-at.
 *
 * Mounted next to the plan selector in `budgeting/page.tsx` header.
 * Could later be reused per-row in tables; for v1 it's plan-level only.
 *
 * Why a separate file (not inline in page.tsx):
 *  - page.tsx is 3984 LOC; per ROADMAP §3.1 we're extracting components,
 *    not adding more inline logic.
 *  - Reusable: VarianceTab/ComparisonTab badge would import same.
 *  - Tests can mount in isolation.
 */

import { useTranslations } from "next-intl"
import { Lock } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  useActivePeriodLockForPlan,
  type PlanPeriodFields,
} from "@/lib/budgeting/use-period-lock"

interface PeriodLockBadgeProps {
  plan: PlanPeriodFields | null
}

export function PeriodLockBadge({ plan }: PeriodLockBadgeProps) {
  const t = useTranslations("budgeting.periodLockBadge")
  const { lock } = useActivePeriodLockForPlan(plan)
  if (!lock) return null

  // Tooltip text: composed lines (period + reason + locked-by + locked-at).
  // Plain text — TooltipContent renders single string with line breaks
  // preserved by `whitespace-pre-line` class.
  const lines: string[] = [t("locked", { period: lock.period })]
  if (lock.reason) lines.push(t("reason", { reason: lock.reason }))
  lines.push(t("by", { who: lock.lockedBy }))
  lines.push(t("at", { when: new Date(lock.lockedAt).toLocaleString() }))
  const tooltipText = lines.join("\n")

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-900 font-medium cursor-help"
            data-testid="period-lock-badge"
            aria-label={t("ariaLabel", { period: lock.period })}
          >
            <Lock className="h-3 w-3" />
            <span className="font-mono">{lock.period}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs whitespace-pre-line">{tooltipText}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
