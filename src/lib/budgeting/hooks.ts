"use client"
import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import type {
  BudgetPlan,
  BudgetLine,
  BudgetActual,
  BudgetAnalytics,
  BudgetDirectionTemplate,
  CreateBudgetPlanInput,
  UpdateBudgetPlanInput,
  CreateBudgetLineInput,
  UpdateBudgetLineInput,
  CreateBudgetActualInput,
  UpdateBudgetActualInput,
  CreateTemplateInput,
  UpdateTemplateInput,
  SavedBudgetReport,
} from "./types"
import type { BudgetReportConfig, ReportResult } from "./report-engine"

function useOrgId() {
  const { data: session } = useSession()
  return session?.user?.organizationId ?? ""
}

async function apiFetch<T>(url: string, orgId: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-organization-id": orgId,
      ...options?.headers,
    },
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || "API error")
  return json.data ?? json
}

// ─── Plans ───────────────────────────────────────────────────────────────────

export function useBudgetPlans() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "plans", orgId],
    queryFn: () => apiFetch<BudgetPlan[]>("/api/budgeting/plans", orgId),
    enabled: !!orgId,
  })
}

export function useCreateBudgetPlan() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateBudgetPlanInput) =>
      apiFetch<BudgetPlan>("/api/budgeting/plans", orgId, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budgeting", "plans", orgId] }),
  })
}

export function useUpdateBudgetPlan() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateBudgetPlanInput & { id: string }) =>
      apiFetch<BudgetPlan>(`/api/budgeting/plans/${id}`, orgId, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["budgeting", "plans", orgId] })
      qc.invalidateQueries({ queryKey: ["budgeting", "analytics", id, orgId] })
      qc.invalidateQueries({ queryKey: ["budgeting", "approval-comments", id, orgId] })
    },
  })
}

export function useDeleteBudgetPlan() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, deleteAll }: { id: string; deleteAll?: boolean }) =>
      apiFetch<void>(`/api/budgeting/plans?planId=${id}${deleteAll ? "&deleteAll=true" : ""}`, orgId, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgeting", "plans", orgId] })
      qc.invalidateQueries({ queryKey: ["budgeting"] })
    },
  })
}

// ─── Lines ────────────────────────────────────────────────────────────────────

export function useBudgetLines(planId: string) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "lines", planId, orgId],
    queryFn: () => apiFetch<BudgetLine[]>(`/api/budgeting/lines?planId=${planId}`, orgId),
    enabled: !!orgId && !!planId,
  })
}

// Lightweight count-only hook — use when caller only needs `lines.length`
// (e.g. `if (count > 0) hide-button`). Avoids the 4.3 MB BudgetLine
// payload that `useBudgetLines` carries.
export function useBudgetLineCount(planId: string) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "lines", "count", planId, orgId],
    queryFn: () => apiFetch<{ count: number }>(`/api/budgeting/lines/count?planId=${planId}`, orgId),
    enabled: !!orgId && !!planId,
  })
}

export function useCreateBudgetLine() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateBudgetLineInput) =>
      apiFetch<BudgetLine>("/api/budgeting/lines", orgId, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, { planId }) => {
      qc.invalidateQueries({ queryKey: ["budgeting", "lines", planId, orgId] })
      qc.invalidateQueries({ queryKey: ["budgeting", "analytics", planId, orgId] })
    },
  })
}

export function useUpdateBudgetLine() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, planId, ...input }: UpdateBudgetLineInput) =>
      apiFetch<BudgetLine>(`/api/budgeting/lines/${id}`, orgId, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, { planId }) => {
      qc.invalidateQueries({ queryKey: ["budgeting", "lines", planId, orgId] })
      qc.invalidateQueries({ queryKey: ["budgeting", "analytics", planId, orgId] })
    },
  })
}

export function useDeleteBudgetLine() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, planId }: { id: string; planId: string }) =>
      apiFetch<void>(`/api/budgeting/lines/${id}`, orgId, { method: "DELETE" }),
    onSuccess: (_data, { planId }) => {
      qc.invalidateQueries({ queryKey: ["budgeting", "lines", planId, orgId] })
      qc.invalidateQueries({ queryKey: ["budgeting", "analytics", planId, orgId] })
    },
  })
}

// ─── Actuals ──────────────────────────────────────────────────────────────────

export function useBudgetActuals(planId: string) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "actuals", planId, orgId],
    queryFn: () => apiFetch<BudgetActual[]>(`/api/budgeting/actuals?planId=${planId}`, orgId),
    enabled: !!orgId && !!planId,
  })
}

export function useCreateBudgetActual() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateBudgetActualInput) =>
      apiFetch<BudgetActual>("/api/budgeting/actuals", orgId, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, { planId }) => {
      qc.invalidateQueries({ queryKey: ["budgeting", "actuals", planId, orgId] })
      qc.invalidateQueries({ queryKey: ["budgeting", "analytics", planId, orgId] })
    },
  })
}

export function useUpdateBudgetActual() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, planId, ...input }: UpdateBudgetActualInput & { id: string; planId: string }) =>
      apiFetch<BudgetActual>(`/api/budgeting/actuals/${id}`, orgId, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, { planId }) => {
      qc.invalidateQueries({ queryKey: ["budgeting", "actuals", planId, orgId] })
      qc.invalidateQueries({ queryKey: ["budgeting", "analytics", planId, orgId] })
    },
  })
}

export function useDeleteBudgetActual() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, planId }: { id: string; planId: string }) =>
      apiFetch<void>(`/api/budgeting/actuals/${id}`, orgId, { method: "DELETE" }),
    onSuccess: (_data, { planId }) => {
      qc.invalidateQueries({ queryKey: ["budgeting", "actuals", planId, orgId] })
      qc.invalidateQueries({ queryKey: ["budgeting", "analytics", planId, orgId] })
    },
  })
}

// ─── Sections ─────────────────────────────────────────────────────────────────

// Phase 3.1 v1.3 cleanup — same pattern as BudgetForecastEntry (ac59359):
// canonical type lives in ./types with the stricter sectionType union
// + organizationId + createdAt fields. Re-export so existing call
// sites keep their import shape.
export type { BudgetSection } from "./types"
import type { BudgetSection } from "./types"

export function useBudgetSections(planId: string) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "sections", planId, orgId],
    queryFn: () => apiFetch<BudgetSection[]>(`/api/budgeting/sections?planId=${planId}`, orgId),
    enabled: !!orgId && !!planId,
  })
}

export function useCreateBudgetSection() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { planId: string; name: string; sectionType?: string; sortOrder?: number }) =>
      apiFetch<BudgetSection>("/api/budgeting/sections", orgId, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, { planId }) =>
      qc.invalidateQueries({ queryKey: ["budgeting", "sections", planId, orgId] }),
  })
}

export function useDeleteBudgetSection() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, planId }: { id: string; planId: string }) =>
      apiFetch<void>(`/api/budgeting/sections/${id}`, orgId, { method: "DELETE" }),
    onSuccess: (_data, { planId }) =>
      qc.invalidateQueries({ queryKey: ["budgeting", "sections", planId, orgId] }),
  })
}

// ─── Forecast Entries ─────────────────────────────────────────────────────────

// Phase 3.1 v1.3 cleanup — the duplicate local interface that omitted
// `lineType` is gone. Single source of truth is the same canonical
// BudgetForecastEntry in @/lib/budgeting/types (includes lineType +
// organizationId + createdAt + updatedAt). Re-export so existing
// `import { BudgetForecastEntry } from "@/lib/budgeting/hooks"`
// call sites keep working without a code-mod sweep.
export type { BudgetForecastEntry } from "./types"
import type { BudgetForecastEntry } from "./types"

export function useBudgetForecastEntries(planId: string) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "forecast", planId, orgId],
    queryFn: () => apiFetch<BudgetForecastEntry[]>(`/api/budgeting/forecast?planId=${planId}`, orgId),
    enabled: !!orgId && !!planId,
  })
}

export function useUpsertBudgetForecast() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (entries: Array<{ planId: string; month: number; year: number; category: string; lineType?: string; forecastAmount: number }>) =>
      apiFetch<BudgetForecastEntry[]>("/api/budgeting/forecast", orgId, {
        method: "POST",
        body: JSON.stringify({ entries }),
      }),
    onSuccess: (_data, entries) => {
      const planId = entries[0]?.planId
      if (planId) qc.invalidateQueries({ queryKey: ["budgeting", "forecast", planId, orgId] })
    },
  })
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export function useBudgetAnalytics(planId: string, companyId?: string | null) {
  const orgId = useOrgId()
  // Turn 30: per-daughter-company drilldown. companyId is optional —
  // null/undefined → org-wide consolidated. queryKey includes companyId
  // so React Query caches per-selection separately (switching companies
  // re-fetches instead of returning stale aggregate).
  //
  // Turn 30 architect ⚠️: route returns 404 when companyId stale/cross-
  // tenant (e.g. URL bookmark to a deleted company). `apiFetch` treats
  // non-OK as throw → React Query surfaces as `error` (not silent data
  // gap). This is the existing apiFetch contract; we rely on it instead
  // of bypassing it. If consumers need to handle 404 specifically,
  // they can inspect `error?.message` for "Company not found".
  const query = companyId ? `?planId=${planId}&companyId=${companyId}` : `?planId=${planId}`
  return useQuery({
    queryKey: ["budgeting", "analytics", planId, companyId ?? null, orgId],
    queryFn: () => apiFetch<BudgetAnalytics>(`/api/budgeting/analytics${query}`, orgId),
    enabled: !!orgId && !!planId,
    // Don't retry 4xx — 404 from cross-tenant/deleted id is terminal,
    // retrying just hammers the route + delays the visible error state.
    retry: (failureCount, error) => {
      const msg = error instanceof Error ? error.message : ""
      if (msg.includes("404") || msg.includes("not found")) return false
      return failureCount < 3
    },
  })
}

// ─── Sync Actuals ────────────────────────────────────────────────────────────

export function useSyncActuals() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (planId: string) =>
      apiFetch<{ synced: number }>("/api/budgeting/sync-actuals", orgId, {
        method: "POST",
        body: JSON.stringify({ planId }),
      }),
    onSuccess: (_data, planId) => {
      qc.invalidateQueries({ queryKey: ["budgeting", "actuals", planId, orgId] })
      qc.invalidateQueries({ queryKey: ["budgeting", "analytics", planId, orgId] })
    },
  })
}

// ─── Direction Templates ─────────────────────────────────────────────────────

export function useBudgetTemplates() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "templates", orgId],
    queryFn: () => apiFetch<BudgetDirectionTemplate[]>("/api/budgeting/templates", orgId),
    enabled: !!orgId,
  })
}

export function useCreateBudgetTemplate() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTemplateInput) =>
      apiFetch<BudgetDirectionTemplate>("/api/budgeting/templates", orgId, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budgeting", "templates", orgId] }),
  })
}

export function useUpdateBudgetTemplate() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateTemplateInput & { id: string }) =>
      apiFetch<BudgetDirectionTemplate>(`/api/budgeting/templates/${id}`, orgId, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budgeting", "templates", orgId] }),
  })
}

export function useDeleteBudgetTemplate() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/budgeting/templates/${id}`, orgId, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budgeting", "templates", orgId] }),
  })
}

export function useApplyTemplates() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ planId, templateIds }: { planId: string; templateIds: string[] }) =>
      apiFetch<{ created: number; skipped: number }>(`/api/budgeting/plans/${planId}/apply-templates`, orgId, {
        method: "POST",
        body: JSON.stringify({ templateIds }),
      }),
    onSuccess: (_data, { planId }) => {
      qc.invalidateQueries({ queryKey: ["budgeting", "lines", planId, orgId] })
      qc.invalidateQueries({ queryKey: ["budgeting", "analytics", planId, orgId] })
    },
  })
}

// ─── Snapshot Actuals (monthly freeze) ───────────────────────────────────────

export function useSnapshotActuals() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ planId, month }: { planId?: string; month?: string }) =>
      apiFetch<{ month: string; created: number; skipped: number; plans: number }>("/api/budgeting/snapshot-actuals", orgId, {
        method: "POST",
        body: JSON.stringify({ planId, month }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgeting"] })
    },
  })
}

// ═══════════════════════════════════════════════════
// TIME MACHINE
// ═══════════════════════════════════════════════════

/** Phase 8 D3(k) (2026-05-28) — `oldValue` / `newValue` are audit-log
 *  Json blobs. Their shape varies per `entityType`/`action`; consumers
 *  must narrow before reading. Typed as `unknown` (was `any` and let
 *  any field-access through without compile error). */
export interface ChangeLogItem {
  id: string
  action: string
  entityType: string
  entityId: string
  field: string | null
  oldValue: unknown
  newValue: unknown
  category: string | null
  userName: string
  createdAt: string
}

export function useBudgetChangelog(planId?: string) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "changelog", planId],
    queryFn: () => apiFetch<{ items: ChangeLogItem[]; total: number }>(`/api/budgeting/changelog?planId=${planId}`, orgId),
    enabled: !!planId && !!orgId,
    staleTime: 10_000,
  })
}

export function useUndoBudgetChange() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (changeId: string) =>
      apiFetch<{ reverted: string; to: unknown }>("/api/budgeting/changelog", orgId, {
        method: "POST",
        body: JSON.stringify({ changeId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgeting"] })
    },
  })
}

// ─── Department Owners (F5) ──────────────────────────────────────────────────

interface DepartmentOwner {
  id: string
  departmentId: string
  userId: string
  canEdit: boolean
  canApprove: boolean
  budgetDept: { id: string; key: string; label: string }
  user: { id: string; name: string; email: string; role: string }
}

export function useBudgetDeptOwners() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "dept-owners", orgId],
    queryFn: async () => {
      const res = await fetch("/api/budgeting/department-owners", {
        headers: { "x-organization-id": orgId },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json as DepartmentOwner[]
    },
    enabled: !!orgId,
  })
}

export function useAssignDeptOwner() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { departmentId: string; userId: string; canEdit?: boolean; canApprove?: boolean }) => {
      const res = await fetch("/api/budgeting/department-owners", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json as DepartmentOwner
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgeting", "dept-owners"] })
    },
  })
}

export function useRemoveDeptOwner() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/budgeting/department-owners?id=${id}`, {
        method: "DELETE",
        headers: { "x-organization-id": orgId },
      })
      if (!res.ok) throw new Error("Failed to remove")
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgeting", "dept-owners"] })
    },
  })
}

// ─── Approval Comments (F1) ──────────────────────────────────────────────────

interface ApprovalComment {
  id: string
  planId: string
  userId: string
  userName: string
  status: string
  comment: string
  createdAt: string
}

export function useBudgetApprovalComments(planId?: string) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "approval-comments", planId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/budgeting/plans/${planId}/comments`, {
        headers: { "x-organization-id": orgId },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json as ApprovalComment[]
    },
    enabled: !!orgId && !!planId,
  })
}

export function useCreateApprovalComment() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { planId: string; comment: string; status?: string }) => {
      const res = await fetch(`/api/budgeting/plans/${data.planId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: JSON.stringify({ comment: data.comment, status: data.status }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json as ApprovalComment
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["budgeting", "approval-comments", variables.planId] })
    },
  })
}

// ─── F3: Versioning ───────────────────────────────────────────

export function useBudgetVersions(planId: string | null) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "versions", planId],
    queryFn: async () => {
      const res = await fetch(`/api/budgeting/plans/${planId}/versions`, {
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return (json.data ?? json) as Array<{
        id: string
        name: string
        status: string
        version: number
        versionLabel: string | null
        amendmentOf: string | null
        createdAt: string
        approvedAt: string | null
        approvedBy: string | null
      }>
    },
    enabled: !!orgId && !!planId,
  })
}

export function useCreateBudgetVersion() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (planId: string) => {
      const res = await fetch(`/api/budgeting/plans/${planId}/create-version`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgeting", "versions"] })
      qc.invalidateQueries({ queryKey: ["budgeting", "plans"] })
    },
  })
}

export function useBudgetDiff(planIdA: string | null, planIdB: string | null) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "diff", planIdA, planIdB],
    queryFn: async () => {
      const res = await fetch(
        `/api/budgeting/plans/${planIdA}/diff?compareWith=${planIdB}`,
        { headers: { "Content-Type": "application/json", "x-organization-id": orgId } },
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return (json.data ?? json) as {
        planA: string
        planB: string
        totalChanges: number
        diff: Array<{
          category: string
          department: string | null
          lineType: string
          planA: number
          planB: number
          delta: number
          status: "added" | "removed" | "changed" | "unchanged"
        }>
      }
    },
    enabled: !!orgId && !!planIdA && !!planIdB,
  })
}

// ─── F7: Multi-Currency ───────────────────────────────────────

export function useExchangeRates(currencyCode?: string) {
  const orgId = useOrgId()
  const url = currencyCode
    ? `/api/budgeting/exchange-rates?currencyCode=${currencyCode}`
    : `/api/budgeting/exchange-rates`
  return useQuery({
    queryKey: ["budgeting", "exchange-rates", currencyCode || "all"],
    queryFn: async () => {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return (json.data ?? json) as {
        rates: Array<{
          id: string
          currencyCode: string
          rate: number
          rateDate: string
        }>
        currencies: Array<{
          id: string
          code: string
          name: string
          symbol: string
          exchangeRate: number
          isBase: boolean
        }>
      }
    },
    enabled: !!orgId,
  })
}

export function useCreateExchangeRate() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { currencyCode: string; rate: number; rateDate?: string }) => {
      const res = await fetch("/api/budgeting/exchange-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgeting", "exchange-rates"] })
    },
  })
}

// ─── F2: Accounting Integration ───────────────────────────────

/** Phase 8 D3(k) (2026-05-28) — mirrors `model AccountingIntegration`
 *  from prisma/schema.prisma. `config` / `categoryMapping` are Json
 *  columns; typed `Record<string, unknown>` here so the import-CSV
 *  flow can pass arbitrary shapes per provider. */
export interface AccountingIntegration {
  id: string
  organizationId: string
  provider: string
  name: string
  config: Record<string, unknown>
  categoryMapping: Record<string, unknown>
  isActive: boolean
  lastSyncAt: string | null
  lastSyncStatus: string | null
  lastSyncError: string | null
  createdAt: string
  updatedAt: string
}

/** Single row from a parsed CSV import — keys vary per provider /
 *  template. The /api/budgeting/import-csv handler narrows per
 *  integration's `categoryMapping`. */
export type ImportCsvRow = Record<string, unknown>

/** Shape of one entry in the import-history list returned by
 *  GET /api/budgeting/import-csv. Mirrors AccountingImport rows
 *  with the `integration: { name, provider }` include. Consumed
 *  by BudgetImportHistory + ImportTab. */
export interface ImportHistoryEntry {
  id: string
  fileName: string | null
  importType: string
  status: string
  totalRows: number
  matchedRows: number
  unmatchedRows: number
  createdAt: string
  integration?: { name: string; provider: string } | null
}

export function useAccountingIntegrations() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "integrations"],
    queryFn: async () => {
      const res = await fetch("/api/budgeting/integrations", {
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return (json.data ?? json) as AccountingIntegration[]
    },
    enabled: !!orgId,
  })
}

export function useCreateIntegration() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { provider: string; name: string; config?: Record<string, unknown> }) => {
      const res = await fetch("/api/budgeting/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgeting", "integrations"] })
    },
  })
}

export function useImportCsv() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { planId: string; rows: ImportCsvRow[]; integrationId?: string; fileName?: string }) => {
      const res = await fetch("/api/budgeting/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgeting", "actuals"] })
      qc.invalidateQueries({ queryKey: ["budgeting", "import-history"] })
      qc.invalidateQueries({ queryKey: ["budgeting", "analytics"] })
    },
  })
}

export function useImportHistory(planId?: string) {
  const orgId = useOrgId()
  const url = planId ? `/api/budgeting/import-csv?planId=${planId}` : "/api/budgeting/import-csv"
  return useQuery({
    queryKey: ["budgeting", "import-history", planId || "all"],
    queryFn: async () => {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return (json.data ?? json ?? []) as ImportHistoryEntry[]
    },
    enabled: !!orgId,
  })
}

// ─── F4: Rolling Forecast ─────────────────────────────────────

export function useCreateRollingPlan() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { name: string; startYear: number; startMonth: number; rollingMonths?: number }) => {
      const res = await fetch("/api/budgeting/rolling", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgeting", "plans"] })
      qc.invalidateQueries({ queryKey: ["budgeting", "rolling"] })
    },
  })
}

export function useRollingForecast(planId: string | null) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "rolling", planId],
    queryFn: async () => {
      const res = await fetch(`/api/budgeting/rolling?planId=${planId}`, {
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json as {
        plan: BudgetPlan
        months: Array<{
          year: number
          month: number
          status: string
          actualTotal: number
          forecastTotal: number
          total: number
          revenue: number
          expense: number
          margin: number
        }>
        lineCount: number
        totalActual: number
        totalForecast: number
        revenue: number
        expense: number
        margin: number
      }
    },
    enabled: !!orgId && !!planId,
  })
}

export function useAutoForecast() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { planId: string; lookbackMonths?: number }) => {
      const res = await fetch("/api/budgeting/rolling/auto-forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgeting", "rolling"] })
    },
  })
}

export function useCloseRollingMonth() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { planId: string; year: number; month: number }) => {
      const res = await fetch("/api/budgeting/rolling", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgeting", "rolling"] })
    },
  })
}

export function useReopenRollingMonth() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { planId: string; year: number; month: number }) => {
      const res = await fetch("/api/budgeting/rolling", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: JSON.stringify({ ...data, action: "reopen" }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgeting", "rolling"] })
    },
  })
}

// ─── F6: Cash Flow ────────────────────────────────────────────

export function useCashFlow(year: number) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "cash-flow", year],
    queryFn: async () => {
      const res = await fetch(`/api/budgeting/cash-flow?year=${year}`, {
        headers: { "x-organization-id": orgId },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json as {
        year: number
        months: Array<{
          month: number
          year: number
          opening: number
          inflows: number
          outflows: number
          net: number
          closing: number
        }>
        totalInflows: number
        totalOutflows: number
      }
    },
    enabled: !!orgId,
  })
}

export function useCreateCashFlowEntry() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: {
      year: number; month: number; entryType: string; amount: number;
      description?: string; source?: string
    }) => {
      const res = await fetch("/api/budgeting/cash-flow", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgeting", "cash-flow"] })
    },
  })
}

export function useCashFlowAlerts(year: number) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "cash-flow-alerts", year],
    queryFn: async () => {
      const res = await fetch(`/api/budgeting/cash-flow/alerts?year=${year}`, {
        headers: { "x-organization-id": orgId },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json as Array<{
        id: string; year: number; month: number; alertType: string;
        message: string; threshold: number | null; projectedBalance: number;
        isResolved: boolean; createdAt: string
      }>
    },
    enabled: !!orgId,
  })
}

export function useResolveCashFlowAlert() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (alertId: string) => {
      const res = await fetch("/api/budgeting/cash-flow/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: JSON.stringify({ alertId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgeting", "cash-flow-alerts"] })
    },
  })
}

// ─── ODDS Report ─────────────────────────────────────────────

export function useODDSReport(year: number, compareYear?: number | null) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "odds", year, compareYear, orgId],
    queryFn: async () => {
      const url = `/api/budgeting/cash-flow/odds?year=${year}${compareYear ? `&compareYear=${compareYear}` : ""}`
      const res = await fetch(url, { headers: { "x-organization-id": orgId } })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json.data ?? json
    },
    enabled: !!orgId,
  })
}

// ─── Plan vs Fact ────────────────────────────────────────────

export function usePlanFact(year: number) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "plan-fact", year, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/budgeting/cash-flow/plan-fact?year=${year}`, {
        headers: { "x-organization-id": orgId },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json.data ?? json
    },
    enabled: !!orgId,
  })
}

export function useGenerateCashFlow() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { year: number; planId?: string }) => {
      const res = await fetch("/api/budgeting/cash-flow/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgeting", "cash-flow"] })
      qc.invalidateQueries({ queryKey: ["budgeting", "cash-flow-alerts"] })
    },
  })
}

// ─── Report Builder ─────────────────────────────────────────

export function useSavedBudgetReports() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "reports", orgId],
    queryFn: () => apiFetch<SavedBudgetReport[]>("/api/budgeting/reports", orgId),
    enabled: !!orgId,
  })
}

export function useCreateBudgetReport() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<SavedBudgetReport, "id" | "organizationId" | "createdAt" | "updatedAt">) =>
      apiFetch<SavedBudgetReport>("/api/budgeting/reports", orgId, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budgeting", "reports", orgId] }),
  })
}

export function useUpdateBudgetReport() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<SavedBudgetReport>) =>
      apiFetch<SavedBudgetReport>(`/api/budgeting/reports/${id}`, orgId, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budgeting", "reports", orgId] }),
  })
}

export function useDeleteBudgetReport() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/budgeting/reports/${id}`, orgId, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budgeting", "reports", orgId] }),
  })
}

export function useBudgetReportPreview(config: BudgetReportConfig | null) {
  const orgId = useOrgId()

  // Debounce config by 600ms to avoid spamming preview on every checkbox toggle
  const [debouncedConfig, setDebouncedConfig] = useState(config)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedConfig(config), 600)
    return () => clearTimeout(timer)
  }, [config])

  return useQuery({
    queryKey: ["budgeting", "report-preview", debouncedConfig],
    queryFn: async () => {
      const res = await fetch("/api/budgeting/reports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: JSON.stringify(debouncedConfig),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Preview failed")
      return json as ReportResult & { success: boolean }
    },
    enabled: !!orgId && !!debouncedConfig?.entityType && (debouncedConfig?.columns?.length ?? 0) > 0,
    staleTime: 10_000,
  })
}

export function useBudgetReportExport() {
  const orgId = useOrgId()
  return useMutation({
    mutationFn: async (data: BudgetReportConfig & { format: "csv" | "xlsx" }) => {
      const res = await fetch("/api/budgeting/reports/export", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error || "Export failed")
      }
      const blob = await res.blob()
      const ext = data.format === "xlsx" ? "xlsx" : "csv"
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${data.entityType}_report.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    },
  })
}

export function useReportEntities() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "report-entities"],
    queryFn: async () => {
      const res = await fetch("/api/budgeting/reports/preview", {
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to load entities")
      return json.data as Array<{
        key: string
        label: string
        fields: Array<{ name: string; label: string; type: string }>
        hasPlanId: boolean
        hasYearMonth: boolean
      }>
    },
    enabled: !!orgId,
    staleTime: 60_000,
  })
}
