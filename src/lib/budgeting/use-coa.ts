// Phase 7.G Turn LXXXXI (Phase 5.1.2) — CoA list + role override hooks.
// Separate from `hooks.ts` (1182 LOC, M4 split-deferred); new feature hooks
// should land in dedicated feature files going forward.
"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"

// Local copies of hooks.ts helpers (private there; M4 split-deferred).
// Inlined here to avoid forcing an export-pass on hooks.ts for one-call sites.
function useOrgId() {
  const { data: session } = useSession()
  return ((session?.user as { organizationId?: string } | undefined)?.organizationId) || ""
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

// Mirrors Prisma `ChartOfAccount` model + `CoARole` enum.
export type CoARole =
  | "revenue" | "cogs" | "opex" | "finance"
  | "tax_costs" | "non_operating" | "tax" | "unknown"

export type ChartOfAccount = {
  id: string
  organizationId: string
  code: string
  name: string
  nameAz?: string | null
  nameRu?: string | null
  nameEn?: string | null
  parentCode?: string | null
  accountType: string
  category?: string | null
  role?: CoARole | null
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export function useChartOfAccounts() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["budgeting", "chart-of-accounts", orgId],
    queryFn: () =>
      apiFetch<ChartOfAccount[]>("/api/budgeting/chart-of-accounts", orgId),
    enabled: !!orgId,
  })
}

export function useUpdateCoARole() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: CoARole | null }) =>
      apiFetch<{ account: ChartOfAccount; updated: boolean }>(
        `/api/budgeting/chart-of-accounts/${id}`,
        orgId,
        { method: "PUT", body: JSON.stringify({ role }) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgeting", "chart-of-accounts", orgId] })
      // Role changes affect P&L aggregation; bust analytics + pnl caches.
      // Note: pnl queryKey is `["pnl", planId, companyId]` (in `budget-pnl-view.tsx`)
      // — NOT under "budgeting" prefix. Both invalidations needed because
      // analytics endpoint and pnl endpoint compute different but related rollups.
      qc.invalidateQueries({ queryKey: ["budgeting", "analytics"] })
      qc.invalidateQueries({ queryKey: ["pnl"] })
    },
  })
}
