"use client"

/**
 * Phase 7.G Turn LXXII (Phase 4.3 closure) — admin page for approval
 * requests. Lists pending/approved/rejected/cancelled requests with
 * filter pills, per-row approve/reject buttons (manager+) + cancel
 * button (requester or admin). Wraps `/api/budgeting/approval-requests`
 * + `/api/budgeting/approval-requests/[id]` PATCH.
 *
 * Design constraints:
 *  - i18n via next-intl `useTranslations` — all visible strings keyed
 *    under `budgeting.approvalRequests`.
 *  - Period (proposedChange) blob shown as JSON preview for v1; deeper
 *    typed rendering deferred until customer asks (the period_unlock
 *    case is the only common one — surfaced as plain text).
 *  - All 4 statuses visible by default; filter pills narrow the view.
 *  - Action buttons rendered for everyone; API enforces role gate. UI
 *    visibility surfaces the admin contact path naturally.
 */

import { useState, useEffect, useCallback } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertCircle, Check, X, Ban, Clock } from "lucide-react"
import { DataBoundary } from "@/components/ui/data-boundary"

type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled"
type ApprovalAction = "approve" | "reject" | "cancel"

interface ApprovalRequestRow {
  id: string
  organizationId: string
  planId: string | null
  requestType: string
  targetType: string | null
  targetId: string | null
  proposedChange: unknown
  reason: string | null
  status: ApprovalStatus
  requestedBy: string
  requestedAt: string
  reviewedBy: string | null
  reviewedAt: string | null
  reviewComment: string | null
  appliedAt: string | null
}

const STATUSES: readonly ApprovalStatus[] = ["pending", "approved", "rejected", "cancelled"] as const

function statusIcon(status: ApprovalStatus) {
  switch (status) {
    case "pending":
      return <Clock className="h-4 w-4 text-amber-600" />
    case "approved":
      return <Check className="h-4 w-4 text-green-600" />
    case "rejected":
      return <X className="h-4 w-4 text-red-600" />
    case "cancelled":
      return <Ban className="h-4 w-4 text-muted-foreground" />
  }
}

export function ApprovalRequestsAdmin() {
  const t = useTranslations("budgeting.approvalRequests")
  // Phase 7.G Turn LXXIV follow-up² (locale-leak parity fix from architect 💡):
  // toLocaleString() defaults to browser locale, NOT next-intl locale.
  // Pass useLocale() to format dates per the user's UI language.
  const locale = useLocale()
  const [requests, setRequests] = useState<ApprovalRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | "all">("pending")

  const fetchRequests = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const url =
        statusFilter === "all"
          ? "/api/budgeting/approval-requests"
          : `/api/budgeting/approval-requests?status=${statusFilter}`
      const res = await fetch(url)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as { requests: ApprovalRequestRow[] }
      setRequests(data.requests)
    } catch (e: any) {
      setError(e?.message || t("errLoad"))
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    void fetchRequests()
  }, [fetchRequests])

  const handleAction = async (id: string, action: ApprovalAction) => {
    if (action === "cancel" && !confirm(t("confirmCancel"))) return
    if (action === "reject" && !confirm(t("confirmReject"))) return
    setError(null)
    try {
      const res = await fetch(`/api/budgeting/approval-requests/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (res.status === 403) throw new Error(t("errInsufficientRole"))
        if (res.status === 409) throw new Error(t("errAlreadyReviewed"))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      void fetchRequests()
    } catch (e: any) {
      setError(e?.message || "Failed")
    }
  }

  return (
    <div className="space-y-6 animate-fade-in-up" data-testid="approval-requests-admin">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">{t("filterTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={statusFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("all")}
            >
              {t("filterAll")}
            </Button>
            {STATUSES.map((s) => (
              <Button
                key={s}
                type="button"
                variant={statusFilter === s ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(s)}
              >
                {t(`status_${s}`)}
              </Button>
            ))}
          </div>
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
          <CardTitle>{t("listTitle", { count: requests.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataBoundary loading={loading}>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="divide-y divide-border" data-testid="approval-requests-list">
              {requests.map((r) => (
                <li key={r.id} className="py-4 space-y-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {statusIcon(r.status)}
                        <span className="font-mono text-xs uppercase font-semibold">{r.requestType}</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">{t(`status_${r.status}`)}</span>
                      </div>
                      {r.reason && <p className="text-sm text-foreground mt-1">{r.reason}</p>}
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("requestedMeta", {
                          when: new Date(r.requestedAt).toLocaleString(locale),
                          by: r.requestedBy,
                        })}
                      </p>
                      {r.reviewedAt && r.reviewedBy && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("reviewedMeta", {
                            when: new Date(r.reviewedAt).toLocaleString(locale),
                            by: r.reviewedBy,
                          })}
                          {r.reviewComment ? ` — "${r.reviewComment}"` : null}
                        </p>
                      )}
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                          {t("proposedChangeToggle")}
                        </summary>
                        <pre className="mt-1 rounded bg-muted/30 p-2 overflow-x-auto text-foreground font-mono text-[11px]">
                          {JSON.stringify(r.proposedChange, null, 2)}
                        </pre>
                      </details>
                    </div>
                    {r.status === "pending" && (
                      <div className="flex gap-2 shrink-0">
                        <Button
                          type="button"
                          size="sm"
                          variant="default"
                          onClick={() => handleAction(r.id, "approve")}
                          aria-label={t("approveAria", { id: r.id })}
                        >
                          <Check className="h-4 w-4 mr-1" /> {t("approveButton")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleAction(r.id, "reject")}
                          aria-label={t("rejectAria", { id: r.id })}
                        >
                          <X className="h-4 w-4 mr-1" /> {t("rejectButton")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleAction(r.id, "cancel")}
                          aria-label={t("cancelAria", { id: r.id })}
                        >
                          <Ban className="h-4 w-4 mr-1" /> {t("cancelButton")}
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          </DataBoundary>
        </CardContent>
      </Card>
    </div>
  )
}
