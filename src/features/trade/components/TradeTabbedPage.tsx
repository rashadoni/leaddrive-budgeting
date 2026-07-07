"use client";

// Trade Tower tab layout (user feedback 2026-07-07: the single-scroll
// page grew to 7 sections — too stretched). Same pill-tab pattern as
// OnboardingTabbedPage; ?view= query param keeps tabs deep-linkable.

import React from "react";
import { useTranslations } from "next-intl";
import { useSearchParams, useRouter } from "next/navigation";
import { TradePacing } from "./TradePacing";
import { TradeAlertInbox } from "./TradeAlertInbox";
import { TradeCampaigns } from "./TradeCampaigns";
import { TradeSpend } from "./TradeSpend";
import { TradeBudget } from "./TradeBudget";
import { TradeMasterData } from "./TradeMasterData";

const VIEWS = ["dashboard", "campaigns", "spend", "budget", "master"] as const;
type View = (typeof VIEWS)[number];

export function TradeTabbedPage() {
  const t = useTranslations("trade.tabs");
  const router = useRouter();
  const search = useSearchParams();
  const fromUrl = search?.get("view") as View | null;
  const initial: View = fromUrl && VIEWS.includes(fromUrl) ? fromUrl : "dashboard";
  const [view, setView] = React.useState<View>(initial);
  // R6 — the open-alert count must be visible from EVERY tab, otherwise
  // two critical alerts can burn unseen while the user edits the budget.
  const [alertCount, setAlertCount] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/trade/alerts");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setAlertCount((data.open ?? []).length);
      } catch {
        /* badge is best-effort */
      }
    };
    void poll();
    const id = setInterval(poll, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [view]);

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
        aria-label="Trade Tower view"
        className="flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-full border border-border bg-card/50 p-1 shadow-sm"
      >
        {VIEWS.map((v) => (
          <TabButton
            key={v}
            active={view === v}
            onClick={() => switchView(v)}
            label={t(v)}
            badge={v === "dashboard" && alertCount > 0 ? alertCount : undefined}
          />
        ))}
      </div>
      <div role="tabpanel" aria-label={t(view)} className="space-y-6">
        {view === "dashboard" && (
          <>
            <TradePacing />
            <TradeAlertInbox />
          </>
        )}
        {view === "campaigns" && <TradeCampaigns />}
        {view === "spend" && <TradeSpend />}
        {view === "budget" && <TradeBudget />}
        {view === "master" && <TradeMasterData />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-sm transition-all duration-150 active:scale-[0.97] ${
        active
          ? "bg-primary font-medium text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
      }`}
    >
      {label}
      {badge != null && (
        <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
          {badge}
        </span>
      )}
    </button>
  );
}
