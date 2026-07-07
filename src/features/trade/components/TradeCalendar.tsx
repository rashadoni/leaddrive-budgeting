"use client";

// T6 (audit §1.6) — the promo calendar: campaign bars across a 12-month
// strip, colored by status. The most recognizable artifact of the trade
// marketing profession.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarRange } from "lucide-react";

interface Campaign {
  id: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  scopes: { scopeType: string; scopeValue: string | null }[];
}

const BAR_CLASSES: Record<string, string> = {
  approved: "bg-emerald-500/80 text-white",
  pending_approval: "bg-amber-400/90 text-amber-950",
  draft: "bg-slate-300 text-slate-800",
  rejected: "bg-rose-300 text-rose-950",
  paused: "bg-slate-200 text-slate-600",
  completed: "bg-slate-200 text-slate-600",
  cancelled: "bg-slate-200 text-slate-500 line-through",
};

export function TradeCalendar() {
  const t = useTranslations("trade.calendar");
  const tm = useTranslations("trade.campaigns.status");
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const year = new Date().getUTCFullYear();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/trade/campaigns");
      const data = await res.json();
      setCampaigns(data.campaigns as Campaign[]);
    } catch {
      setCampaigns([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = (campaigns ?? []).filter((c) => {
    const s = new Date(c.startDate);
    const e = new Date(c.endDate);
    return s.getUTCFullYear() <= year && e.getUTCFullYear() >= year && c.status !== "cancelled";
  });

  if (campaigns !== null && visible.length === 0) return null;

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const monthName = (m: number) =>
    new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString(undefined, { month: "short" });

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <CalendarRange className="h-4 w-4" /> {t("title")} · {year}
      </h2>
      {campaigns === null ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-12 gap-px border-b pb-1 text-[10px] text-muted-foreground">
              {months.map((m) => (
                <div key={m} className="text-center">
                  {monthName(m)}
                </div>
              ))}
            </div>
            <div className="mt-1 space-y-1">
              {visible.map((c) => {
                const s = new Date(c.startDate);
                const e = new Date(c.endDate);
                const startCol = s.getUTCFullYear() < year ? 1 : s.getUTCMonth() + 1;
                const endCol = e.getUTCFullYear() > year ? 12 : e.getUTCMonth() + 1;
                const channel = c.scopes.find((sc) => sc.scopeType === "channel")?.scopeValue;
                return (
                  <div key={c.id} className="grid grid-cols-12 gap-px">
                    <div
                      className={`col-span-full truncate rounded px-2 py-1 text-[11px] font-medium ${BAR_CLASSES[c.status] ?? "bg-muted"}`}
                      style={{ gridColumn: `${startCol} / ${endCol + 1}` }}
                      title={`${c.name} · ${tm(c.status)}${channel ? ` · ${channel}` : ""}`}
                    >
                      {c.name}
                      {channel && <span className="ml-1 opacity-75">· {channel}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
