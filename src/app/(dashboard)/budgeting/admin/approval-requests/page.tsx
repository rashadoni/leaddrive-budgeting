/**
 * Phase 7.G Turn LXXII (Phase 4.3 closure) — admin page route.
 * Renders the ApprovalRequestsAdmin client component (list + filter pills
 * + per-row approve/reject/cancel actions).
 *
 * Auth: page itself is unguarded at the route level (server-side cookie
 * check protects the entire `(dashboard)` group via middleware). The
 * underlying API enforces role gates (manager+ for approve/reject;
 * requester or admin for cancel). UI renders for everyone but actions
 * fail with a 403 → translated error banner.
 */

import { ApprovalRequestsAdmin } from "@/features/budgeting/components/ApprovalRequestsAdmin"

export const metadata = {
  title: "Approval Requests · BudgetPro",
}

export default function ApprovalRequestsAdminPage() {
  return <ApprovalRequestsAdmin />
}
