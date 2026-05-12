"use client";

/**
 * Phase 7.H Bloomberg-multi-window — single-panel popped-out window.
 *
 * URL: /terminal-panel/<kind>?period=2026
 *
 * Renders ONE terminal panel full-screen — no sidebar, no header chrome.
 * Opened via window.open() from the main terminal's pop-out button.
 *
 * Each window has its own React state (no cross-window sync) — like
 * Bloomberg Launchpad components, each is an independent context. The
 * URL `period` param seeds the initial view; subsequent changes inside
 * the popped window stay local.
 */

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { CompanyTree } from "@/features/terminal/components/CompanyTree";
import { HeatMap } from "@/features/terminal/components/HeatMap";
import { IndicatorDetail } from "@/features/terminal/components/IndicatorDetail";
import { VarianceExplainerPanel } from "@/features/terminal/components/VarianceExplainerPanel";
import { TodayBrief } from "@/features/terminal/components/TodayBrief";
import { NewsSummarySection } from "@/features/terminal/components/NewsSummarySection";
import { useCompanies } from "@/features/terminal/hooks/use-companies";

const PANEL_TITLES: Record<string, string> = {
  tree: "Дерево компаний",
  matrix: "Карта рисков",
  detail: "Детализация индикатора",
  variance: "AI Variance Explainer",
  brief: "Сводка дня",
  news: "📰 Новости холдинга",
};

function PanelContent({ kind }: { kind: string }) {
  const { companies, loading } = useCompanies();
  switch (kind) {
    case "tree":
      return <CompanyTree companies={[...(companies ?? [])]} loading={loading} />;
    case "matrix":
      return <HeatMap />;
    case "detail":
      return <IndicatorDetail />;
    case "variance":
      return <VarianceExplainerPanel />;
    case "brief":
      return <TodayBrief />;
    case "news":
      return <NewsSummarySection />;
    default:
      return (
        <div className="text-gray-500 p-6">
          Unknown panel kind: {kind}
        </div>
      );
  }
}

export default function PoppedOutPanelPage() {
  const params = useParams();
  const search = useSearchParams();
  const kind = typeof params.id === "string" ? params.id : "matrix";
  const period = search?.get("period");
  // V1: each popped window starts with default period; can extend to
  // hydrate from URL once terminalStore exposes a global setPeriod
  // action (currently period is HeatMap-local state).

  const title = PANEL_TITLES[kind] ?? kind;

  return (
    <div className="flex flex-col h-full bg-[#0A0E27] text-gray-300">
      <header className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800/60 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[#00D4AA] text-[10px] font-mono uppercase tracking-wider">
            BudgetPro Terminal · {title}
          </span>
        </div>
        <div className="text-[10px] text-gray-600 font-mono">
          {period ? `period=${period}` : ""}
        </div>
      </header>
      <main className="flex-1 overflow-auto p-3">
        <Suspense fallback={<div className="text-gray-500">Loading…</div>}>
          <PanelContent kind={kind} />
        </Suspense>
      </main>
    </div>
  );
}
