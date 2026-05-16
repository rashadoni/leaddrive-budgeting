/**
 * Phase C.4 (Turn after C.3) — this route now redirects to the unified
 * /budgeting/onboarding?view=status page. Kept so existing bookmarks +
 * sidebar links don't break; the actual UI lives in OnboardingTabbedPage.
 */
import { redirect } from "next/navigation";

export const metadata = {
  title: "Onboarding Completeness · BudgetPro",
};

export default function OnboardingAdminPage() {
  redirect("/budgeting/onboarding?view=status");
}
