/**
 * Phase 7.I — admin page: per-company settings + role/status editor.
 *
 * Mounts two sections:
 *   1. CompanyManagementAdmin — inline role + status dropdowns
 *      (Truth-Infra Phase C.1, 2026-05-26)
 *   2. CompanySettingsAdmin — per-industry JSON settings
 *      (Phase 7.I, original)
 *
 * Auth: middleware gates the route group; underlying PATCH APIs
 * enforce admin / manager+ on writes respectively.
 */

import { CompanySettingsAdmin } from "@/features/budgeting/components/CompanySettingsAdmin"
import { CompanyManagementAdmin } from "@/features/budgeting/components/CompanyManagementAdmin"

export const metadata = {
  title: "Company Settings · BudgetPro",
}

export default function CompanySettingsAdminPage() {
  return (
    <div className="container mx-auto py-6 px-4 max-w-5xl space-y-10">
      <CompanyManagementAdmin />
      <hr className="border-border/50" />
      <CompanySettingsAdmin />
    </div>
  )
}
