/**
 * Phase 7.G Turn LXX (Phase 4.2 closure) — admin page route.
 * Renders the PeriodLocksAdmin client component (lock list + add/remove).
 *
 * Auth: page itself is unguarded at the route level (server-side cookie
 * check protects the entire `(dashboard)` group via middleware). The
 * underlying API enforces admin-only on POST/DELETE; the UI renders
 * for everyone but the API rejects non-admin mutations with 403.
 */

import { PeriodLocksAdmin } from "@/features/budgeting/components/PeriodLocksAdmin"

export const metadata = {
  title: "Period Locks · BudgetPro",
}

export default function PeriodLocksAdminPage() {
  return <PeriodLocksAdmin />
}
