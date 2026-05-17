"use client"

/**
 * Truth-infra E.4 (closure 2026-05-17) — terminal-wide locked-period banner.
 *
 * When the org's `Organization.lockedPeriods` includes the period that
 * `useMatrix()` is currently displaying, render an amber strip above the
 * HeatMap explaining: "Q1 2026 is locked. Mutations rejected." with
 * tooltip-revealed metadata (reason, lockedBy, lockedAt).
 *
 * Pre-this-component the period-lock infrastructure rejected writes with
 * HTTP 423 silently from the terminal user's POV — they'd click an action
 * that just bounced. This banner surfaces the lock state visually so the
 * user knows BEFORE clicking, matching the plan-row PeriodLockBadge
 * pattern at the broader terminal scope.
 *
 * Renders NOTHING when:
 *   - matrix has no `period` yet (initial load)
 *   - org has no locks
 *   - no lock matches the active matrix period
 *
 * Component is independent — no reliance on a specific plan id; it tracks
 * what the matrix is showing. Same pattern as the plan-row
 * `PeriodLockBadge` but scoped to terminal's active period.
 */

import { useEffect, useState } from "react"
import { Lock } from "lucide-react"
import { useTranslations, useLocale } from "next-intl"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useMatrix } from "../hooks/use-matrix"
import type { LockedPeriod } from "@/lib/budgeting/period-lock"

interface LocksResponse {
  locks?: LockedPeriod[]
}

export function TerminalLockedPeriodBanner() {
  const { matrix } = useMatrix()
  const period = matrix?.period
  const t = useTranslations("terminal.lockedPeriodBanner")
  const locale = useLocale()

  const [lock, setLock] = useState<LockedPeriod | null>(null)

  useEffect(() => {
    if (!period) {
      setLock(null)
      return
    }
    let cancelled = false
    fetch("/api/budgeting/period-locks")
      .then((r) => (r.ok ? (r.json() as Promise<LocksResponse>) : null))
      .then((data) => {
        if (cancelled) return
        const found = (data?.locks ?? []).find((l) => l.period === period) ?? null
        setLock(found)
      })
      .catch(() => {
        if (!cancelled) setLock(null)
      })
    return () => {
      cancelled = true
    }
  }, [period])

  if (!lock) return null

  // Tooltip text composed in single string with line breaks; mirrors
  // PeriodLockBadge.tsx so RU/AZ locales pick up identical phrasing.
  const lines: string[] = [t("locked", { period: lock.period })]
  if (lock.reason) lines.push(t("reason", { reason: lock.reason }))
  lines.push(t("by", { who: lock.lockedBy }))
  lines.push(t("at", { when: new Date(lock.lockedAt).toLocaleString(locale) }))
  const tooltipText = lines.join("\n")

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            role="status"
            data-testid="terminal-locked-period-banner"
            aria-label={t("ariaLabel", { period: lock.period })}
            className="flex items-center gap-2 border-b border-amber-700/50 bg-amber-950/40 px-4 py-1.5 text-xs text-amber-200 cursor-help"
          >
            <Lock className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            {/* Render lock.period in a plain span so the value is visible
                regardless of i18n placeholder-substitution support in
                test envs (mirrors PeriodLockBadge.tsx pattern). */}
            <span className="font-mono font-medium" data-testid="terminal-locked-period-value">
              {lock.period}
            </span>
            <span className="font-medium">{t("title", { period: lock.period })}</span>
            <span className="text-amber-300/70">·</span>
            <span className="text-amber-300/80">{t("subtitle")}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm whitespace-pre-line">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
