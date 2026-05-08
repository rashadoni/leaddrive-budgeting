"use client"

/**
 * Phase 7.G Turn LXX (Phase 4.2 closure) — admin page for fiscal-period
 * lock management. Lists currently locked periods + admin form to add a
 * new lock + per-row remove button. Wraps `/api/budgeting/period-locks`.
 *
 * Scope:
 *  - Visible to ANY authenticated org member (read).
 *  - POST/DELETE require admin role; UI elements that mutate are
 *    rendered for everyone but the API enforces. We leave the UI elements
 *    visible (rather than role-hiding) so non-admin users see what
 *    "would be possible" — surfaces the admin contact path naturally.
 *
 * Design constraints:
 *  - i18n via next-intl `useTranslations` — all visible strings keyed
 *    under `budgeting.periodLocks`. Locale-specific quirks (cyrillic in
 *    RU, Latin-extended in AZ) verified via vitest.setup.ts
 *    EXPLICIT_LABELS mirror.
 *  - Period format string surfaced verbatim ("YYYY" / "YYYY-Q[1-4]" /
 *    "YYYY-MM") since CFO already knows fiscal-period notation.
 */

import { useState, useEffect, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Lock, Unlock, Loader2, AlertCircle } from "lucide-react"
import type { LockedPeriod } from "@/lib/budgeting/period-lock"

interface ApiAddResponse {
  lock: LockedPeriod
  isNew: boolean
  auditStale?: boolean
}

interface ApiListResponse {
  locks: LockedPeriod[]
}

export function PeriodLocksAdmin() {
  const t = useTranslations("budgeting.periodLocks")
  const [locks, setLocks] = useState<LockedPeriod[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState("")
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const fetchLocks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/budgeting/period-locks")
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as ApiListResponse
      setLocks(data.locks)
    } catch (e: any) {
      setError(e?.message || "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchLocks()
  }, [fetchLocks])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!period.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/budgeting/period-locks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ period: period.trim(), reason: reason.trim() || undefined }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (res.status === 403) throw new Error(t("errAdminOnly"))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as ApiAddResponse
      if (!data.isNew) {
        // Already locked — show a non-error notice via state
        setError(t("noticeAlreadyLocked", { period: data.lock.period }))
      }
      setPeriod("")
      setReason("")
      void fetchLocks()
    } catch (e: any) {
      setError(e?.message || "Failed to add")
    } finally {
      setSubmitting(false)
    }
  }

  const handleRemove = async (p: string) => {
    if (!confirm(t("confirmRemove", { period: p }))) return
    setError(null)
    try {
      const res = await fetch("/api/budgeting/period-locks", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ period: p }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (res.status === 403) throw new Error(t("errAdminOnly"))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      void fetchLocks()
    } catch (e: any) {
      setError(e?.message || "Failed to remove")
    }
  }

  return (
    <div className="space-y-6 animate-fade-in-up" data-testid="period-locks-admin">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            {t("addTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
              <Input
                placeholder={t("periodPlaceholder")}
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                pattern="\d{4}(-Q[1-4]|-(0[1-9]|1[0-2]))?"
                title={t("periodHint")}
                required
                aria-label={t("periodPlaceholder")}
              />
              <Input
                placeholder={t("reasonPlaceholder")}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                aria-label={t("reasonPlaceholder")}
              />
              <Button type="submit" disabled={submitting || !period.trim()}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t("addButton")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("periodHint")}</p>
          </form>
        </CardContent>
      </Card>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("listTitle", { count: locks.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
            </div>
          ) : locks.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="divide-y divide-border" data-testid="period-locks-list">
              {locks.map((lock) => (
                <li key={lock.period} className="flex items-start justify-between gap-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Lock className="h-4 w-4 text-amber-600" />
                      <span className="font-mono font-semibold">{lock.period}</span>
                    </div>
                    {lock.reason && (
                      <p className="text-sm text-foreground mt-1">{lock.reason}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("metaLine", {
                        when: new Date(lock.lockedAt).toLocaleString(),
                        by: lock.lockedBy,
                      })}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(lock.period)}
                    aria-label={t("unlockAria", { period: lock.period })}
                  >
                    <Unlock className="h-4 w-4 mr-1" />
                    {t("unlockButton")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
