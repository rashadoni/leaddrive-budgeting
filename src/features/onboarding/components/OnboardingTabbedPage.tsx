"use client";
/**
 * Financial-truth-infra Phase C.4 — unified onboarding page.
 * Phase 7.M Tier 6 (2026-05-21) — Import tab now redirects to the
 * single AI Import surface at /budgeting/admin/ai-import. The
 * AI classifier added a COMPANIES dataType so the entity-tree
 * bootstrap (this tab's former job) is now the same drag-drop flow
 * as financial-data import — one mental model instead of three.
 *
 * Status tab stays here — it's a derived dashboard, not an upload
 * surface, so consolidation doesn't apply.
 */
import React from "react";
import { useTranslations } from "next-intl";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Brain, ArrowRight } from "lucide-react";
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
        className="flex items-center gap-1 rounded-full border border-border bg-card/50 p-1 w-fit shadow-sm"
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
          <ImportRedirectPanel />
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
  // Pill-tab pattern: rounded-full + active gets primary fill + soft shadow,
  // matches the design system from src/components/ui/button.tsx
  // (subtle active:scale tap-feedback shared across the app).
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-4 py-1.5 text-sm rounded-full transition-all duration-150 active:scale-[0.97] ${
        active
          ? "bg-primary text-primary-foreground shadow-sm font-medium"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
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

// Phase 7.M Tier 6 — Import tab now redirects to the unified AI Import.
function ImportRedirectPanel() {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-6 space-y-4">
      <div className="flex items-start gap-3">
        <Brain className="size-6 text-primary mt-0.5" />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Импорт теперь в одном месте</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Загрузка любых xlsx (данные, структура компаний, KPI, земля,
            описания) — через единый AI Import. AI определяет тип файла и
            маршрутизирует на правильный adapter, бывшие 3 отдельных экрана
            больше не нужны.
          </p>
        </div>
      </div>
      <Link
        href="/budgeting/admin/ai-import"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity text-sm font-medium"
      >
        Перейти к AI Import
        <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}
