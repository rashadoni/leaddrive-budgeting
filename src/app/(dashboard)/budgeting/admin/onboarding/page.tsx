/**
 * Financial-truth-infra Phase C.3 — admin route entry.
 *
 * Sidebar link → `/budgeting/admin/onboarding`. Renders the
 * OnboardingCompletenessDashboard which lists every company in the org
 * with its current data-completeness % and per-section breakdown.
 *
 * Auth: route group middleware gates to authenticated users; the
 * underlying API enforces viewer+ role with sub-group scope.
 */
import { OnboardingCompletenessDashboard } from "@/features/onboarding/components/OnboardingCompletenessDashboard";

export const metadata = {
  title: "Onboarding Completeness · BudgetPro",
};

export default function OnboardingAdminPage() {
  return <OnboardingCompletenessDashboard />;
}
