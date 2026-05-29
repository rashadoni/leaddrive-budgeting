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

// Phase 8 D1 (2026-05-29) — shared helpers + admin/reports hooks split out.
import { useOrgId, apiFetch } from "./hooks-shared"
export * from "./hooks-admin"

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

