"use client";
/**
 * Financial-truth-infra Phase C.4 — unified onboarding page.
 *
 * Combines the two previously-separate onboarding surfaces into one
 * tabbed view so the user has a single mental model:
 *   - **Status** (default) — per-company completeness dashboard
 *     (formerly /budgeting/admin/onboarding). Re-derives from DB on
 *     every visit.
 *   - **Import** — AI-mapper xlsx upload wizard (the existing
 *     OnboardingWizardSwitcher, formerly the only content on
 *     /budgeting/onboarding).
 *
 * Tab choice persists in URL (`?view=import` / `?view=status`) so a
 * bookmarked link lands on the same tab.
 *
 * Why default to Status: typical workflow is "what's missing? → load
 * the file → re-check." Showing completeness first means the user
 * sees context before deciding what to upload, and the cycle closes
 * naturally without page nav.
 */
import React from "react";
import { useTranslations } from "next-intl";
import { useSearchParams, useRouter } from "next/navigation";
import { OnboardingWizardSwitcher } from "./OnboardingWizardSwitcher";
import { OnboardingCompletenessDashboard } from "./OnboardingCompletenessDashboard";

type View = "status" | "import";

export function OnboardingTabbedPage() {
  const t = useTranslations("onboarding");
  const router = useRouter();
  const search = useSearchParams();
  const initial = (search?.get("view") as View | null) ?? "status";
  const [view, setView] = React.useState<View>(initial);

  const switchView = (v: View) => {
    setView(v);
    const params = new URLSearchParams(search?.toString() ?? "");
    params.set("view", v);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Onboarding view"
        className="flex items-center gap-1 rounded-lg border border-gray-700 bg-card p-1 w-fit"
      >
        <TabButton
          active={view === "status"}
          onClick={() => switchView("status")}
          label={safeT(t, "tabStatus", "Status")}
        />
        <TabButton
          active={view === "import"}
          onClick={() => switchView("import")}
          label={safeT(t, "tabImport", "Import")}
        />
      </div>
      <div
        role="tabpanel"
        aria-label={view === "status" ? "Status" : "Import"}
        className="space-y-4"
      >
        {view === "status" ? (
          <OnboardingCompletenessDashboard />
        ) : (
          <OnboardingWizardSwitcher />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded transition-colors ${
        active
          ? "bg-[#00D4AA]/15 text-[#00D4AA] font-medium"
          : "text-muted-foreground hover:text-foreground hover:bg-accent"
      }`}
    >
      {label}
    </button>
  );
}

// Resilient translator — falls back to the second arg if the i18n key
// isn't in the messages bundle yet.
function safeT(
  t: ReturnType<typeof useTranslations>,
  key: string,
  fallback: string,
): string {
  try {
    return t(key as never);
  } catch {
    return fallback;
  }
}
