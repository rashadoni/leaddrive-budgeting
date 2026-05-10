/**
 * Phase 7.G Turn LXXXXI (Phase 5.1.2) — admin page route.
 * Renders the CoARolesAdmin client component (account list + role override).
 *
 * Auth: page unguarded at route level (middleware-cookie check on
 * `(dashboard)` group). API PUT enforces admin-only with 403; UI renders
 * for everyone but mutations fail for non-admin.
 */

import { CoARolesAdmin } from "@/features/budgeting/components/CoARolesAdmin"

export const metadata = {
  title: "Chart of Accounts — Roles · BudgetPro",
}

export default function CoARolesAdminPage() {
  return <CoARolesAdmin />
}
