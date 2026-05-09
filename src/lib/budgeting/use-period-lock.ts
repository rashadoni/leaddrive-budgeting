"use client"

/**
 * Phase 7.G Turn LXXIV (Phase 4.2 indicator UI badges).
 *
 * Client-side hook resolving the active period-lock (if any) for a
 * given BudgetPlan. Wraps `/api/budgeting/period-locks` GET (returns
 * the org's full lock list) + derives the plan's period key locally
 * via `derivePeriodKey`.
 *
 * Why client-side derive (vs new endpoint `?planId=X`):
 *  - Lock list is small (≤34 entries per ROADMAP §4.2 sizing) — single
 *    GET fetches everything; no over-fetching concern.
 *  - Reusable: a future per-plan badge can list all locks and color-
 *    code by relevance without a second call.
 *  - One endpoint to maintain — admin UI's `PeriodLocksAdmin` already
 *    consumes the same shape.
 *
 * Caching: simple `useState` + `useEffect`; no SWR/react-query yet
 * because the lock list changes ~daily (CFO close action) — staleness
 * tolerance is high. Reload happens on plan change OR component remount.
 */

import { useEffect, useState } from "react"
import { derivePeriodKey, type LockedPeriod } from "./period-lock"

export interface PlanPeriodFields {
  id: string
  periodType: string | null
  year: number
  month?: number | null
  quarter?: number | null
}

interface State {
  lock: LockedPeriod | null
  loading: boolean
}

export function useActivePeriodLockForPlan(plan: PlanPeriodFields | null): State {
  const [lock, setLock] = useState<LockedPeriod | null>(null)
  const [loading, setLoading] = useState<boolean>(false)

  useEffect(() => {
    if (!plan) {
      setLock(null)
      return
    }
    let cancelled = false
    setLoading(true)
    fetch("/api/budgeting/period-locks")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { locks?: LockedPeriod[] } | null) => {
        if (cancelled) return
        const periodKey = derivePeriodKey(plan)
        const found = (data?.locks ?? []).find((l) => l.period === periodKey) ?? null
        setLock(found)
      })
      .catch(() => {
        if (!cancelled) setLock(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [plan?.id, plan?.periodType, plan?.year, plan?.month, plan?.quarter])

  return { lock, loading }
}
