"use client"
/**
 * Phase 3 — Cash Flow per-entry edit view.
 *
 * The CF overview is a monthly summary (no per-entry handles), so corrections
 * needed their own list. This renders the individual cash_flow_entries with
 * inline edit (amount / type / description) + delete, wired to the
 * PUT/DELETE /api/budgeting/cash-flow/[id] routes (manager/admin). On any
 * mutation it invalidates the cash-flow query so the summary stays in sync.
 */
import { useState } from "react"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Banknote, Trash2 } from "lucide-react"

const MONTH_KEYS = ["monthJan", "monthFeb", "monthMar", "monthApr", "monthMay", "monthJun", "monthJul", "monthAug", "monthSep", "monthOct", "monthNov", "monthDec"] as const

interface Entry {
  id: string
  month: number
  entryType: string
  amount: number
  description: string | null
  activityType: string | null
  source: string | null
}

export function BudgetCashFlowEntries({ entries, year }: { entries: Entry[]; year: number }) {
  const t = useTranslations("budgeting")
  const locale = useLocale()
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const role = session?.user?.role
  const canEdit = role === "manager" || role === "admin"
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const activityLabel = (activityType: string | null) => {
    if (activityType === "operating") return t("oddsActivityOperating")
    if (activityType === "investing") return t("oddsActivityInvesting")
    if (activityType === "financing") return t("oddsActivityFinancing")
    return activityType ?? "—"
  }
  const entryTypeLabel = (entryType: string) => {
    if (entryType === "inflow") return t("cashFlowEntryTypeInflow")
    if (entryType === "outflow") return t("cashFlowEntryTypeOutflow")
    return entryType
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["budgeting", "cash-flow", year] })

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null)
    setBusyId(id)
    try {
      const res = await fetch(`/api/budgeting/cash-flow/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId || "" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `HTTP ${res.status}`)
      }
      invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("cashFlowEntryDeleteConfirm"))) return
    setError(null)
    setBusyId(id)
    try {
      const res = await fetch(`/api/budgeting/cash-flow/${id}`, {
        method: "DELETE",
        headers: { "x-organization-id": orgId || "" },
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `HTTP ${res.status}`)
      }
      invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  if (!entries || entries.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-muted-foreground" data-testid="cash-flow-entries-empty">
          <Banknote className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">{t("cashFlowEntriesEmpty", { year })}</p>
        </CardContent>
      </Card>
    )
  }

  const sorted = [...entries].sort((a, b) => a.month - b.month || a.entryType.localeCompare(b.entryType))

  return (
    <div className="space-y-3" data-testid="cash-flow-entry-list">
      <div className="text-xs text-muted-foreground">
        {canEdit
          ? t("cashFlowEntriesEditableSummary", { count: entries.length, year })
          : t("cashFlowEntriesReadonlySummary", { count: entries.length, year })}
      </div>
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          ❌ {error}
        </div>
      )}
      <div className="border rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs">
            <tr>
              <th className="text-left p-2">{t("cashFlowEntryColMonth")}</th>
              <th className="text-left p-2">{t("cashFlowEntryColType")}</th>
              <th className="text-left p-2">{t("cashFlowEntryColActivity")}</th>
              <th className="text-left p-2">{t("cashFlowEntryColDescription")}</th>
              <th className="text-right p-2">{t("cashFlowEntryColAmount")}</th>
              {canEdit && <th className="p-2" />}
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => (
              <tr key={e.id} className={`border-t ${busyId === e.id ? "opacity-50" : ""}`}>
                <td className="p-2 text-xs">
                  {MONTH_KEYS[e.month - 1] ? t(MONTH_KEYS[e.month - 1]).slice(0, 3) : e.month}
                </td>
                <td className="p-2">
                  {canEdit ? (
                    <select
                      defaultValue={e.entryType}
                      disabled={busyId === e.id}
                      onChange={(ev) => {
                        if (ev.target.value !== e.entryType) void patch(e.id, { entryType: ev.target.value })
                      }}
                      className="text-xs rounded border border-border bg-background px-1 py-0.5"
                    >
                      <option value="inflow">{t("cashFlowEntryTypeInflow")}</option>
                      <option value="outflow">{t("cashFlowEntryTypeOutflow")}</option>
                    </select>
                  ) : (
                    <span className={`text-xs ${e.entryType === "inflow" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                      {entryTypeLabel(e.entryType)}
                    </span>
                  )}
                </td>
                <td className="p-2 text-xs text-muted-foreground">{activityLabel(e.activityType)}</td>
                <td className="p-2">
                  {canEdit ? (
                    <input
                      key={`${e.id}-desc-${e.description ?? ""}`}
                      defaultValue={e.description ?? ""}
                      disabled={busyId === e.id}
                      onBlur={(ev) => {
                        const next = ev.target.value
                        if (next !== (e.description ?? "")) void patch(e.id, { description: next })
                      }}
                      className="w-full text-xs bg-transparent border border-transparent hover:border-border focus:border-emerald-500 focus:outline-none rounded px-1"
                    />
                  ) : (
                    <span className="text-xs">{e.description ?? "—"}</span>
                  )}
                </td>
                <td className="p-2 text-right">
                  {canEdit ? (
                    <input
                      key={`${e.id}-amt-${e.amount}`}
                      type="number"
                      defaultValue={e.amount}
                      disabled={busyId === e.id}
                      onBlur={(ev) => {
                        const next = parseFloat(ev.target.value)
                        if (Number.isFinite(next) && next !== e.amount) void patch(e.id, { amount: next })
                      }}
                      className="w-24 text-xs text-right bg-transparent border border-transparent hover:border-border focus:border-emerald-500 focus:outline-none rounded px-1 tabular-nums"
                    />
                  ) : (
                    <span className="text-xs tabular-nums">{e.amount.toLocaleString(locale)}</span>
                  )}
                </td>
                {canEdit && (
                  <td className="p-2 text-right">
                    <button
                      type="button"
                      onClick={() => remove(e.id)}
                      disabled={busyId === e.id}
                      className="text-red-600 hover:text-red-800 disabled:opacity-40"
                      title={t("cashFlowEntryDeleteTitle")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
