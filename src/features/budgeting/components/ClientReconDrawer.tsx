"use client"

/**
 * Phase 7.H Feature 5 — Client-reported EBITDA reconciliation drawer.
 *
 * Right-sliding panel that lets a manager-or-higher user enter the
 * EBITDA value reported by the client for a given (company × period),
 * see how it compares to our system-computed EBITDA, and store the
 * delta with an audit trail. The drawer is opened from the EBITDA KPI
 * card in `BudgetPnlView`; the trigger is gated by role so viewers
 * see the panel in read-only mode.
 *
 * Drill-down: the bottom section lists the top-5 P&L row contributors
 * to absolute EBITDA, with D&A rows pinned + badged — this is the
 * "where might the client be classifying differently?" first-look.
 */

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Save, Trash2, AlertCircle, TrendingDown, TrendingUp } from "lucide-react"
import { isDaCode } from "@/lib/budgeting/da-codes"

export interface ClientReconciliationRow {
  id: string
  companyId: string
  period: string
  indicatorKey: string
  value: number
  currency: string
  note: string | null
  submittedById: string | null
  submittedAt: string
  updatedAt: string
}

export interface PnlContributorRow {
  accountCode: string
  accountName: string
  /** Section the row belongs to — used for sign convention in the table. */
  section: "revenue" | "cogs" | "opex" | "below" | "other"
  total: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  /** Period for which the user reconciles — display only; the user can
   *  switch via the period selector. Defaults to the active plan's period. */
  defaultPeriod: string
  /** System-computed EBITDA for the displayed period. Used to render
   *  the variance number live as the user types. */
  systemEbitda: number
  /** Top-5 P&L contributors (revenue / cogs / opex / below-EBITDA rows). */
  contributors: PnlContributorRow[]
  /** True when current user role is at least "manager" — gates editing. */
  canEdit: boolean
}

function fmtNumLocal(n: number): string {
  if (!Number.isFinite(n)) return "—"
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(0)
}

function variancePct(client: number, system: number): number | null {
  if (system === 0) return null
  return ((client - system) / Math.abs(system)) * 100
}

export function ClientReconDrawer({
  open,
  onOpenChange,
  companyId,
  defaultPeriod,
  systemEbitda,
  contributors,
  canEdit,
}: Props) {
  const t = useTranslations("budgeting.reconciliation")
  const queryClient = useQueryClient()

  const [period, setPeriod] = useState(defaultPeriod)
  const [value, setValue] = useState<string>("")
  const [currency, setCurrency] = useState("AZN")
  const [note, setNote] = useState("")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Re-sync local form state when the drawer reopens for a different period.
  useEffect(() => {
    if (open) {
      setPeriod(defaultPeriod)
      setErrorMsg(null)
    }
  }, [open, defaultPeriod])

  const reconQuery = useQuery({
    queryKey: ["client-recon", companyId, period],
    enabled: open && !!companyId && !!period,
    queryFn: async () => {
      const url = new URL(
        `/api/companies/${companyId}/reconciliation`,
        typeof window !== "undefined" ? window.location.origin : "http://localhost",
      )
      url.searchParams.set("period", period)
      url.searchParams.set("indicatorKey", "EBITDA")
      const res = await fetch(url.toString())
      if (!res.ok) throw new Error(`Failed to load reconciliations (${res.status})`)
      const body = (await res.json()) as { rows: ClientReconciliationRow[] }
      return body.rows[0] ?? null
    },
  })

  // Hydrate form with the stored row whenever the query returns.
  useEffect(() => {
    if (reconQuery.data) {
      setValue(String(reconQuery.data.value))
      setCurrency(reconQuery.data.currency)
      setNote(reconQuery.data.note ?? "")
    } else if (reconQuery.isFetched) {
      // No existing row → start fresh.
      setValue("")
      setCurrency("AZN")
      setNote("")
    }
  }, [reconQuery.data, reconQuery.isFetched])

  const submitMutation = useMutation({
    mutationFn: async () => {
      const numeric = Number(value)
      if (!Number.isFinite(numeric)) {
        throw new Error(t("errorInvalidNumber"))
      }
      const res = await fetch(`/api/companies/${companyId}/reconciliation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          period,
          indicatorKey: "EBITDA",
          value: numeric,
          currency,
          note: note.trim() ? note.trim() : undefined,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      return res.json()
    },
    onSuccess: () => {
      setErrorMsg(null)
      queryClient.invalidateQueries({ queryKey: ["client-recon", companyId] })
    },
    onError: (err: Error) => {
      setErrorMsg(err.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!reconQuery.data) return
      const url = new URL(
        `/api/companies/${companyId}/reconciliation`,
        typeof window !== "undefined" ? window.location.origin : "http://localhost",
      )
      url.searchParams.set("reconciliationId", reconQuery.data.id)
      const res = await fetch(url.toString(), { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      return res.json()
    },
    onSuccess: () => {
      setErrorMsg(null)
      queryClient.invalidateQueries({ queryKey: ["client-recon", companyId] })
    },
    onError: (err: Error) => {
      setErrorMsg(err.message)
    },
  })

  const numericValue = Number(value)
  const haveValueForPreview = value.trim() !== "" && Number.isFinite(numericValue)
  const variance = haveValueForPreview ? variancePct(numericValue, systemEbitda) : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>

        {/* Comparison strip */}
        <div className="mt-6 grid grid-cols-3 gap-3">
          <div className="rounded-lg border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("systemEbitdaLabel")}
            </div>
            <div className="text-lg font-semibold tabular-nums">
              {fmtNumLocal(systemEbitda)} <span className="text-xs text-muted-foreground">AZN</span>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("clientEbitdaLabel")}
            </div>
            <div className="text-lg font-semibold tabular-nums">
              {haveValueForPreview ? `${fmtNumLocal(numericValue)} ` : "— "}
              <span className="text-xs text-muted-foreground">{currency}</span>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("varianceLabel")}
            </div>
            <div
              className={`flex items-center gap-1 text-lg font-semibold tabular-nums ${
                variance == null
                  ? "text-muted-foreground"
                  : variance >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
              }`}
            >
              {variance == null ? (
                "—"
              ) : (
                <>
                  {variance >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {variance >= 0 ? "+" : ""}
                  {variance.toFixed(1)}%
                </>
              )}
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="recon-period">{t("period")}</Label>
            <Input
              id="recon-period"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="2026 | 2026-Q2 | 2026-04"
              disabled={!canEdit}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="recon-value">{t("clientValue")}</Label>
              <Input
                id="recon-value"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="850000"
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recon-currency">{t("currency")}</Label>
              <Input
                id="recon-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                placeholder="AZN"
                disabled={!canEdit}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="recon-note">{t("note")}</Label>
            <Textarea
              id="recon-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              rows={3}
              placeholder={t("notePlaceholder")}
              disabled={!canEdit}
            />
            <div className="text-[10px] text-muted-foreground text-right">{note.length} / 500</div>
          </div>

          {errorMsg && (
            <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {canEdit && (
            <div className="flex gap-2">
              <Button
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending || !value.trim()}
                className="flex-1"
              >
                {submitMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                {t("submitButton")}
              </Button>
              {reconQuery.data && (
                <Button
                  variant="destructive"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
          )}

          {reconQuery.data?.submittedById && (
            <div className="text-[11px] text-muted-foreground">
              {t("submittedBy", {
                user: reconQuery.data.submittedById,
                at: new Date(reconQuery.data.submittedAt).toLocaleString(),
              })}
            </div>
          )}
        </div>

        {/* Drill-down: top-5 contributors */}
        <div className="mt-8">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
            {t("topRowsHeader")}
          </div>
          <div className="rounded-lg border bg-card divide-y">
            {contributors.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">{t("noRows")}</div>
            ) : (
              contributors.map((r) => (
                <div key={`${r.accountCode}-${r.accountName}`} className="p-3 flex items-center gap-2">
                  <span className="text-[10px] font-mono text-muted-foreground w-16 shrink-0">
                    {r.accountCode}
                  </span>
                  <span className="text-sm flex-1 truncate">{r.accountName}</span>
                  {isDaCode(r.accountCode) && (
                    <Badge variant="secondary" className="text-[10px]">
                      {t("daBadge")}
                    </Badge>
                  )}
                  <span className="text-sm tabular-nums w-20 text-right">
                    {fmtNumLocal(r.total)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
