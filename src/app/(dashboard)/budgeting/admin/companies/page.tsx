/**
 * Phase 7.I — admin page: per-company settings editor.
 *
 * Lists every company in the org with industry tag + a link to the
 * per-industry settings form. The form (sub-page `[id]/settings`) is
 * the live edit surface — `Company.settings` JSON is the contract.
 *
 * Auth: middleware gates the route group; underlying PATCH API
 * enforces manager+ on writes.
 */

import { CompanySettingsAdmin } from "@/features/budgeting/components/CompanySettingsAdmin"

export const metadata = {
  title: "Company Settings · BudgetPro",
}

export default function CompanySettingsAdminPage() {
  return <CompanySettingsAdmin />
}
