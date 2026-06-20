"use client"
/**
 * Budgeting hooks — admin / cash-flow / versions / reports group, extracted
 * from hooks.ts (Phase 8 D1 2026-05-29). Re-exported by hooks.ts so every
 * existing `@/lib/budgeting/hooks` import is unaffected.
 */
import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { BudgetPlan, SavedBudgetReport } from "./types"
import type { BudgetReportConfig, ReportResult } from "./report-engine"
import { useOrgId, apiFetch } from "./hooks-shared"

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
        entries?: Array<{
          id: string
          month: number
          entryType: string
          amount: number
          description: string | null
          activityType: string | null
          source: string | null
        }>
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
