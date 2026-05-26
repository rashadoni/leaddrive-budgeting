"use client"

/**
 * Truth-Infra Phase C.1 (2026-05-26) — Admin UI for Company role + status.
 *
 * Surfaces the two fields managed by `PATCH /api/companies/[id]`:
 *
 *   • role   (operational | admin | holding) — affects HeatMap visibility and
 *             composite scoring (admin/holding rows excluded from operational view)
 *   • status (pending | active | archived)   — onboarding gate; matrix filters
 *             out pending companies by default
 *
 * Each row has independent save state so bulk edits don't block one another.
 * Optimistic update: select fires immediately, PATCH runs in background; error
 * rolls back the cell and shows an inline message.
 *
 * Auth: admin-only writes (enforced by the API); viewers see read-only selects.
 */

import { useState, useMemo, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Loader2, Check, AlertCircle } from "lucide-react"

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

const STATUS_PALETTE: Record<CompanyStatusValue, string> = {
  pending:  "bg-amber-500/15  text-amber-300  border-amber-500/30",
  active:   "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  archived: "bg-slate-500/15  text-slate-400  border-slate-500/30",
}

const ROLE_PALETTE: Record<CompanyRoleValue, string> = {
  operational: "bg-sky-500/15  text-sky-300  border-sky-500/30",
  admin:       "bg-violet-500/15 text-violet-300 border-violet-500/30",
  holding:     "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
}

// ─── Data fetching ─────────────────────────────────────────────────────────

function flattenCompanies(raw: CompanyRow[]): CompanyRow[] {
  const out: CompanyRow[] = []
  for (const c of raw) {
    out.push(c)
    const kids = (c as unknown as { children?: CompanyRow[] }).children ?? []
    for (const k of kids) {
      out.push(k)
      const grandkids = (k as unknown as { children?: CompanyRow[] }).children ?? []
      out.push(...grandkids)
    }
  }
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
  body: { role?: CompanyRoleValue; status?: CompanyStatusValue },
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
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId ?? ""
  const canEdit = session?.user?.role === "admin"
  const queryClient = useQueryClient()

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
    (c: CompanyRow, field: "role" | "status"): string =>
      overrides[`${c.id}:${field}`] ?? c[field],
    [overrides],
  )

  const handleChange = useCallback(
    async (
      id: string,
      field: "role" | "status",
      newValue: string,
      oldValue: string,
    ) => {
      // Optimistic update
      setOverrides((prev) => ({ ...prev, [`${id}:${field}`]: newValue }))
      setSaveStates((prev) => ({ ...prev, [id]: { kind: "saving" } }))

      try {
        await patchCompany(id, { [field]: newValue } as Parameters<typeof patchCompany>[1])
        setSaveStates((prev) => ({ ...prev, [id]: { kind: "saved" } }))
        // Invalidate the companies cache so the tree re-fetches with new values
        queryClient.invalidateQueries({ queryKey: ["admin-company-management", orgId] })
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
            message: err instanceof Error ? err.message : "Save failed",
          },
        }))
      }
    },
    [orgId, queryClient],
  )

  const rows = useMemo(() => companies ?? [], [companies])

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Role & Status</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          <strong>role</strong> determines HeatMap visibility (admin/holding excluded from operational view).{" "}
          <strong>status</strong> is the onboarding gate — <em>pending</em> companies are hidden from the matrix.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
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
                    <th className="text-left p-3 font-mono">Code</th>
                    <th className="text-left p-3">Name</th>
                    <th className="text-left p-3">Industry</th>
                    <th className="text-left p-3">Role</th>
                    <th className="text-left p-3">Status</th>
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
                          {c.industry ? (
                            <Badge variant="outline" className="text-[10px]">
                              {c.industry}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-3">
                          {canEdit ? (
                            <select
                              value={role}
                              disabled={isSaving}
                              aria-label={`role for ${c.code}`}
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
                              aria-label={`status for ${c.code}`}
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
        <p className="text-sm text-muted-foreground">No companies found.</p>
      )}
    </section>
  )
}
