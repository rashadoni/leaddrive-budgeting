"use client"
/**
 * Shared budgeting-hooks helpers — extracted from hooks.ts (Phase 8 D1
 * 2026-05-29) so the catalog of React-Query hooks can split into focused
 * files (hooks.ts core + hooks-admin.ts) without an import cycle. `useOrgId`
 * reads the org from the session; `apiFetch` is the org-scoped fetch wrapper
 * that unwraps `{data}` envelopes and throws on non-OK.
 */
import { useSession } from "next-auth/react"

export function useOrgId() {
  const { data: session } = useSession()
  return session?.user?.organizationId ?? ""
}

export async function apiFetch<T>(url: string, orgId: string, options?: RequestInit): Promise<T> {
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
