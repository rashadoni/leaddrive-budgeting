"use client";

/**
 * Phase 7.H Bloomberg-multi-window — single-panel popped-out window.
 *
 * URL: /terminal-panel/<kind>?period=2026&company=AZSEKER-EDEN
 *
 * Renders ONE terminal panel full-screen — no sidebar, no header chrome.
 * Opened via window.open() from the main terminal's pop-out button.
 *
 * Each window has its own React state (no cross-window sync) — like
 * Bloomberg Launchpad components, each is an independent context.
 *
 * Phase 7.I — URL params seed the popped window's terminalStore so the
 * Agro/Commodity/Agronomy widgets land on the correct company instead of
 * an empty "Select a company" state. The opener (CommandBar / HotkeyToolbar)
 * passes `?company=<activeCode>` so the pop-out inherits context. Once
 * inside the pop-out, the user can switch companies independently —
 * Bloomberg-style window autonomy.
 */

import { Suspense, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { CompanyTree } from "@/features/terminal/components/CompanyTree";
import { HeatMap } from "@/features/terminal/components/HeatMap";
import { IndicatorDetail } from "@/features/terminal/components/IndicatorDetail";
import { VarianceExplainerPanel } from "@/features/terminal/components/VarianceExplainerPanel";
import { TodayBrief } from "@/features/terminal/components/TodayBrief";
import { NewsSummarySection } from "@/features/terminal/components/NewsSummarySection";
import { AgroDashboardPanel } from "@/features/terminal/components/AgroDashboardPanel";
import { CommodityTickerPanel } from "@/features/terminal/components/CommodityTickerPanel";
import { AgronomyEntryPanel } from "@/features/terminal/components/AgronomyEntryPanel";
import { ConcentrationPanel } from "@/features/terminal/components/ConcentrationPanel";
import { FxExposurePanel } from "@/features/terminal/components/FxExposurePanel";
import { useCompanies } from "@/features/terminal/hooks/use-companies";
import { useTerminalStore } from "@/features/terminal/store/terminalStore";

const PANEL_TITLES: Record<string, string> = {
  tree: "Дерево компаний",
  matrix: "Карта рисков",
  detail: "Детализация индикатора",
  variance: "AI Variance Explainer",
  brief: "Сводка дня",
  news: "📰 Новости холдинга",
  // Phase 7.I — agro / sugar pop-out widgets
  "agro-dashboard": "Agro Dashboard",
  "commodity-ticker": "Commodity & Weather",
  "agronomy-entry": "Agronomy Entry",
  // Phase 7.J — counterparty + FX widgets
  "concentration": "Concentration · Customers / Suppliers",
  "fx-exposure": "FX Exposure · Net by Currency",
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
    // Phase 7.I — agro / sugar pop-out widgets. activeCompany-aware via
    // terminalStore so a popped window pivots when the user picks a
    // different company in the main window.
    case "agro-dashboard":
      return <AgroDashboardPanel />;
    case "commodity-ticker":
      return <CommodityTickerPanel />;
    case "agronomy-entry":
      return <AgronomyEntryPanel />;
    case "concentration":
      return <ConcentrationPanel />;
    case "fx-exposure":
      return <FxExposurePanel />;
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
  const companyFromUrl = search?.get("company");
  // Phase 7.K 2026-05-18 — also accept `?iv=<id>` so popping out from a
  // selected HeatMap cell preserves the indicator focus instead of
  // falling back to the morning-brief summary view.
  const ivFromUrl = search?.get("iv");
  const setCompany = useTerminalStore((s) => s.setCompany);
  const setActiveIndicatorValue = useTerminalStore(
    (s) => s.setActiveIndicatorValue,
  );
  const activeCompanyCode = useTerminalStore((s) => s.activeCompanyCode);
  const activeIndicatorValueId = useTerminalStore(
    (s) => s.activeIndicatorValueId,
  );

  // Phase 7.I — hydrate popped window's terminalStore from URL `?company=<code>`
  // on first mount so Agro/Commodity/Agronomy widgets land on the right
  // entity. Use `setCompany` (programmatic) — `selectCompany` would pollute
  // the recent-LRU list with the auto-selection. Skip when already set
  // (e.g., user navigated within the window after open).
  useEffect(() => {
    if (companyFromUrl && !activeCompanyCode) {
      setCompany(companyFromUrl);
    }
  }, [companyFromUrl, activeCompanyCode, setCompany]);

  // Phase 7.K 2026-05-18 — hydrate active indicator-value id from URL
  // so the detail popout shows the exact cell that was clicked in the
  // main window. Without this, IndicatorDetail renders its no-selection
  // fallback (morning brief + sector movers), confusing users who
  // expect "show me this number bigger".
  useEffect(() => {
    if (ivFromUrl && !activeIndicatorValueId) {
      setActiveIndicatorValue(ivFromUrl);
    }
  }, [ivFromUrl, activeIndicatorValueId, setActiveIndicatorValue]);

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
