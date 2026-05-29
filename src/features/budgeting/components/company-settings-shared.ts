/**
 * Shared settings data-fetch + shape for the company-settings admin subsystem —
 * extracted from CompanySettingsAdmin.tsx (Phase 8 D1 2026-05-29). Both
 * CompanySettingsForm (the editable fields) and RiskRegistryPanel (read-only
 * register, in risk-panels.tsx) query `["company-settings", companyId]` with
 * this fetcher, so it lives in one place to keep the react-query cache key and
 * the response shape in lock-step.
 */

export interface SettingsBody {
  companyId: string
  companyCode: string
  industry: string | null
  settings: Record<string, unknown>
}

export function fetchSettings(companyId: string): Promise<SettingsBody> {
  return fetch(`/api/companies/${companyId}/settings`).then((r) => r.json())
}
