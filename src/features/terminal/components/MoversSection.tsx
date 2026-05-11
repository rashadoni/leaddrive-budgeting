"use client";

/**
 * Phase 7.H Feature 2 — Sector Movers section in Today's Brief.
 *
 * Renders top-5 indicator movements grouped by sector, each with a
 * mini sparkline + delta% colored by direction. Click → drill-down.
 */

import { useTranslations } from "next-intl";
import { Sparkline } from "./Sparkline";
import { groupBySector, type MoverRow } from "@/lib/risk/movers";

interface Props {
  movers: MoverRow[];
  onOpen: (companyCode: string, ivId?: string) => void;
}

export function MoversSection({ movers, onOpen }: Props) {
  const t = useTranslations("terminal");
  if (movers.length === 0) {
    return (
      <section data-testid="today-brief-movers">
        <div className="text-[#FFB800] text-[10px] uppercase tracking-wider mb-1">
          ↕ {t("todayBrief.moversTitle")}
        </div>
        <p className="text-gray-700 text-[10px]">{t("todayBrief.empty")}</p>
      </section>
    );
  }

  const grouped = groupBySector(movers);
  const sectors = Array.from(grouped.keys());

  return (
    <section data-testid="today-brief-movers">
      <div className="text-[#FFB800] text-[10px] uppercase tracking-wider mb-1">
        ↕ {t("todayBrief.moversTitle")}
      </div>
      <div className="space-y-1.5">
        {sectors.map((sector) => (
          <div key={sector}>
            <div className="text-[8px] uppercase tracking-wider text-gray-600 mb-0.5">
              {sector}
            </div>
            <ul className="space-y-0.5">
              {grouped.get(sector)!.map((m) => {
                const positive = m.deltaPct > 0;
                const arrow = positive ? "▲" : "▼";
                const tone = positive ? "text-[#00D4AA]" : "text-[#FF4757]";
                return (
                  <li
                    key={`${m.companyId}-${m.indicatorId}`}
                    className="flex items-center gap-2 text-[11px] hover:bg-gray-800/30 cursor-pointer transition-colors px-1 py-0.5 rounded"
                    onClick={() => onOpen(m.companyCode, m.ivId)}
                    title={`${m.companyCode} · ${m.indicatorCode} · ${m.deltaPct.toFixed(1)}%`}
                  >
                    <span className="text-gray-500 font-mono w-12 truncate">
                      {m.companyCode}
                    </span>
                    <span className="text-gray-400 truncate flex-1">
                      {m.indicatorCode}
                    </span>
                    <Sparkline
                      data={m.sparkline}
                      status={m.status}
                      compact
                    />
                    <span className={`${tone} tabular-nums w-14 text-right`}>
                      {arrow} {positive ? "+" : ""}
                      {m.deltaPct.toFixed(1)}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
