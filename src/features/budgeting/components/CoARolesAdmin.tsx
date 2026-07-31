"use client"

/**
 * Phase 7.G Turn LXXXXI (Phase 5.1.2) — admin page for ChartOfAccount.role
 * override. Lists CoA accounts grouped by accountType + per-row role
 * dropdown to override `deriveRoleFromCode` default. Wraps
 * `/api/budgeting/chart-of-accounts` (GET) + `[id]` PUT.
 *
 * Scope:
 *  - Read: any authenticated org member.
 *  - Mutate: admin-only (API enforces 403). UI elements rendered for all;
 *    surfaces admin-contact path for non-admin.
 *
 * Design constraints:
 *  - i18n via next-intl `useTranslations` — all visible strings keyed under
 *    `budgeting.coaRoles`.
 *  - Filter by accountType + free-text search (code or name).
 *  - Default role display via `deriveRoleFromCode(account.code)` when
 *    `account.role` is null.
 */

import { useState, useMemo } from "react"
import { useTranslations } from "next-intl"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Loader2, AlertCircle } from "lucide-react"
import { DataBoundary } from "@/components/ui/data-boundary"
import {
  useChartOfAccounts, useUpdateCoARole,
  type CoARole, type ChartOfAccount,
} from "@/lib/budgeting/use-coa"
import { deriveRoleFromCode } from "@/lib/budgeting/coa-role"

const ROLE_VALUES: CoARole[] = [
  "revenue", "cogs", "opex", "finance",
  "tax_costs", "non_operating", "tax", "unknown",
]

const ACCOUNT_TYPE_FILTERS = [
  "all", "revenue", "expense", "cogs", "asset", "liability", "equity",
] as const
type AccountTypeFilter = typeof ACCOUNT_TYPE_FILTERS[number]

export function CoARolesAdmin() {
  const t = useTranslations("budgeting.coaRoles")
  const qc = useQueryClient()
  const { data: accounts = [], isLoading, error } = useChartOfAccounts()
  const updateRole = useUpdateCoARole()
  const [filterType, setFilterType] = useState<AccountTypeFilter>("all")
  const [search, setSearch] = useState("")
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    let result = [...accounts]
    if (filterType !== "all") {
      result = result.filter(a => a.accountType === filterType)
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      result = result.filter(a =>
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q),
      )
    }
    return result
  }, [accounts, filterType, search])

  const handleRoleChange = async (account: ChartOfAccount, nextRole: CoARole | "") => {
    setPendingId(account.id)
    setUpdateError(null)
    try {
      await updateRole.mutateAsync({
        id: account.id,
        role: nextRole === "" ? null : nextRole,
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("errUpdate")
      setUpdateError(msg)
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <DataBoundary loading={isLoading} error={error ? t("errorLoad") : null}>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("title")}</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">{t("description")}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 bg-muted rounded-lg p-1">
              {ACCOUNT_TYPE_FILTERS.map(ft => (
                <button
                  key={ft}
                  type="button"
                  role="tab"
                  aria-selected={filterType === ft}
                  onClick={() => setFilterType(ft)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer motion-safe:active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${
                    filterType === ft
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  }`}
                >
                  {t(`filterType_${ft}`)}
                </button>
              ))}
            </div>
            <Input
              type="search"
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Badge variant="outline" className="ml-auto">
              {t("countShown", { n: filtered.length, total: accounts.length })}
            </Badge>
          </div>

          {updateError && (
            <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{updateError}</span>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("colCode")}</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("colName")}</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("colAccountType")}</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("colDerivedRole")}</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("colOverrideRole")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground text-xs">
                      {t("emptyNoMatch")}
                    </td>
                  </tr>
                ) : (
                  filtered.map(account => {
                    const derived = deriveRoleFromCode(account.code)
                    const isPending = pendingId === account.id
                    return (
                      <tr key={account.id} className="border-t border-border/50 hover:bg-muted/20">
                        <td className="px-3 py-2 font-mono text-xs">{account.code}</td>
                        <td className="px-3 py-2 text-xs">{account.name}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{account.accountType}</td>
                        <td className="px-3 py-2 text-xs">
                          <Badge variant="outline" className="text-[10px]">
                            {t(`role_${derived}`)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <select
                              value={account.role ?? ""}
                              onChange={e => handleRoleChange(account, e.target.value as CoARole | "")}
                              disabled={isPending}
                              aria-label={t("ariaSelectRole", { code: account.code })}
                              className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                            >
                              <option value="">{t("optionUseDerived")}</option>
                              {ROLE_VALUES.map(r => (
                                <option key={r} value={r}>{t(`role_${r}`)}</option>
                              ))}
                            </select>
                            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                            {account.role && account.role !== derived && (
                              <Badge variant="default" className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                {t("badgeOverride")}
                              </Badge>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["budgeting", "chart-of-accounts"] })}
          >
            {t("btnRefresh")}
          </Button>
        </CardContent>
      </Card>
      </DataBoundary>
    </div>
  )
}
