"use client";

// Trade Tower tab layout (user feedback 2026-07-07: the single-scroll
// page grew to 7 sections — too stretched). Same pill-tab pattern as
// OnboardingTabbedPage; ?view= query param keeps tabs deep-linkable.

import React from "react";
import { useTranslations } from "next-intl";
import { useSearchParams, useRouter } from "next/navigation";
import { TradePacing } from "./TradePacing";
import { TradeAlertInbox } from "./TradeAlertInbox";
import { TradeCalendar } from "./TradeCalendar";
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
          <TabButton key={v} active={view === v} onClick={() => switchView(v)} label={t(v)} />
        ))}
      </div>
      <div role="tabpanel" aria-label={t(view)} className="space-y-6">
        {view === "dashboard" && (
          <>
            <TradePacing />
            <TradeAlertInbox />
          </>
        )}
        {view === "campaigns" && (
          <>
            <TradeCalendar />
            <TradeCampaigns />
          </>
        )}
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
      className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm transition-all duration-150 active:scale-[0.97] ${
        active
          ? "bg-primary font-medium text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
