/**
 * Phase D.3 — admin route entry.
 *
 * Sidebar link → `/budgeting/admin/drift`. Renders the DriftDashboard
 * which surfaces (a) recent reconciliation_drift_detected audit events,
 * (b) reference-feed freshness, (c) stale-pending onboarding. Auth-gated
 * at route group level + API enforces admin role.
 */
import { DriftDashboard } from "@/features/admin/components/DriftDashboard";

export const metadata = {
  title: "Drift Dashboard · BudgetPro",
};

export default function DriftAdminPage() {
  return <DriftDashboard />;
}
