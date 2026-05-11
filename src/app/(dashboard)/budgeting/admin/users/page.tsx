/**
 * Phase 7.F sub-group RBAC admin v2 — admin page route.
 *
 * Renders the UsersAccessAdmin client component (user list + per-row
 * multi-select for allowedSubGroupIds).
 *
 * Auth: page unguarded at route level (middleware-cookie check on
 * `(dashboard)` group). API enforces admin-only with 403; non-admins
 * see the UI fail to fetch.
 */

import { UsersAccessAdmin } from "@/features/admin/components/UsersAccessAdmin"

export const metadata = {
  title: "Users — Sub-group Access · BudgetPro",
}

export default function UsersAccessAdminPage() {
  return <UsersAccessAdmin />
}
