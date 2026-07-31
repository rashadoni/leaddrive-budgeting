"use client"

/**
 * Truth-Infra Phase C.2 (2026-05-26) — Admin UI for Company role, status, and industry.
 *
 * Surfaces the three fields managed by `PATCH /api/companies/[id]`:
 *
 *   • role     (operational | admin | holding) — affects HeatMap visibility and
 *               composite scoring (admin/holding rows excluded from operational view)
 *   • status   (pending | active | archived)   — onboarding gate; matrix filters
 *               out pending companies by default
 *   • industry (<code> | null)                 — drives which indicator pack runs
 *               and which settings form is shown; null clears the field for
 *               level-1 sub-group placeholders
 *
 * Each row has independent save state so bulk edits don't block one another.
 * Optimistic update: select fires immediately, PATCH runs in background; error
 * rolls back the cell and shows an inline message.
 *
 * Auth: admin-only writes (enforced by the API); viewers see read-only badges.
 */

import { useState, useMemo, useCallback } from "react"
import { useTranslations } from "next-intl"
import { useSession } from "next-auth/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Loader2, Check, AlertCircle } from "lucide-react"
import { useCompanies } from "@/features/terminal/hooks/use-companies"

// ─── Types ────────────────────────────────────────────────────────────────────

export type CompanyRoleValue = "operational" | "admin" | "holding"
export type CompanyStatusValue = "pending" | "active" | "archived"

interface CompanyRow {
  id: string
  code: string
  name: string
  role: CompanyRoleValue
  status: CompanyStatusValue
  level: number
  industry: string | null
}

type RowSaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string }

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_OPTIONS: Array<{ value: CompanyRoleValue; label: string }> = [
  { value: "operational", label: "operational" },
  { value: "admin",       label: "admin" },
  { value: "holding",     label: "holding" },
]

const STATUS_OPTIONS: Array<{ value: CompanyStatusValue; label: string }> = [
  { value: "pending",  label: "pending" },
  { value: "active",   label: "active" },
  { value: "archived", label: "archived" },
]

// 2026-05-27 — bumped contrast. Original `bg-{c}-500/15 text-{c}-300`
// pattern failed WCAG AA (~2.5:1) on the light dashboard background
// — user described as «отвратительные цвета». Replaced with the same
// ring-based saturated-foreground pattern used by Indicator Health
// chips (see IndicatorHealthView.tsx CATEGORY_STYLE) so the palette
// is consistent across admin surfaces and readable in both themes.
const STATUS_PALETTE: Record<CompanyStatusValue, string> = {
  pending:
    "bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 ring-1 ring-amber-300 dark:ring-amber-700/60",
  active:
    "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 ring-1 ring-emerald-300 dark:ring-emerald-700/60",
  archived:
    "bg-slate-100 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 ring-1 ring-slate-300 dark:ring-slate-700",
}

const ROLE_PALETTE: Record<CompanyRoleValue, string> = {
  operational:
    "bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200 ring-1 ring-sky-300 dark:ring-sky-700/60",
  admin:
    "bg-violet-50 dark:bg-violet-950/40 text-violet-800 dark:text-violet-200 ring-1 ring-violet-300 dark:ring-violet-700/60",
  holding:
    "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-200 ring-1 ring-indigo-300 dark:ring-indigo-700/60",
}

/**
 * All 14 known industry codes (mirrors validate.ts VALID_INDUSTRIES).
 * The empty-string option is used as the "clear" sentinel (→ API receives null).
 */
const INDUSTRY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "agro_crops",     label: "Agro / Crops" },
  { value: "beverage",       label: "Beverage" },
  { value: "construction",   label: "Construction" },
  { value: "education",      label: "Education" },
  { value: "entertainment",  label: "Entertainment" },
  { value: "food_processing",label: "Food Processing" },
  { value: "hospitality",    label: "Hospitality" },
  { value: "industrial",     label: "Industrial" },
  { value: "logistics",      label: "Logistics" },
  { value: "pharma",         label: "Pharma" },
  { value: "poultry",        label: "Poultry" },
  { value: "real_estate",    label: "Real Estate" },
  { value: "retail",         label: "Retail" },
  { value: "services",       label: "Services" },
]

// ─── Data fetching ─────────────────────────────────────────────────────────

function flattenCompanies(raw: CompanyRow[]): CompanyRow[] {
  const out: CompanyRow[] = []
  function walk(nodes: CompanyRow[]): void {
    for (const c of nodes) {
      out.push(c)
      const children = (c as unknown as { children?: CompanyRow[] }).children ?? []
      if (children.length > 0) walk(children)
    }
  }
  walk(raw)
  return out
}

async function fetchCompanies(orgId: string): Promise<CompanyRow[]> {
  const res = await fetch("/api/companies", {
    headers: { "x-organization-id": orgId },
  })
  const body = await res.json()
  const raw: CompanyRow[] = Array.isArray(body) ? body : (body.rows ?? body.companies ?? [])
  return flattenCompanies(raw).sort((a, b) => {
    // Holding/admin first, then operational; within type: alphabetical by code
    const rankRole = (r: string) => (r === "holding" ? 0 : r === "admin" ? 1 : 2)
    const byRole = rankRole(a.role) - rankRole(b.role)
    return byRole !== 0 ? byRole : a.code.localeCompare(b.code)
  })
}

async function patchCompany(
  id: string,
  body: { role?: CompanyRoleValue; status?: CompanyStatusValue; industry?: string | null },
): Promise<void> {
  const res = await fetch(`/api/companies/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CompanyManagementAdmin() {
  const t = useTranslations("adminCompanies")
  // The 14 industry codes already have a translated label in the shared
  // `industries` namespace — reuse it instead of the English literals in
  // INDUSTRY_OPTIONS (kept as the code list / validation mirror).
  const tIndustries = useTranslations("industries")
  const industryLabel = (code: string): string =>
    INDUSTRY_OPTIONS.some((o) => o.value === code) ? tIndustries(code) : code
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId ?? ""
  const canEdit = session?.user?.role === "admin"
  const queryClient = useQueryClient()
  // Bust the module-level terminal cache (PanelGrid, RelatedFunctionsMenu, etc.)
  const { refresh: refreshTerminalCache } = useCompanies()

  const { data: companies, isLoading, error: fetchError } = useQuery({
    queryKey: ["admin-company-management", orgId],
    queryFn: () => fetchCompanies(orgId),
    enabled: !!orgId,
  })

  // Per-row save states keyed by company id
  const [saveStates, setSaveStates] = useState<Record<string, RowSaveState>>({})
  // Local overrides for optimistic updates keyed by `${id}:role` or `${id}:status`
  const [overrides, setOverrides] = useState<Record<string, string>>({})

  const getField = useCallback(
    (c: CompanyRow, field: "role" | "status" | "industry"): string => {
      const key = `${c.id}:${field}`
      if (key in overrides) return overrides[key]
      // `industry` is nullable; coerce null → "" so it round-trips through
      // the select `value` prop correctly (the "—" option has value="").
      if (field === "industry") return c.industry ?? ""
      return c[field]
    },
    [overrides],
  )

  const handleChange = useCallback(
    async (
      id: string,
      field: "role" | "status" | "industry",
      newValue: string,
      oldValue: string,
    ) => {
      // Optimistic update
      setOverrides((prev) => ({ ...prev, [`${id}:${field}`]: newValue }))
      setSaveStates((prev) => ({ ...prev, [id]: { kind: "saving" } }))

      // For industry: empty string in the select means "clear to null" in the API.
      const patchValue: string | null =
        field === "industry" && newValue === "" ? null : newValue

      try {
        await patchCompany(id, { [field]: patchValue } as Parameters<typeof patchCompany>[1])
        setSaveStates((prev) => ({ ...prev, [id]: { kind: "saved" } }))
        // Invalidate the react-query cache for this component's own data
        queryClient.invalidateQueries({ queryKey: ["admin-company-management", orgId] })
        // Also bust the module-level cache used by terminal panels (PanelGrid,
        // RelatedFunctionsMenu, AlertsPanel, etc.) so they pick up the new
        // role/status without requiring a full page reload.
        void refreshTerminalCache()
        // Brief "saved" flash, then back to idle
        setTimeout(
          () => setSaveStates((prev) => ({ ...prev, [id]: { kind: "idle" } })),
          1500,
        )
      } catch (err) {
        // Roll back optimistic update
        setOverrides((prev) => ({ ...prev, [`${id}:${field}`]: oldValue }))
        setSaveStates((prev) => ({
          ...prev,
          [id]: {
            kind: "error",
            message: err instanceof Error ? err.message : t("saveFailed"),
          },
        }))
      }
    },
    [orgId, queryClient, refreshTerminalCache],
  )

  const rows = useMemo(() => companies ?? [], [companies])

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("sectionHeading")}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t("sectionDescription")}
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
        </div>
      )}

      {fetchError && (
        <div className="text-sm text-red-400 flex items-center gap-1">
          <AlertCircle className="h-4 w-4" />
          {(fetchError as Error).message}
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left p-3 font-mono">{t("thCode")}</th>
                    <th className="text-left p-3">{t("thName")}</th>
                    <th className="text-left p-3">{t("thIndustry")}</th>
                    <th className="text-left p-3">{t("thRole")}</th>
                    <th className="text-left p-3">{t("thStatus")}</th>
                    <th className="w-20 p-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((c) => {
                    const role = getField(c, "role") as CompanyRoleValue
                    const status = getField(c, "status") as CompanyStatusValue
                    const save = saveStates[c.id] ?? { kind: "idle" }
                    const isSaving = save.kind === "saving"

                    return (
                      <tr key={c.id} className="hover:bg-muted/30">
                        <td className="p-3 font-mono text-xs text-muted-foreground">
                          {c.code}
                        </td>
                        <td className="p-3 max-w-[16rem] truncate" title={c.name}>
                          {c.name}
                        </td>
                        <td className="p-3">
                          {canEdit ? (
                            <select
                              value={getField(c, "industry")}
                              disabled={isSaving}
                              aria-label={t("ariaIndustry", { code: c.code })}
                              onChange={(e) =>
                                handleChange(
                                  c.id,
                                  "industry",
                                  e.target.value,
                                  getField(c, "industry"),
                                )
                              }
                              className="rounded border px-1.5 py-0.5 text-xs font-medium focus:outline-none disabled:opacity-50 bg-background text-foreground border-border"
                            >
                              <option value="" className="bg-background text-foreground">—</option>
                              {INDUSTRY_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value} className="bg-background text-foreground">
                                  {tIndustries(o.value)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            c.industry ? (
                              <Badge variant="outline" className="text-[10px]">
                                {industryLabel(c.industry)}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )
                          )}
                        </td>
                        <td className="p-3">
                          {canEdit ? (
                            <select
                              value={role}
                              disabled={isSaving}
                              aria-label={t("ariaRole", { code: c.code })}
                              onChange={(e) =>
                                handleChange(
                                  c.id,
                                  "role",
                                  e.target.value,
                                  getField(c, "role"),
                                )
                              }
                              className={`rounded border px-1.5 py-0.5 text-xs font-medium focus:outline-none disabled:opacity-50 ${ROLE_PALETTE[role]}`}
                            >
                              {ROLE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value} className="bg-background text-foreground">
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${ROLE_PALETTE[role]}`}
                            >
                              {role}
                            </Badge>
                          )}
                        </td>
                        <td className="p-3">
                          {canEdit ? (
                            <select
                              value={status}
                              disabled={isSaving}
                              aria-label={t("ariaStatus", { code: c.code })}
                              onChange={(e) =>
                                handleChange(
                                  c.id,
                                  "status",
                                  e.target.value,
                                  getField(c, "status"),
                                )
                              }
                              className={`rounded border px-1.5 py-0.5 text-xs font-medium focus:outline-none disabled:opacity-50 ${STATUS_PALETTE[status]}`}
                            >
                              {STATUS_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value} className="bg-background text-foreground">
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${STATUS_PALETTE[status]}`}
                            >
                              {status}
                            </Badge>
                          )}
                        </td>
                        <td className="p-3 text-xs">
                          {save.kind === "saving" && (
                            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                          )}
                          {save.kind === "saved" && (
                            <Check className="h-3 w-3 text-emerald-400" />
                          )}
                          {save.kind === "error" && (
                            <span
                              className="text-red-400 text-[10px] flex items-center gap-0.5"
                              title={save.message}
                            >
                              <AlertCircle className="h-3 w-3 shrink-0" />
                              {save.message.slice(0, 24)}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && rows.length === 0 && !fetchError && (
        <p className="text-sm text-muted-foreground">{t("noCompaniesFound")}</p>
      )}
    </section>
  )
}
